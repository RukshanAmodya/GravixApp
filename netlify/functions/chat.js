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
                    temperature: 0.3 // ටිකක් ස්වභාවික සහ සුහද සංවාදයක් සඳහා
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

        // Fetch Config, Products, Usage, and check for existing leads simultaneously
        const [configRes, productsRes, usageRes, existingLeadRes] = await Promise.all([
            supabase.from('bot_configs').select('*, clients(*)').eq('client_id', client_id).single(),
            supabase.from('products').select('*').eq('client_id', client_id),
            supabase.from('usage_logs').select('chat_count').eq('client_id', client_id).eq('usage_date', new Date().toISOString().split('T')[0]).single(),
            supabase.from('leads').select('*').eq('client_id', client_id).eq('customer_phone', message.match(/\d{9,10}/)?.[0] || 'none').maybeSingle()
        ]);

        const config = configRes.data;
        const products = productsRes.data || [];
        const plan = config.clients.plan_type;
        const status = config.clients.status;
        const currentUsage = usageRes.data?.chat_count || 0;

        // --- STATUS & LIMIT CHECK ---
        const limits = { 'Lite': 300, 'Standard': 700, 'Pro': 1500 };
        const dailyLimit = limits[plan] || 30;
        const waMsg = `අපගේ AI සහායකයා දැනට කාර්යබහුලයි. 🕒 කරුණාකර අපගේ නිල WhatsApp අංකය හරහා කෙලින්ම අපව සම්බන්ධ කරගන්න.`;

        if (status === 'Suspended' || currentUsage >= dailyLimit) {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: waMsg }) };
        }

        const productKB = products.map(p => `● ${p.name}: ${p.description} (Rs. ${p.price})`).join('\n');

        // Check if lead data exists in current session history or DB
        const hasLeadData = existingLeadRes.data ? true : false;

        // --- UPDATED DYNAMIC SYSTEM PROMPT ---
        const systemPrompt = `
            Identity: You are ${config.bot_name}, a friendly staff member of ${config.clients.business_name}.
            Persona: ${config.system_prompt}
            
            CONVERSATION RULES:
            1. WARM GREETING: If the user says "Hi", "Hello", or similar, greet them warmly and ask how you can assist. DO NOT jump to sales or ask for phone numbers immediately.
            2. NO REPETITION: Always check the history. If you have the user's name or number, NEVER ask for it again. 
            3. LEAD AWARENESS: ${hasLeadData ? "We already have this user's contact details. DO NOT ask for their name or WhatsApp number." : "If the user wants to book or asks for prices, then politely ask for their Name and WhatsApp number."}
            4. CONTINUITY: If the user provides details and then asks a follow-up, answer the follow-up directly without restarting the greeting.
            5. RESPONSE FORMAT: Use Sinhala or English as per user's preference. Warm, professional tone.
            6. LEAD CAPTURE: ONLY if details are provided for the first time, use [LEAD_DATA: Name | Phone | Interest].

            BUSINESS INFO:
            ${config.knowledge_base}

            AVAILABLE PRODUCTS: 
            ${productKB || 'General inquiries only.'}
        `;

        // Deep Memory: Fetch last 20 messages
        const { data: history } = await supabase.from('conversations').select('role, content').eq('session_id', session_id).order('created_at', { ascending: false }).limit(20);

        const messages = [
            { role: "system", content: systemPrompt },
            ...(history || []).reverse().map(h => ({ role: h.role, content: h.content })),
            { role: "user", content: message }
        ];

        const aiReply = await callAIWithFailover(messages, plan);

        // Lead Processing
        if (aiReply.includes("[LEAD_DATA:")) {
            const leadRaw = aiReply.match(/\[LEAD_DATA: (.*?)\]/)?.[1];
            const [name, phone, interest] = leadRaw.split('|').map(s => s.trim());
            await supabase.from('leads').insert([{ client_id, customer_name: name, customer_phone: phone, interest_summary: interest }]);
            await sendTelegramAlert(config.clients.telegram_chat_id, `🎯 *New Lead!*\n\nName: ${name}\nPhone: ${phone}\nInterest: ${interest}`);
        }

        // Parallel update: Usage log + Conversation history
        await Promise.all([
            supabase.rpc('increment_usage', { client_uid: client_id }),
            supabase.from('conversations').insert([
                { client_id, session_id, role: 'user', content: message },
                { client_id, session_id, role: 'assistant', content: aiReply.replace(/\[LEAD_DATA: .*?\]/, "").trim() }
            ])
        ]);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ reply: aiReply.replace(/\[LEAD_DATA: .*?\]/, "").trim() })
        };

    } catch (e) {
        console.error(e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Server Error" }) };
    }
};
