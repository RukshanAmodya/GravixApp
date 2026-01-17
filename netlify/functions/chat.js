import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Multi-API Failover Logic
async function callAIWithFailover(messages, plan) {
    const providers = [
        { name: 'Groq', model: plan === 'Pro' ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant', url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY },
        { name: 'Gemini', model: 'gemini-1.5-pro', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: process.env.GEMINI_API_KEY }
    ];

    for (let provider of providers) {
        try {
            const response = await fetch(provider.url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: provider.model, messages, temperature: 0.6 })
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
    // CORS Headers
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
    };

    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "OK" };

    try {
        const { client_id, session_id, message } = JSON.parse(event.body);

        // 1. Fetch Config, Products & Usage
        const [configRes, productsRes, usageRes] = await Promise.all([
            supabase.from('bot_configs').select('*, clients(*)').eq('client_id', client_id).single(),
            supabase.from('products').select('*').eq('client_id', client_id),
            supabase.from('usage_logs').select('chat_count').eq('client_id', client_id).eq('usage_date', new Date().toISOString().split('T')[0]).single()
        ]);

        const config = configRes.data;
        const products = productsRes.data || [];
        const plan = config.clients.plan_type;
        const currentUsage = usageRes.data?.chat_count || 0;

        // 2. Plan Limits (Lite: 30, Standard: 70, Pro: 150)
        const limits = { 'Lite': 30, 'Standard': 70, 'Pro': 150 };
        if (currentUsage >= (limits[plan] || 30)) {
            return { statusCode: 200, headers, body: JSON.stringify({ reply: "Daily limit reached. Contact us for an upgrade!" }) };
        }

        // 3. System Prompt & Image Logic
        const productKB = products.map(p => `● ${p.name}: ${p.description} (Rs. ${p.price}) [IMAGE: ${p.image_url}]`).join('\n');
        
        const systemPrompt = `
            Identity: You are ${config.bot_name}, staff of ${config.clients.business_name}.
            Persona: ${config.system_prompt}
            Knowledge: ${config.knowledge_base}
            Products: 
            ${productKB}
            
            RULES:
            1. Use [IMAGE: URL] tag whenever you mention a product.
            2. If lead info (Name/Phone) is shared, end reply with [LEAD_DATA: Name | Phone | Interest].
            3. Answer in the user's language (Sinhala/English).
        `;

        // 4. History (Last 4 messages)
        const { data: history } = await supabase.from('conversations').select('role, content').eq('session_id', session_id).order('created_at', { ascending: false }).limit(4);
        
        const messages = [
            { role: "system", content: systemPrompt },
            ...(history || []).reverse().map(h => ({ role: h.role, content: h.content })),
            { role: "user", content: message }
        ];

        // 5. AI Call
        const aiReply = await callAIWithFailover(messages, plan);

        // 6. Post-Processing (Leads & Telegram)
        if (aiReply.includes("[LEAD_DATA:")) {
            const leadRaw = aiReply.match(/\[LEAD_DATA: (.*?)\]/)?.[1];
            const [name, phone, interest] = leadRaw.split('|').map(s => s.trim());
            await supabase.from('leads').insert([{ client_id, customer_name: name, customer_phone: phone, interest_summary: interest }]);
            await sendTelegramAlert(config.clients.telegram_chat_id, `🎯 *New Lead!*\n\nName: ${name}\nPhone: ${phone}\nInterest: ${interest}`);
        }

        // 7. Save & Update Usage
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
