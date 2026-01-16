import { createClient } from '@supabase/supabase-js';

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

        // Supabase Init
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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
        const keys = Object.keys(process.env)
            .filter(k => k.startsWith('GROQ_KEY_'))
            .map(k => process.env[k]);
        const currentKey = keys[Math.floor(Math.random() * keys.length)];

        // 4. History
        const { data: history } = await supabase
            .from('conversations').select('role, content')
            .eq('session_id', session_id).order('created_at', { ascending: false }).limit(4);
        const formattedHistory = history ? history.reverse().map(h => ({ role: h.role, content: h.content })) : [];

        // 5. Groq AI Call (Using Native Fetch instead of Axios)
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${currentKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: `You are Ria, AI assistant for ${client.name}.` },
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

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ reply: botReply }),
        };

    } catch (error) {
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ reply: "පද්ධතියේ දෝෂයක්.", debug: error.message }),
        };
    }
};
