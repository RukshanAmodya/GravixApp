import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION (Siddhant nirdharan) ---
// Supabase sobat jodnya mate ani authentication mate setup karne
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// API Key rotation logic - GROQ API keys vaparva mate logic
const getGroqKeys = () => {
    return Object.keys(process.env)
        .filter(key => key.startsWith('GROQ_KEY_'))
        .map(key => process.env[key]);
};

// Telegram Bot Token environment variable madhun ghetle ahe
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export const handler = async (event) => {
    // 1. CORS Preflight Handling (CORS parikshan)
    // Browser madhun OPTIONS request aalyas tyala parvangi dene
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

    // Fakt POST request la parvangi ahe
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

        // Client valid ahe ki nahi he tapasne (Client validation)
        const { data: client, error: clientErr } = await supabase
            .from('clients').select('*').eq('id', client_id).single();

        if (clientErr || !client || client.status !== 'active') {
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ error: "Unauthorized or Inactive Client" })
            };
        }

        // --- MODULE: AI CHAT (Nivadlelaya model nusar AI pratikriya) ---
        // Qgent-starter ani qgent-pro sathi logic
        if (type === "chat") {
            const { session_id, message, model: requestedModel } = body;
            const keys = getGroqKeys();
            const currentKey = keys[Math.floor(Math.random() * keys.length)];

            // Model mapping logic - Strict openai models vaparne
            let aiModel = ""; 
            if (requestedModel === "qgent-pro") {
                aiModel = "openai/gpt-oss-120b";
            } else if (requestedModel === "qgent-starter") {
                aiModel = "openai/gpt-oss-20b";
            } else {
                return {
                    statusCode: 400,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                    body: JSON.stringify({ error: "Invalid model ID. Use 'qgent-starter' or 'qgent-pro'." }),
                };
            }

            // Juni pratikriya (Context history) milvne
            const { data: history } = await supabase
                .from('conversations').select('role, content')
                .eq('session_id', session_id).order('created_at', { ascending: false }).limit(4);
            const formattedHistory = history ? history.reverse().map(h => ({ role: h.role, content: h.content })) : [];

            // AI API Call (Groq) - Nivadlelaya model pramane call jane
            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${currentKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: aiModel,
                    messages: [
                        { 
                            role: "system", 
                            content: "Powered by Questra." 
                        },
                        ...formattedHistory,
                        { role: "user", content: message }
                    ],
                    temperature: 0.7
                })
            });

            const aiData = await groqResponse.json();
            const botReply = aiData.choices?.[0]?.message?.content || "AI Error: Unable to fetch response.";

            // Database update (Sanvad ani usage logs save karne)
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
                body: JSON.stringify({ 
                    reply: botReply, 
                    model_id: requestedModel,
                    engine: aiModel 
                }),
            };
        }

        // --- MODULE: NOTIFICATIONS (Telegram Alert sathi module) ---
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
            body: JSON.stringify({ error: "Internal Server Error", details: error.message }),
        };
    }
};
