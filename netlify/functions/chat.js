import { createClient } from '@supabase/supabase-js';

// Supabase samparka (Database Connection)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const getGroqKeys = () => {
    return Object.keys(process.env).filter(k => k.startsWith('GROQ_KEY_')).map(k => process.env[k]);
};

// Telegram alert pathavane (Send Telegram Alert)
async function sendAlert(chatId, text) {
    if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return;
    try {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
        });
    } catch (e) { console.error("Telegram error", e); }
}

export const handler = async (event) => {
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST" }, body: "OK" };

    try {
        const { client_id, session_id, message } = JSON.parse(event.body);

        // Message tapasane (Input validation)
        if (!message || message.length > 600) {
            return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ reply: "Message too long or empty." }) };
        }

        // 1. Client ani Knowledge base mahiti ghene (Fetch data)
        const [clientRes, productsRes] = await Promise.all([
            supabase.from('clients').select('*').eq('id', client_id).single(),
            supabase.from('products').select('*').eq('client_id', client_id)
        ]);

        const client = clientRes.data;
        const products = productsRes.data || [];
        const currency = client.currency || 'LKR';

        if (!client || client.status !== 'active') return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ reply: "Service locked." }) };

        // Maryada tapasane (Usage check - BI Feature)
        if (client.current_usage >= client.daily_limit) {
            return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ reply: "Daily limit reached. Please contact us directly." }) };
        }

        const knowledge = products.map(p => `ITEM: ${p.name}, PRICE: ${currency} ${p.price}, INFO: ${p.description}`).join('\n');
        
        // 2. Strict AI Identity ani Rules
        const systemPrompt = `
        Identity: You are ${client.ai_name}, human staff of "${client.name}".
        
        RULES:
        1. ONLY use info from KNOWLEDGE base below. If not there, say you don't know.
        2. NO TABLES. Use bullet points (●).
        3. NO BRANDING: Do not mention OpenAI or Questra.
        4. SALES: If user wants to buy, collect: Name, Phone, Address.
        5. OUTPUT TAGS: 
           - When order is ready: [ORDER_DATA: {Details}]
           - When contact info is shared: [LEAD_DATA: {Details}]
        
        KNOWLEDGE:
        ${knowledge || 'Currently no items available.'}
        
        GUIDELINES:
        ${client.instructions || 'Be professional and polite.'}
        `;

        // 3. Context Management (Memory pruning to prevent hallucinations)
        const { data: history } = await supabase.from('conversations').select('role, content').eq('session_id', session_id).order('created_at', { ascending: false }).limit(4);
        const formattedHistory = (history || []).reverse().map(h => ({ role: h.role, content: h.content }));

        // 4. Groq AI call
        const keys = getGroqKeys();
        const currentKey = keys[Math.floor(Math.random() * keys.length)];

        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: "openai/gpt-oss-20b",
                messages: [{ role: "system", content: systemPrompt }, ...formattedHistory, { role: "user", content: message }],
                temperature: 0.1 // Accuracy sathi (For high accuracy)
            })
        });

        const aiData = await groqResponse.json();
        let botReply = aiData.choices?.[0]?.message?.content || "Help needed?";

        // 5. Processing Leads ani Orders (Logic Tasks)
        if (botReply.includes("[ORDER_DATA:")) {
            const orderDetail = botReply.match(/\[ORDER_DATA: (.*?)\]/)?.[1];
            await supabase.from('orders').insert([{ client_id, order_details: orderDetail }]);
            await sendAlert(client.telegram_chat_id, `📦 *NAVEEN ORDER!* (New Order)\n\nDetails: ${orderDetail}`);
            botReply = botReply.replace(/\[ORDER_DATA: .*?\]/, "Order recorded! Our team will contact you.").trim();
        } 
        else if (botReply.includes("[LEAD_DATA:")) {
            const leadDetail = botReply.match(/\[LEAD_DATA: (.*?)\]/)?.[1];
            await supabase.from('leads').insert([{ client_id, last_message: leadDetail, interest_level: 'Hot' }]);
            await sendAlert(client.telegram_chat_id, `🎯 *ALUTH CUSTOMER!* (New Lead)\n\nDetails: ${leadDetail}`);
            botReply = botReply.replace(/\[LEAD_DATA: .*?\]/, "").trim();
        }

        // Usage update mattu Samvad save (Save usage and chat)
        await supabase.from('clients').update({ current_usage: client.current_usage + 1 }).eq('id', client_id);
        await supabase.from('conversations').insert([{ client_id, session_id, role: 'user', content: message }, { client_id, session_id, role: 'assistant', content: botReply }]);

        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ reply: botReply }) };
    } catch (e) { return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "System Error" }) }; }
};
