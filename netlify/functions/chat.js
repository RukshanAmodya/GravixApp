import { createClient } from '@supabase/supabase-js';

// Supabase සම්බන්ධතාවය
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const getGroqKeys = () => {
    return Object.keys(process.env)
        .filter(key => key.startsWith('GROQ_KEY_'))
        .map(key => process.env[key]);
};

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export const handler = async (event) => {
    // 1. CORS Preflight
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
        const { client_id, type, session_id, message, model: requestedModel } = body;

        // 2. Database එකෙන් Agent ගේ නම සහ උපදෙස් ලබාගැනීම
        const { data: client, error: clientErr } = await supabase
            .from('clients').select('*').eq('id', client_id).single();

        if (clientErr || !client || client.status !== 'active') {
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ reply: "Service currently unavailable or locked." })
            };
        }

        if (type === "chat") {
            const keys = getGroqKeys();
            const currentKey = keys[Math.floor(Math.random() * keys.length)];
            let aiModel = requestedModel === "qgent-pro" ? "openai/gpt-oss-120b" : "openai/gpt-oss-20b";

            // 3. AI එකේ Identity එක මෙතැනදී තදින්ම Lock කරනවා
            const aiName = client.ai_name || "Ria";
            const bizName = client.name || "Questra Partner";
            const bizInstructions = client.instructions || "Help customers professionally.";

            const finalSystemPrompt = `
            STRICT IDENTITY RULE: 
            You are ${aiName}, the official AI assistant representing ${bizName}. 
            
            1. NEVER mention you are an AI from OpenAI, ChatGPT, or a large language model.
            2. If someone asks "Who are you?", strictly reply: "I am ${aiName} from ${bizName}."
            3. Use these business rules for all answers: ${bizInstructions}
            4. Keep your tone friendly and always stay in character.
            5. Always mention "Powered by Questra OS" at the very end of your final response part.`;

            // Chat History (Context)
            const { data: history } = await supabase
                .from('conversations').select('role, content')
                .eq('session_id', session_id).order('created_at', { ascending: false }).limit(4);
            const formattedHistory = history ? history.reverse().map(h => ({ role: h.role, content: h.content })) : [];

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
            const botReply = aiData.choices?.[0]?.message?.content || "I am having trouble processing that right now.";

            // Save conversation & Increment usage
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

        // Notify module
        if (type === "notify") {
            const { notification_text } = body;
            if (client.telegram_chat_id && TG_TOKEN) {
                await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: client.telegram_chat_id, text: notification_text, parse_mode: 'Markdown' })
                });
                return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ success: true }) };
            }
        }

    } catch (error) {
        return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Server Error" }) };
    }
};
