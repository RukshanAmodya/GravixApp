import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const getGroqKeys = () => {
    return Object.keys(process.env).filter(k => k.startsWith('GROQ_KEY_')).map(k => process.env[k]);
};

export const handler = async (event) => {
    if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST" }, body: "OK" };

    try {
        const { client_id, session_id, message } = JSON.parse(event.body);

        // Fetch Client and their specific knowledge/products
        const [clientRes, productsRes] = await Promise.all([
            supabase.from('clients').select('*').eq('id', client_id).single(),
            supabase.from('products').select('*').eq('client_id', client_id)
        ]);

        const client = clientRes.data;
        const products = productsRes.data || [];
        const currency = client.currency || 'LKR';

        if (!client || client.status !== 'active') return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ reply: "Service locked." }) };

        // Knowledge Base setup
        const knowledge = products.map(p => `ITEM: ${p.name}\nPRICE: ${currency} ${p.price}\nDETAILS: ${p.description || 'No extra info'}`).join('\n\n');
        
        const systemPrompt = `
        Identity: You are ${client.ai_name || 'Assistant'} from ${client.name}.
        Strict Rules:
        1. NO Markdown Tables. If listing items, use bullet points (●) or a clean list.
        2. NEVER say you are AI or from OpenAI. Act as a human employee.
        3. Tone: Warm, welcoming, and helpful. Be supportive.
        4. First Interaction: If the user says "Hi/Hello", DO NOT push for sales. Just welcome them warmly.
        5. Currency: Strictly use ${currency} for all prices. NEVER use any other currency symbol.
        
        Knowledge Base:
        ${knowledge}
        
        Persona Instructions:
        ${client.instructions || 'Be helpful.'}
        
        Note: When asked about ingredients or how something is made, use the 'DETAILS' section from the knowledge base above.`;

        const { data: history } = await supabase.from('conversations').select('role, content').eq('session_id', session_id).order('created_at', { ascending: false }).limit(6);
        const formattedHistory = (history || []).reverse().map(h => ({ role: h.role, content: h.content }));

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
        const botReply = aiData.choices?.[0]?.message?.content || "I'm here to help.";

        await supabase.from('conversations').insert([{ client_id, session_id, role: 'user', content: message }, { client_id, session_id, role: 'assistant', content: botReply }]);

        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ reply: botReply }) };
    } catch (error) { return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: error.message }) }; }
};
