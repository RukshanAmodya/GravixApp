import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

// Netlify Function Handler
export const handler = async (event) => {
    
    // 1. CORS Preflight (OPTIONS Request) හැසිරවීම
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

        // 2. Client පරීක්ෂාව
        const { data: client, error: clientErr } = await supabase
            .from('clients')
            .select('*')
            .eq('id', client_id)
            .single();

        if (clientErr || !client || client.status !== 'active') {
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ reply: "ඔබේ සේවාව තාවකාලිකව අත්හිටුවා ඇත. කරුණාකර අප හා සම්බන්ධ වන්න." })
            };
        }

        // 3. Key Rotation
        const keys = Object.keys(process.env)
            .filter(k => k.startsWith('GROQ_KEY_'))
            .map(k => process.env[k]);
        
        const currentKey = keys[Math.floor(Math.random() * keys.length)];

        // 4. History (Context) ලබාගැනීම
        const { data: history } = await supabase
            .from('conversations')
            .select('role, content')
            .eq('session_id', session_id)
            .order('created_at', { ascending: false })
            .limit(4);

        const formattedHistory = history ? history.reverse().map(h => ({ role: h.role, content: h.content })) : [];

        // 5. Groq AI Call
        const aiResponse = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: `You are Ria, the helpful AI assistant for ${client.name}. Respond politely.` },
                ...formattedHistory,
                { role: "user", content: message }
            ],
            temperature: 0.7
        }, {
            headers: { 'Authorization': `Bearer ${currentKey}` }
        });

        const botReply = aiResponse.data.choices[0].message.content;

        // 6. DB Updates (Background)
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
        console.error("Netlify Function Error:", error.message);
        return {
            statusCode: 200, // Error එකකදීත් 200 දීමෙන් CORS Block වීම වැළැක්විය හැක
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ reply: "සමාවන්න, පද්ධතියේ දෝෂයක්. නැවත උත්සාහ කරන්න.", debug: error.message }),
        };
    }
};
