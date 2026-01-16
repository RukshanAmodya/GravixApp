import { createClient } from '@supabase/supabase-js';

// Supabase setup (Samparka)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const getGroqKeys = () => {
    return Object.keys(process.env).filter(k => k.startsWith('GROQ_KEY_')).map(k => process.env[k]);
};

export const handler = async (event) => {
    // CORS Handling
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST" }, body: "OK" };
    }

    try {
        const { client_id, session_id, message } = JSON.parse(event.body);

        // Fetch Client and Knowledge base
        const [clientRes, productsRes] = await Promise.all([
            supabase.from('clients').select('*').eq('id', client_id).single(),
            supabase.from('products').select('*').eq('client_id', client_id)
        ]);

        const client = clientRes.data;
        const products = productsRes.data || [];
        const currency = client.currency || 'LKR';

        if (!client || client.status !== 'active') {
            return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ reply: "Service is currently offline." }) };
        }

        // Build Knowledge Base String
        const knowledge = products.map(p => `ITEM: ${p.name}\nPRICE: ${currency} ${p.price}\nDETAILS: ${p.description || 'Ask for more info'}`).join('\n\n');
        
        // UNIVERSAL SYSTEM PROMPT (Strict identity lock)
        const systemPrompt = `
        CORE IDENTITY:
        - You are ${client.ai_name}, a friendly human staff member of "${client.name}".
        - Strictly follow the professional nature of ${client.name}.
        
        STRICT RULES:
        1. NEVER mention you are an AI, language model, or "ChatGPT". If asked, say "I am ${client.ai_name} from ${client.name}."
        2. NO MARKDOWN TABLES. Use clear bullet points (●) for lists.
        3. NO THIRD-PARTY BRANDING: Never say "Powered by Questra" or "OpenAI".
        4. FIRST GREETING: If user says "Hi" or "Hello", welcome them warmly. DO NOT talk about prices or selling immediately. Ask how you can help.
        5. CURRENCY: Strictly use "${currency}" for all money values.
        
        KNOWLEDGE BASE (Our Products/Services):
        ${knowledge}
        
        BUSINESS GUIDELINES:
        ${client.instructions || 'Be helpful and professional.'}
        
        TONE: 
        Warm, supportive, and natural. Do not be pushy or robotic.`;

        // Context Memory
        const { data: history } = await supabase.from('conversations').select('role, content').eq('session_id', session_id).order('created_at', { ascending: false }).limit(6);
        const formattedHistory = (history || []).reverse().map(h => ({ role: h.role, content: h.content }));

        // AI Request
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
        const botReply = aiData.choices?.[0]?.message?.content || "I'm here to help, please ask me anything.";

        // Save Conversation
        await supabase.from('conversations').insert([
            { client_id, session_id, role: 'user', content: message },
            { client_id, session_id, role: 'assistant', content: botReply }
        ]);

        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ reply: botReply }) };

    } catch (error) {
        return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: error.message }) };
    }
};
