import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION (Samsiddhigollisu) ---
// Supabase connection mattu authentication set-up
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Chavee badalavane (Key Rotation) logic - GROQ API keys balasuva thara
const getGroqKeys = () => {
    return Object.keys(process.env)
        .filter(key => key.startsWith('GROQ_KEY_'))
        .map(key => process.env[key]);
};

// Telegram Bot Token environment variable inda tharuvudu
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export const handler = async (event) => {
    // CORS Preflight Handling (CORS parikshe mattu anumathi)
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

    // Kevala POST requests ge mathra anumathi ide
    if (event.httpMethod !== "POST") {
        return { 
            statusCode: 405, 
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ error: "Method Not Allowed" }) 
        };
    }

    try {
        const body = JSON.parse(event.body);
        const { client_id, type } = body;

        // Client authentication parikshe
        const { data: client, error: clientErr } = await supabase
            .from('clients').select('*').eq('id', client_id).single();

        if (clientErr || !client || client.status !== 'active') {
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ error: "Unauthorized or Inactive Client" })
            };
        }

        // --- MODULE: AI CHAT ---
        if (type === "chat") {
            const { session_id, message } = body;
            const keys = getGroqKeys();
            const currentKey = keys[Math.floor(Math.random() * keys.length)];

            // Conversation history tharuvudu (Context persistence)
            const { data: history } = await supabase
                .from('conversations').select('role, content')
                .eq('session_id', session_id).order('created_at', { ascending: false }).limit(4);
            const formattedHistory = history ? history.reverse().map(h => ({ role: h.role, content: h.content })) : [];

            // AI API Call (Groq)
            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${currentKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: `You are Ria, AI assistant for ${client.name}. Provide concise English answers.` },
                        ...formattedHistory,
                        { role: "user", content: message }
                    ],
                    temperature: 0.7
                })
            });

            const aiData = await groqResponse.json();
            const botReply = aiData.choices?.[0]?.message?.content || "API Error: No response from AI.";

            // Database update (Conversation logs)
            await Promise.all([
                supabase.from('conversations').insert([
                    { client_id, session_id, role: 'user', content: message },
                    { client_id, session_id, role: 'assistant', content: botReply }
                ]),
                supabase.rpc('increment_usage', { cid: client_id })
            ]);

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ reply: botReply }),
            };
        }

        // --- MODULE: NOTIFICATIONS (Telegram) ---
        if (type === "notify") {
            const { notification_text } = body;

            if (client.telegram_chat_id && TG_TOKEN) {
                const tgRes = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: client.telegram_chat_id,
                        text: notification_text,
                        parse_mode: 'Markdown'
                    })
                });
                
                const tgData = await tgRes.json();
                return {
                    statusCode: 200,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                    body: JSON.stringify({ success: tgData.ok }),
                };
            }
        }

        return {
            statusCode: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ error: "Invalid Request Type" }),
        };

    } catch (error) {
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ error: "Server Error", details: error.message }),
        };
    }
};
