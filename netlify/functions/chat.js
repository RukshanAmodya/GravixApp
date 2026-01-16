import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const getGroqKeys = () => {
    return Object.keys(process.env).filter(k => k.startsWith('GROQ_KEY_')).map(k => process.env[k]);
};

export const handler = async (event) => {
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST" }, body: "OK" };
    }

    try {
        const { client_id, session_id, message } = JSON.parse(event.body);

        // 1. ව්‍යාපාරික විස්තර සහ දැනුම ලබා ගැනීම
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

        // 2. දැනුම් පද්ධතිය (Product/Service Knowledge)
        const knowledgeBase = products.map(p => `NAME: ${p.name}\nPRICE: ${currency} ${p.price}\nDETAILS: ${p.description || 'N/A'}`).join('\n\n');
        
        // 3. UNIVERSAL SYSTEM PROMPT (ඕනෑම ව්‍යාපාරයකට පොදු නීති)
        const systemPrompt = `
        CORE IDENTITY:
        - You are ${client.ai_name}, a helpful human staff member of "${client.name}".
        - Act according to the specific nature of ${client.name}.
        
        STRICT LIMITATIONS (DO NOT BREAK THESE):
        1. NO AI MENTION: Never say you are an AI, a language model, or "ChatGPT". If asked who you are, say "I am ${client.ai_name} from ${client.name}."
        2. NO TABLES: Never use Markdown tables (|---|). If listing items, use bullet points (●) or a simple list.
        3. NO THIRD-PARTY BRANDING: Do not mention "Powered by Questra", "OpenAI", or any other platforms.
        4. FIRST GREETING: If the user says "Hi" or "Hello", just welcome them warmly. DO NOT talk about products or prices until they ask.
        5. CURRENCY: Always use "${currency}" for money.
        
        KNOWLEDGE BASE (ONLY use information from here):
        ${knowledgeBase}
        
        BUSINESS GUIDELINES:
        ${client.instructions || 'Provide polite and professional support.'}
        
        TONE: 
        Professional, friendly, and eager to help. Be concise.`;

        // 4. චැට් මතකය ලබා ගැනීම (Context)
        const { data: history } = await supabase.from('conversations').select('role, content').eq('session_id', session_id).order('created_at', { ascending: false }).limit(6);
        const formattedHistory = (history || []).reverse().map(h => ({ role: h.role, content: h.content }));

        // 5. AI API Call (Groq)
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getGroqKeys()[0]}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: "openai/gpt-oss-20b",
                messages: [{ role: "system", content: systemPrompt }, ...formattedHistory, { role: "user", content: message }],
                temperature: 0.4 // වඩාත් ස්ථාවර පිළිතුරු සඳහා
            })
        });

        const aiData = await groqResponse.json();
        const botReply = aiData.choices?.[0]?.message?.content || "How can I help you?";

        // 6. චැට් එක සේව් කිරීම
        await supabase.from('conversations').insert([
            { client_id, session_id, role: 'user', content: message },
            { client_id, session_id, role: 'assistant', content: botReply }
        ]);

        return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ reply: botReply }) };

    } catch (error) {
        return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: error.message }) };
    }
};
