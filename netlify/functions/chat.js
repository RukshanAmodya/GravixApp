import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const getGroqKeys = () => {
    return Object.keys(process.env).filter(k => k.startsWith('GROQ_KEY_')).map(k => process.env[k]);
};

// Telegram වෙත පණිවිඩ යැවීමේ Function එක
async function sendTelegram(botToken, chatId, text) {
    if (!botToken || !chatId) return;
    try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
        });
    } catch (e) { console.error("Telegram Error:", e); }
}

export const handler = async (event) => {
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST" }, body: "OK" };

    try {
        const { client_id, session_id, message } = JSON.parse(event.body);

        const [clientRes, productsRes] = await Promise.all([
            supabase.from('clients').select('*').eq('id', client_id).single(),
            supabase.from('products').select('*').eq('client_id', client_id)
        ]);

        const client = clientRes.data;
        const products = productsRes.data || [];
        const currency = client.currency || 'LKR';

        if (!client || client.status !== 'active') return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ reply: "Service offline." }) };

        const knowledge = products.map(p => `ITEM: ${p.name}\nPRICE: ${currency} ${p.price}\nDETAILS: ${p.description}`).join('\n\n');
        
        // AI එකට ඇණවුම් ලබාගැනීම පිළිබඳ විශේෂ උපදෙස් (Universal Prompt)
        const systemPrompt = `
        You are ${client.ai_name}, a real human staff member of "${client.name}".
        
        ORDERING PROCESS:
        - When a customer wants to buy something, ask for their: 1. Full Name, 2. Phone Number, 3. Delivery Address.
        - Once they provide ALL details, summarize the order and strictly include the phrase "ORDER_CONFIRMED" in your response. 
        - DO NOT ask for payment receipts. Tell them: "Your order has been recorded. Our team will contact you shortly for confirmation and delivery."
        
        IDENTITY RULES:
        - NEVER say you are an AI or ChatGPT. 
        - Use bullet points (●) for lists. No tables.
        - Tone: Warm and professional.
        - Currency: Strictly use "${currency}".
        
        KNOWLEDGE:
        ${knowledge}
        
        GUIDELINES:
        ${client.instructions || 'Be helpful.'}`;

        const { data: history } = await supabase.from('conversations').select('role, content').eq('session_id', session_id).order('created_at', { ascending: false }).limit(8);
        const formattedHistory = (history || []).reverse().map(h => ({ role: h.role, content: h.content }));

        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getGroqKeys()[0]}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: "openai/gpt-oss-20b",
                messages: [{ role: "system", content: systemPrompt }, ...formattedHistory, { role: "user", content: message }],
                temperature: 0.4
            })
        });

        const aiData = await groqResponse.json();
        let botReply = aiData.choices?.[0]?.message?.content || "How can I help you?";

        // ඇණවුම තහවුරු වී ඇත්නම් එය Database එකට සහ Telegram එකට යැවීම
        if (botReply.includes("ORDER_CONFIRMED")) {
            botReply = botReply.replace("ORDER_CONFIRMED", "").trim();
            
            // Database එකට ඇණවුම ඇතුළත් කිරීම (සරලව)
            await supabase.from('orders').insert([{
                client_id,
                customer_name: "Chat Customer", 
                order_details: message + " (Recorded via Chat Session: " + session_id + ")"
            }]);

            // Telegram Alert යැවීම
            const alertText = `🔔 *New Order Received!*\n\n*Business:* ${client.name}\n*Session:* ${session_id}\n\n*Customer Context:*\n${message}\n\n_Please check your dashboard for full conversation details._`;
            await sendTelegram(process.env.TELEGRAM_BOT_TOKEN, client.telegram_id, alertText);
        }

        await supabase.from('conversations').insert([{ client_id, session_id, role: 'user', content: message }, { client_id, session_id, role: 'assistant', content: botReply }]);

        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ reply: botReply }) };
    } catch (error) { return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: error.message }) }; }
};
