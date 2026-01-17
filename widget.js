(function() {
    // 1. Script එකෙන් Client ID එක ලබා ගැනීම
    const scriptTag = document.currentScript;
    const clientId = scriptTag.getAttribute('data-id');
    const backendUrl = 'https://gravixapp.netlify.app/api/chat'; 

    if (!clientId) return console.error("Studio Gravix: Client ID missing!");

    // 2. UI එක සඳහා අවශ්‍ය CSS Inject කිරීම (Shadow DOM පාවිච්චි කිරීම වඩාත් සුදුසුයි)
    const style = document.createElement('style');
    style.innerHTML = `
        #gravix-container { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; position: fixed; bottom: 20px; right: 20px; z-index: 999999; }
        .gravix-button { width: 60px; height: 60px; rounded-full; cursor: pointer; border: none; shadow: 0 4px 15px rgba(0,0,0,0.2); transition: 0.3s; display: flex; items-center; justify-content: center; border-radius: 50%; }
        .gravix-window { position: absolute; bottom: 80px; right: 0; width: 370px; height: 550px; background: #fff; border-radius: 25px; display: none; flex-direction: column; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.15); border: 1px solid #eee; }
        @media (max-width: 480px) { .gravix-window { width: 100vw; height: 100vh; bottom: 0; right: 0; border-radius: 0; position: fixed; } }
        .gravix-header { padding: 20px; color: white; display: flex; align-items: center; gap: 12px; }
        .gravix-messages { flex: 1; padding: 15px; overflow-y: auto; background: #f9f9f9; display: flex; flex-direction: column; gap: 10px; }
        .gravix-msg { padding: 10px 15px; border-radius: 15px; max-width: 80%; font-size: 14px; line-height: 1.4; }
        .gravix-msg.user { background: #0071e3; color: white; align-self: flex-end; border-bottom-right-radius: 2px; }
        .gravix-msg.bot { background: white; color: #333; align-self: flex-start; border-bottom-left-radius: 2px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
        .gravix-input-area { padding: 15px; background: white; border-top: 1px solid #eee; display: flex; gap: 10px; }
        .gravix-input { flex: 1; border: none; background: #f0f0f0; padding: 10px 15px; border-radius: 20px; outline: none; font-size: 14px; }
        .gravix-send { border: none; background: none; color: #0071e3; cursor: pointer; font-weight: bold; }
        .gravix-img { width: 100%; border-radius: 12px; margin-top: 8px; }
    `;
    document.head.appendChild(style);

    // 3. HTML ව්‍යුහය නිර්මාණය
    const container = document.createElement('div');
    container.id = 'gravix-container';
    container.innerHTML = `
        <button class="gravix-button" id="gv-btn">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:white"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        </button>
        <div class="gravix-window" id="gv-window">
            <div class="gravix-header" id="gv-header">
                <div style="width:40px;height:40px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold">G</div>
                <div>
                    <div id="gv-bot-name" style="font-weight:bold;font-size:15px">Assistant</div>
                    <div style="font-size:11px;opacity:0.8">Online</div>
                </div>
            </div>
            <div class="gravix-messages" id="gv-msgs"></div>
            <div class="gravix-input-area">
                <input type="text" class="gravix-input" id="gv-input" placeholder="Ask anything...">
                <button class="gravix-send" id="gv-send">Send</button>
            </div>
            <div style="font-size:9px;text-align:center;padding:5px;color:#ccc;letter-spacing:1px">POWERED BY STUDIO GRAVIX</div>
        </div>
    `;
    document.body.appendChild(container);

    // 4. Dashboard එකෙන් Config ලබා ගැනීම (Handshake)
    async function initWidget() {
        const res = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, action: 'GET_CONFIG' })
        });
        const config = await res.json();
        
        // UI එක Update කිරීම (Dashboard settings අනුව)
        document.getElementById('gv-btn').style.backgroundColor = config.primary_color || '#0071e3';
        document.getElementById('gv-header').style.backgroundColor = config.primary_color || '#0071e3';
        document.getElementById('gv-bot-name').innerText = config.bot_name || 'Assistant';
        document.getElementById('gv-send').style.color = config.primary_color || '#0071e3';
        
        addMessage('bot', config.welcome_message || "Hello! How can I help you?");
    }

    // 5. සංවාද පාලනය
    const btn = document.getElementById('gv-btn');
    const win = document.getElementById('gv-window');
    const input = document.getElementById('gv-input');
    const send = document.getElementById('gv-send');
    const msgs = document.getElementById('gv-msgs');

    btn.onclick = () => win.style.display = (win.style.display === 'flex' ? 'none' : 'flex');

    async function handleSend() {
        const text = input.value.trim();
        if (!text) return;
        addMessage('user', text);
        input.value = '';

        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, message: text, session_id: 'sess_123' })
        });
        const data = await response.json();
        addMessage('bot', data.reply);
    }

    function addMessage(role, text) {
        const div = document.createElement('div');
        div.className = `gravix-msg ${role}`;
        
        // Image parsing logic
        const imgRegex = /\[IMAGE:\s*(.*?)\]/g;
        let formatted = text.replace(imgRegex, (m, url) => `<img src="${url}" class="gravix-img" onerror="this.style.display='none'">`);
        
        div.innerHTML = formatted.replace(/\n/g, '<br>');
        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
    }

    send.onclick = handleSend;
    input.onkeypress = (e) => { if(e.key === 'Enter') handleSend(); };

    initWidget();
})();
