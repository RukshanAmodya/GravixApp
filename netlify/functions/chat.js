import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const getGroqKeys = () => {
    return Object.keys(process.env)
        .filter(key => key.startsWith('GROQ_KEY_'))
        .map(key => process.env[key]);
};

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export const handler = async (event) => {
    // 1. CORS Preflight Handling
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            },
            body: "OK",
        };
    }

    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const { client_id, session_id, message } = JSON.parse(event.body);

        // 2. Client Check
        const { data: client, error: clientErr } = await supabase
            .from('clients').select('*').eq('id', client_id).single();

        if (clientErr || !client || client.status !== 'active') {
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ reply: "සේවාව තාවකාලිකව අත්හිටුවා ඇත." })
            };
        }

        // 3. Key Rotation
        const keys = getGroqKeys();
        const currentKey = keys[Math.floor(Math.random() * keys.length)];

        // 4. History (Context)
        const { data: history } = await supabase
            .from('conversations').select('role, content')
            .eq('session_id', session_id).order('created_at', { ascending: false }).limit(4);
        const formattedHistory = history ? history.reverse().map(h => ({ role: h.role, content: h.content })) : [];

        // 5. Groq AI Call
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${currentKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: `You are Ria, AI assistant for ${client.name}. Help customers in Sinhala/English.` },
                    ...formattedHistory,
                    { role: "user", content: message }
                ],
                temperature: 0.7
            })
        });

        const aiData = await groqResponse.json();
        const botReply = aiData.choices[0].message.content;

        // 6. DB Updates
        await Promise.all([
            supabase.from('conversations').insert([
                { client_id, session_id, role: 'user', content: message },
                { client_id, session_id, role: 'assistant', content: botReply }
            ]),
            supabase.rpc('increment_usage', { cid: client_id })
        ]);

        // 7. Telegram Alert Logic (Improved)
        const orderKeywords = ["order", "ගන්න", "මිල", "කීයද", "ඇණවුම", "price"];
        const isLead = orderKeywords.some(kw => message.toLowerCase().includes(kw));

        if (isLead && client.telegram_chat_id && TG_TOKEN) {
            try {
                await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: client.telegram_chat_id,
                        text: `🔔 *New Order Lead!*\n\n*Business:* ${client.name}\n*User:* ${message}\n\n*AI Reply:* ${botReply}`,
                        parse_mode: 'Markdown'
                    })
                });
            } catch (tgErr) {
                console.error("Telegram API Error:", tgErr.message);
            }
        }

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ reply: botReply }),
        };

    } catch (error) {
        console.error("Critical Error:", error.message);
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ reply: "පද්ධතියේ දෝෂයක්.", debug: error.message }),
        };
    }
};
