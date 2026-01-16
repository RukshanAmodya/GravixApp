import { createClient } from '@supabase/supabase-js';

// Supabase Connection
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const getGroqKeys = () => {
    return Object.keys(process.env)
        .filter(key => key.startsWith('GROQ_KEY_'))
        .map(key => process.env[key]);
};

export const handler = async (event) => {
    // CORS Preflight
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST" }, body: "OK" };
    }

    try {
        const body = JSON.parse(event.body);
        const { client_id, session_id, message } = body;

        // 1. Client සහ ඒට අදාළ Products විස්තර ලබාගැනීම
        const [clientRes, productsRes] = await Promise.all([
            supabase.from('clients').select('*').eq('id', client_id).single(),
            supabase.from('products').select('*').eq('client_id', client_id)
        ]);

        const client = clientRes.data;
        const products = productsRes.data || [];

        if (!client || client.status !== 'active') {
            return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ reply: "Service locked." }) };
        }

        // 2. AI Persona සැකසීම (මෘදු සහ සහාය දක්වන ආකාරයට)
        const productsList = products.map(p => `- ${p.name}: Rs. ${p.price} (${p.description || 'No specific details'})`).join('\n');
        
        const systemPrompt = `
        You are ${client.ai_name || 'Assistant'}, a helpful brand ambassador for ${client.name}.
        
        IDENTITY RULES:
        - NEVER say you are an AI, ChatGPT, or OpenAI. 
        - Act like a human staff member. 
        - DO NOT mention "Powered by Questra" or any platform names.
        
        BEHAVIOR RULES:
        - Your first priority is to be warm, welcoming, and helpful. 
        - DO NOT push for sales or mention prices in the first greeting unless explicitly asked.
        - If a user says "Hi", just welcome them kindly and ask how you can help.
        - Speak like a friendly support agent, not a pushy salesman.
        
        KNOWLEDGE BASE:
        - Business Name: ${client.name}
        - Persona Instructions: ${client.instructions || 'Be very polite.'}
        - Available Products & Details:
        ${productsList}
        
        - If a user asks about how a product is made or its details, use the descriptions provided in the list above to explain. 
        - If information is missing, be creative but stay professional.
        
        TONE: Warm, helpful. Avoid robotic answers.`;

        // 3. Conversation History
        const { data: history } = await supabase
            .from('conversations').select('role, content')
            .eq('session_id', session_id).order('created_at', { ascending: false }).limit(6);
        const formattedHistory = history ? history.reverse().map(h => ({ role: h.role, content: h.content })) : [];

        // 4. AI API Call
        const keys = getGroqKeys();
        const currentKey = keys[Math.floor(Math.random() * keys.length)];

        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: "openai/gpt-oss-20b",
                messages: [
                    { role: "system", content: systemPrompt },
                    ...formattedHistory,
                    { role: "user", content: message }
                ],
                temperature: 0.6 // වැඩිපුර නිර්මාණශීලී වීමට
            })
        });

        const aiData = await groqResponse.json();
        const botReply = aiData.choices?.[0]?.message?.content || "I'm here to help, what can I do for you?";

        // 5. Save logs
        await supabase.from('conversations').insert([
            { client_id, session_id, role: 'user', content: message },
            { client_id, session_id, role: 'assistant', content: botReply }
        ]);

        return {
            statusCode: 200,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ reply: botReply }),
        };

    } catch (error) {
        return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: error.message }) };
    }
};
