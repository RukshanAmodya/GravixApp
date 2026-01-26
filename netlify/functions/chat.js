import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Multi-API Failover Logic
async function callAIWithFailover(messages, plan) {
    const providers = [
        { name: 'Groq', model: 'openai/gpt-oss-120b', url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY },
        { name: 'Gemini', model: 'gemini-1.5-pro', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: process.env.GEMINI_API_KEY }
    ];

    for (let provider of providers) {
        try {
            const response = await fetch(provider.url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: provider.model, 
                    messages, 
                    temperature: 0.3 // ස්වභාවික සංවාදයක් සඳහා
                })
            });
            const data = await response.json();
            if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
        } catch (e) { console.error(`${provider.name} failed...`); }
    }
    throw new Error("All AI Providers failed.");
}

async function sendTelegramAlert(chatId, text) {
    if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return;
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
    });
}

export const handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
    };

    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "OK" };

    try {
        const { client_id, session_id, message } = JSON.parse(event.body);

        // Fetch Config, Products, Usage, and Conversation History (JSONB Column)
        const [configRes, productsRes, usageRes, convRes] = await Promise.all([
            supabase.from('bot_configs').select('*, clients(*)').eq('client_id', client_id).single(),
            supabase.from('products').select('*').eq('client_id', client_id),
            supabase.from('usage_logs').select('chat_count').eq('client_id', client_id).eq('usage_date', new Date().toISOString().split('T')[0]).single(),
            supabase.from('conversations').select('messages').eq('session_id', session_id).maybeSingle()
        ]);

        const config = configRes.data;
        const products = productsRes.data || [];
        const plan = config.clients.plan_type;
        const currentUsage = usageRes.data?.chat_count || 0;
        
        // පවතින මතකය ලබා ගැනීම (Array එකක් ලෙස)
        const chatHistory = convRes.data?.messages || [];

        const limits = { 'Lite': 30, 'Standard': 70, 'Pro': 150 };
        if (currentUsage >= (limits[plan] || 30)) {
            const waMsg = `අපගේ AI සහායකයා දැනට කාර්යබහුලයි. 🕒 කරුණාකර අපගේ WhatsApp හරහා සම්බන්ධ වන්න.`;
            return { statusCode: 200, headers, body: JSON.stringify({ reply: waMsg }) };
        }

        const productKB = products.map(p => `● ${p.name}: ${p.description} (Rs. ${p.price})`).join('\n');

        const systemPrompt = `
            Identity: You are ${config.bot_name}, a staff member of ${config.clients.business_name}.
            Persona: ${config.system_prompt}
            
            RULES:
            1. Warmly welcome if user says "Hi".
            2. Check chat history before asking for name/phone. If already provided, DON'T ask again.
            3. Provide info based on: ${config.knowledge_base}
            4. Available Products: ${productKB}
            5. If lead info shared, use [LEAD_DATA: Name | Phone | Interest].
        `;

        // AI එකට යවන මැසේජ් ලැයිස්තුව (මතකය ඇතුළුව)
        const messages = [
            { role: "system", content: systemPrompt },
            ...chatHistory.slice(-10), // අවසන් මැසේජ් 10 මතකය සඳහා
            { role: "user", content: message }
        ];

        const aiReply = await callAIWithFailover(messages, plan);
        const cleanReply = aiReply.replace(/\[LEAD_DATA: .*?\]/, "").trim();

        // Lead Processing
        if (aiReply.includes("[LEAD_DATA:")) {
            const leadRaw = aiReply.match(/\[LEAD_DATA: (.*?)\]/)?.[1];
            const [name, phone, interest] = leadRaw.split('|').map(s => s.trim());
            await supabase.from('leads').insert([{ client_id, customer_name: name, customer_phone: phone, interest_summary: interest }]);
            await sendTelegramAlert(config.clients.telegram_chat_id, `🎯 *New Lead!*\n\nName: ${name}\nPhone: ${phone}\nInterest: ${interest}`);
        }

        // --- වැදගත්ම කොටස: JSONB Column එකට History එක Update කිරීම ---
        const newHistory = [
            ...chatHistory,
            { role: "user", content: message },
            { role: "assistant", content: cleanReply }
        ];

        await Promise.all([
            supabase.rpc('increment_usage', { client_uid: client_id }),
            supabase.from('conversations').upsert({
                client_id,
                session_id,
                messages: newHistory, // මෙතනදී තමයි JSON array එක save වෙන්නේ
                updated_at: new Date().toISOString()
            }, { onConflict: 'session_id' }) // session_id එක unique විය යුතුය
        ]);

        return { statusCode: 200, headers, body: JSON.stringify({ reply: cleanReply }) };

    } catch (e) {
        console.error(e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Server Error" }) };
    }
};
