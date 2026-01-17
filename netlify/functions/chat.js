import { createClient } from '@supabase/supabase-js';

// 1. Supabase Connection
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// 2. Multi-API Failover Logic (Groq & Gemini)
async function callAIWithFailover(messages, plan) {
    const providers = [
        { name: 'Groq', model: plan === 'Pro' ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant', url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY },
        { name: 'Gemini', model: 'gemini-1.5-pro', url: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, key: process.env.GEMINI_API_KEY }
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
        } catch (e) { console.error(`${provider.name} failed, trying next...`); }
    }
    throw new Error("All AI Providers failed.");
}

// 3. Telegram Alert System
async function sendTelegramAlert(chatId, text) {
    if (!chatId) return;
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
    });
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { client_id, session_id, message } = req.body;

        // 1. Fetch Business Config, Plan, and Products
        const { data: config } = await supabase.from('bot_configs').select('*, clients(*)').eq('client_id', client_id).single();
        const { data: products } = await supabase.from('products').select('*').eq('client_id', client_id);
        const { data: usage } = await supabase.from('usage_logs').select('chat_count').eq('client_id', client_id).eq('usage_date', new Date().toISOString().split('T')[0]).single();

        if (!config || config.clients.status !== 'Active') return res.status(403).json({ reply: "Service Suspended." });

        // 2. Check Plan-based Limits (Lite: 30, Standard: 70, Pro: 150)
        const limits = { 'Lite': 30, 'Standard': 70, 'Pro': 150 };
        const currentCount = usage?.chat_count || 0;
        if (currentCount >= limits[config.clients.plan_type]) {
            return res.status(200).json({ reply: "Daily limit reached. Our team will contact you soon!" });
        }

        // 3. Dynamic Knowledge Base & Image Injection
        const productList = products.map(p => 
            `● ${p.name}: ${p.description} (Price: Rs. ${p.price}) [IMAGE: ${p.image_url}]`
        ).join('\n');

        // 4. Construct Master System Prompt
        const systemPrompt = `
            Identity: You are ${config.bot_name}, a staff member of ${config.clients.business_name}.
            Persona: ${config.system_prompt}
            Knowledge: ${config.knowledge_base}
            Products: 
            ${productList}

            RULES:
            1. Language: Answer in the user's language (Sinhala, English, or Singlish).
            2. Images: When a user asks about a product, you MUST include its [IMAGE: URL] tag in the reply.
            3. Leads: If user wants to buy/book, ask for Name and WhatsApp Number.
            4. Tags: When lead info is shared, end your message with [LEAD_DATA: Name | Phone | Interest].
        `;

        // 5. Context Memory (Fetch last 6 messages)
        const { data: history } = await supabase.from('conversations').select('role, content').eq('session_id', session_id).order('created_at', { ascending: false }).limit(6);
        const messages = [
            { role: "system", content: systemPrompt },
            ...(history || []).reverse().map(h => ({ role: h.role, content: h.content })),
            { role: "user", content: message }
        ];

        // 6. Call AI
        const aiReply = await callAIWithFailover(messages, config.clients.plan_type);

        // 7. Post-Processing: Telegram Alerts & Lead Logging
        if (aiReply.includes("[LEAD_DATA:")) {
            const leadInfo = aiReply.match(/\[LEAD_DATA: (.*?)\]/)?.[1];
            await supabase.from('leads').insert([{ client_id, customer_name: leadInfo.split('|')[0], customer_phone: leadInfo.split('|')[1], interest_summary: leadInfo.split('|')[2] }]);
            await sendTelegramAlert(config.clients.telegram_chat_id, `🎯 *New Lead for ${config.clients.business_name}*\n\nDetails: ${leadInfo}`);
        }

        // 8. Update Usage & History
        await supabase.rpc('increment_usage', { client_uid: client_id }); // Create a simple SQL function for this
        await supabase.from('conversations').insert([
            { client_id, session_id, role: 'user', content: message },
            { client_id, session_id, role: 'assistant', content: aiReply.replace(/\[LEAD_DATA: .*?\]/, "").trim() }
        ]);

        return res.status(200).json({ reply: aiReply.replace(/\[LEAD_DATA: .*?\]/, "").trim() });

    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "System encountered an error." });
    }
}
