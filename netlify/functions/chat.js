import { createClient } from '@supabase/supabase-js';

// Supabase සම්බන්ධතාවය
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const getGroqKeys = () => {
    return Object.keys(process.env).filter(k => k.startsWith('GROQ_KEY_')).map(k => process.env[k]);
};

// Telegram Alert යවන Function එක
async function sendAlert(chatId, text) {
    if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return;
    try {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
        });
    } catch (e) { console.error("Telegram Error", e); }
}

export const handler = async (event) => {
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST" }, body: "OK" };

    try {
        const { client_id, session_id, message } = JSON.parse(event.body);

        // 1. Client සහ වර්තමාන භාවිතය පරීක්ෂා කිරීම
        const { data: client } = await supabase.from('clients').select('*').eq('id', client_id).single();

        if (!client || client.status !== 'active') return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ reply: "Service locked." }) };

        // Usage Check (BI Feature)
        if (client.current_usage >= client.daily_limit) {
            await sendAlert(client.telegram_chat_id, `⚠️ *Usage Alert:* Daily limit reached for ${client.name}.`);
            return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ reply: "Our assistant is resting for today. Please contact us directly!" }) };
        }

        // 2. System Prompt - සියලුම විකුණුම් සහ සහාය නීති ඇතුළත් කිරීම
        const systemPrompt = `
        Identity: You are ${client.ai_name}, a professional human assistant for ${client.name}.
        
        GOALS:
        1. Support: Answer FAQs (Hours, Location, Services) using: ${client.instructions}.
        2. Sales: If they want to buy, ask for Name, WhatsApp Number, and Address.
        3. Lead Scoring: If they share a phone number or ask for prices, tag the interest as "HOT". 
        
        STRICT RULES:
        - NEVER say you are an AI. 
        - If someone provides a name and phone, output: [LEAD_CAPTURE: Name, Phone].
        - If an order is finalized, output: [ORDER_CONFIRMED: Items, Total].
        - Language: Respond in the language used by the customer (Sinhala/English).
        - No Tables. Use bullets (●).
        - Currency: Use ${client.currency}.
        - Do not push sales in the first "Hi". Be warm first.
        `;

        // 3. Context Fetch
        const { data: history } = await supabase.from('conversations').select('role, content').eq('session_id', session_id).order('created_at', { ascending: false }).limit(6);
        const formattedHistory = (history || []).reverse().map(h => ({ role: h.role, content: h.content }));

        // 4. AI API Call
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getGroqKeys()[0]}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: "openai/gpt-oss-20b",
                messages: [{ role: "system", content: systemPrompt }, ...formattedHistory, { role: "user", content: message }],
                temperature: 0.5
            })
        });

        const aiData = await groqResponse.json();
        let botReply = aiData.choices?.[0]?.message?.content || "I'm here to help.";

        // 5. Logic Tasks (Admin & Logic Features)
        // Lead Capture Logic
        if (botReply.includes("[LEAD_CAPTURE:")) {
            const isHot = message.length > 10 ? "Hot" : "Warm";
            await supabase.from('leads').insert([{ client_id, customer_name: "Captured User", whatsapp_number: "Check History", interest_level: isHot, last_message: message }]);
            await sendAlert(client.telegram_chat_id, `🎯 *New Lead Captured!*\nInterest: ${isHot}\nMessage: ${message}`);
            botReply = botReply.replace(/\[LEAD_CAPTURE:.*\]/, "").trim();
        }

        // Order Confirmation Logic
        if (botReply.includes("[ORDER_CONFIRMED:")) {
            await supabase.from('orders').insert([{ client_id, customer_name: "Customer", order_details: message }]);
            await sendAlert(client.telegram_chat_id, `📦 *New Order Received!*\nDetails: ${message}`);
            botReply = botReply.replace(/\[ORDER_CONFIRMED:.*\]/, "Great! I've recorded your order. Our team will contact you shortly.").trim();
        }

        // Increment Usage
        await supabase.from('clients').update({ current_usage: client.current_usage + 1 }).eq('id', client_id);

        // Save Conversation
        await supabase.from('conversations').insert([{ client_id, session_id, role: 'user', content: message }, { client_id, session_id, role: 'assistant', content: botReply }]);

        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ reply: botReply }) };

    } catch (error) { return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: error.message }) }; }
};
