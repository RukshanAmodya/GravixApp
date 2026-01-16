import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION ---
// Supabase connection settings
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// API Key rotation logic
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
        return { statusCode: 405, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Method Not Allowed" }) };
    }

    try {
        const body = JSON.parse(event.body);
        const { client_id, type, system_prompt } = body; // system_prompt එක Frontend එකෙන් බලාපොරොත්තු වෙනවා

        // 2. Client Authentication
        const { data: client, error: clientErr } = await supabase
            .from('clients').select('*').eq('id', client_id).single();

        if (clientErr || !client || client.status !== 'active') {
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Add-Origin": "*" },
                body: JSON.stringify({ reply: "Service unavailable." })
            };
        }

        if (type === "chat") {
            const { session_id, message, model: requestedModel } = body;
            const keys = getGroqKeys();
            const currentKey = keys[Math.floor(Math.random() * keys.length)];

            let aiModel = requestedModel === "qgent-pro" ? "openai/gpt-oss-120b" : "openai/gpt-oss-20b";

            // Conversation history (Context)
            const { data: history } = await supabase
                .from('conversations').select('role, content')
                .eq('session_id', session_id).order('created_at', { ascending: false }).limit(4);
            const formattedHistory = history ? history.reverse().map(h => ({ role: h.role, content: h.content })) : [];

            // මෙතැනදී තමයි වෙනස වෙන්නේ - Frontend එකෙන් system_prompt එකක් එවුවොත් ඒක පාවිච්චි කරනවා
            const finalSystemPrompt = system_prompt || `You are an AI assistant for ${client.name}. Powered by Questra.`;

            // AI API Call
            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${currentKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: aiModel,
                    messages: [
                        { role: "system", content: finalSystemPrompt },
                        ...formattedHistory,
                        { role: "user", content: message }
                    ],
                    temperature: 0.7
                })
            });

            const aiData = await groqResponse.json();
            const botReply = aiData.choices?.[0]?.message?.content || "API Error.";

            // Save conversation
            await Promise.all([
                supabase.from('conversations').insert([{ client_id, session_id, role: 'user', content: message }, { client_id, session_id, role: 'assistant', content: botReply }]),
                supabase.rpc('increment_usage', { cid: client_id })
            ]);

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ reply: botReply }),
            };
        }

        // Module: Notify
        if (type === "notify") {
            const { notification_text } = body;
            if (client.telegram_chat_id && TG_TOKEN) {
                const tgRes = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: client.telegram_chat_id, text: notification_text, parse_mode: 'Markdown' })
                });
                const tgData = await tgRes.json();
                return { statusCode: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ success: tgData.ok }) };
            }
        }

        return { statusCode: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Invalid Request" }) };

    } catch (error) {
        return { statusCode: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Internal Error" }) };
    }
};
