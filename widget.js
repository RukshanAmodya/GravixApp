(function () {
    // 1. Client ID Validation
    const scriptTag = document.currentScript;
    const clientId = scriptTag.getAttribute('data-id') || 'demo-id';
    // Using a simulated backend or real one? The user pasted the real one. 
    // We will keep the real url but knowing we might restrict it later.
    const backendUrl = 'https://gravixapp.netlify.app/api/chat';

    // 2. Load Google Fonts (Google Sans Flex to match website)
    const fontLink = document.createElement('link');
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@100;200;300;400;500;600;700&display=swap';
    fontLink.rel = 'stylesheet';
    document.head.appendChild(fontLink);

    // 3. Inject Cake Shop Themed CSS
    const style = document.createElement('style');
    style.innerHTML = `
        :root {
            --qg-primary: #F57C00;   /* Orange 600 */
            --qg-accent: #FF9800;    /* Orange 500 */
            --qg-bg-glass: rgba(255, 255, 255, 0.9); /* White Glass */
            --qg-border-glass: rgba(0, 0, 0, 0.05);
            --qg-text-main: #333333;
            --qg-text-sub: #666666;
            --qg-font: 'Google Sans Flex', sans-serif;
            --qg-easing: cubic-bezier(0.16, 1, 0.3, 1);
        }

        #qgent-container {
            font-family: var(--qg-font);
            position: fixed;
            bottom: 30px;
            right: 30px;
            z-index: 2147483647;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            pointer-events: none;
        }

        #qgent-container * { box-sizing: border-box; }
        #qgent-container > * { pointer-events: auto; }

        /* --- Toggle Button --- */
        .qgent-button {
            width: 70px;
            height: 70px;
            border-radius: 50%;
            cursor: pointer;
            box-shadow: 0 10px 30px rgba(245, 124, 0, 0.3); /* Orange Shadow */
            transition: all 0.4s var(--qg-easing);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            z-index: 20;
            padding: 0;
            background: white; 
            border: 3px solid white;
            overflow: hidden;
        }

        .qgent-button:hover { transform: scale(1.1); box-shadow: 0 15px 40px rgba(245, 124, 0, 0.4); }
        .qgent-button:active { transform: scale(0.95); }

        .qgent-video-circle {
            width: 100%;
            height: 100%;
            object-fit: cover;
            border-radius: 50%;
        }

        /* --- Main Window (White Glass) --- */
        .qgent-window {
            position: absolute;
            bottom: 100px; 
            right: 0;
            width: 380px;
            height: 600px;
            background: var(--qg-bg-glass);
            backdrop-filter: blur(24px);
            -webkit-backdrop-filter: blur(24px);
            border-radius: 32px;
            border: 1px solid var(--qg-border-glass);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255,255,255,0.5);
            display: none;
            flex-direction: column;
            overflow: hidden;
            transform-origin: bottom right;
            opacity: 0;
            transform: scale(0.8) translateY(20px);
            transition: all 0.6s var(--qg-easing);
        }

        .qgent-window.open {
            display: flex;
            opacity: 1;
            transform: scale(1) translateY(0);
        }

        /* --- Header --- */
        .qgent-header {
            padding: 20px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid rgba(0,0,0,0.05);
            background: rgba(255,255,255,0.5);
        }

        .qgent-header-back {
            display: none;
            background: none;
            border: none;
            color: var(--qg-text-main);
            cursor: pointer;
            padding: 8px;
            margin-right: 8px;
        }

        .qgent-header-title { font-size: 16px; font-weight: 700; color: var(--qg-text-main); letter-spacing: -0.5px; }

        .qgent-close {
            background: none; border: none; cursor: pointer; color: var(--qg-text-sub);
            padding: 4px; border-radius: 50%; transition: 0.2s;
        }
        .qgent-close:hover { background: rgba(0,0,0,0.05); color: var(--qg-text-main); }

        /* --- Welcome View --- */
        .qgent-welcome {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 30px;
            text-align: center;
            transition: 0.4s;
        }

        .qgent-orb-video {
            width: 120px;
            height: 120px;
            border-radius: 50%;
            object-fit: cover;
            margin-bottom: 32px;
            box-shadow: 0 10px 40px rgba(245, 124, 0, 0.2);
            border: 4px solid white;
        }

        .qgent-welcome h2 {
            font-size: 28px;
            font-weight: 800;
            color: var(--qg-text-main);
            margin: 0 0 12px;
            opacity: 0;
            animation: fadeInUp 0.8s 0.2s forwards var(--qg-easing);
            letter-spacing: -1px;
        }

        .qgent-welcome h3 {
            font-size: 20px;
            font-weight: 500;
            color: var(--qg-text-sub);
            margin: 0;
            opacity: 0;
            animation: fadeInUp 0.8s 0.3s forwards var(--qg-easing);
        }

        /* --- Chat View --- */
        .qgent-chat-area {
            flex: 1;
            display: none;
            flex-direction: column;
            overflow: hidden;
            background: rgba(255,255,255,0.3);
        }

        .qgent-messages {
            flex: 1;
            overflow-y: auto;
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .qgent-msg {
            max-width: 85%;
            padding: 14px 20px;
            font-size: 15px;
            font-weight: 400;
            line-height: 1.5;
            animation: msgPop 0.4s var(--qg-easing) forwards;
            box-shadow: 0 2px 5px rgba(0,0,0,0.02);
        }

        .qgent-msg.user {
            align-self: flex-end;
            background: var(--qg-primary);
            color: white;
            border-radius: 20px 20px 4px 20px;
            box-shadow: 0 5px 15px rgba(245, 124, 0, 0.2);
        }

        .qgent-msg.bot {
            align-self: flex-start;
            background: white;
            color: var(--qg-text-main);
            border-radius: 20px 20px 20px 4px;
            border: 1px solid rgba(0,0,0,0.05);
        }

        .qgent-img {
            max-width: 100%;
            border-radius: 12px;
            margin-bottom: 8px;
        }

        @keyframes msgPop {
            from { opacity: 0; transform: translateY(15px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* --- Input Area --- */
        .qgent-input-container {
            padding: 20px;
            background: rgba(255,255,255,0.8);
            border-top: 1px solid rgba(0,0,0,0.05);
        }

        .qgent-input-box {
            background: white;
            border: 1px solid rgba(0,0,0,0.08);
            border-radius: 24px;
            display: flex;
            flex-direction: column;
            transition: 0.3s;
            overflow: hidden;
            box-shadow: 0 5px 20px rgba(0,0,0,0.03);
        }

        .qgent-input-box:focus-within {
            border-color: var(--qg-accent);
            box-shadow: 0 5px 20px rgba(245, 124, 0, 0.1);
        }

        .qgent-input {
            width: 100%;
            background: transparent;
            border: none;
            padding: 16px;
            color: var(--qg-text-main);
            font-family: var(--qg-font);
            font-size: 16px;
            outline: none;
            min-height: 24px;
            resize: none;
            height: auto;
            max-height: 120px;
            overflow-y: auto;
        }
        .qgent-input::placeholder { color: #94a3b8; }

        .qgent-tools {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: #FAFAFA;
            border-top: 1px solid rgba(0,0,0,0.03);
        }

        .qgent-tool-group { display: flex; gap: 8px; }

        .qgent-tool-btn {
            background: transparent;
            border: none;
            border-radius: 12px;
            padding: 8px;
            color: #94a3b8;
            font-size: 13px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: 0.2s;
            font-weight: 500;
        }
        .qgent-tool-btn:hover { background: rgba(0,0,0,0.05); color: var(--qg-text-main); }
        
        .qgent-send-btn {
            background: var(--qg-primary);
            color: white;
            border: none;
            border-radius: 20px;
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: 0.3s;
            display: flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 4px 10px rgba(245, 124, 0, 0.2);
        }
        .qgent-send-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 15px rgba(245, 124, 0, 0.3); }
        .qgent-send-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; background: #cbd5e1; }

        /* Toast for Demo Restriction */
        .qgent-toast {
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(-20px);
            background: #1e293b;
            color: white;
            padding: 10px 16px;
            border-radius: 50px;
            font-size: 12px;
            font-weight: 500;
            opacity: 0;
            pointer-events: none;
            transition: all 0.3s;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            white-space: nowrap;
            z-index: 100;
        }
        .qgent-toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }

        /* Mobile */
        @media (max-width: 480px) {
            .qgent-window { width: 100vw; height: 100vh; bottom: 0; right: 0; border-radius: 0; }
            #qgent-container { bottom: 20px; right: 20px; }
            .qgent-header-back { display: block; } 
            .qgent-close { display: none; }
        }
    `;
    document.head.appendChild(style);

    // 4. Icons
    const ICONS = {
        close: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
        back: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>`,
        attach: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>`,
        mic: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`,
        arrowUp: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`
    };

    // 5. Structure
    const container = document.createElement('div');
    container.id = 'qgent-container';

    // Video HTML
    const VIDEO_BTN_HTML = `
        <video class="qgent-video-circle" autoplay loop muted playsinline>
            <source src="Liya.webm" type="video/webm">
        </video>
    `;

    container.innerHTML = `
        <div class="qgent-window" id="qg-window">
            
            <div class="qgent-toast" id="qg-toast">Feature unavailable in Demo Mode</div>

            <div class="qgent-header" id="qg-header" style="display:none;">
                <div style="display:flex; align-items:center">
                    <button class="qgent-header-back" id="qg-back-btn">${ICONS.back}</button>
                    <div class="qgent-header-title">Amila Bakes Assistant</div>
                </div>
                <div style="width:24px;"></div>
                <button class="qgent-close" id="qg-close-btn">${ICONS.close}</button>
            </div>

            <!-- Welcome State -->
            <div class="qgent-welcome" id="qg-welcome">
                <video class="qgent-orb-video" autoplay loop muted playsinline>
                    <source src="Liya.webm" type="video/webm">
                </video>
                <h2>Welcome to<br>Amila Bakes!</h2>
                <h3>How can I help you?</h3>
            </div>

            <!-- Chat State -->
            <div class="qgent-chat-area" id="qg-chat-area">
                <div class="qgent-messages" id="qg-msgs"></div>
            </div>

             <!-- Input -->
            <div class="qgent-input-container">
                <div class="qgent-input-box">
                    <textarea class="qgent-input" id="qg-input" placeholder="Ask about our cakes..." rows="1"></textarea>
                    <div class="qgent-tools">
                        <div class="qgent-tool-group">
                            <button class="qgent-tool-btn" id="qg-attach-btn">${ICONS.attach}</button>
                            <button class="qgent-tool-btn" id="qg-voice-btn">${ICONS.mic}</button>
                        </div>
                        <button class="qgent-send-btn" id="qg-send" disabled>Send ${ICONS.arrowUp}</button>
                    </div>
                </div>
                <div style="text-align:center; margin-top:12px; font-size:10px; color:#94a3b8; letter-spacing:1px; text-transform:uppercase;">Powered by Qgent AI</div>
            </div>
        </div>

        <button class="qgent-button" id="qg-btn">
            ${VIDEO_BTN_HTML}
        </button>
    `;
    document.body.appendChild(container);

    // 6. Logic
    let isOpen = false;
    let hasStartedChat = false;

    const ui = {
        btn: document.getElementById('qg-btn'),
        win: document.getElementById('qg-window'),
        input: document.getElementById('qg-input'),
        send: document.getElementById('qg-send'),
        msgs: document.getElementById('qg-msgs'),
        welcome: document.getElementById('qg-welcome'),
        chatArea: document.getElementById('qg-chat-area'),
        header: document.getElementById('qg-header'),
        attachBtn: document.getElementById('qg-attach-btn'),
        voiceBtn: document.getElementById('qg-voice-btn'),
        backBtn: document.getElementById('qg-back-btn'),
        closeBtn: document.getElementById('qg-close-btn'),
        toast: document.getElementById('qg-toast')
    };

    function toggleChat() {
        isOpen = !isOpen;
        if (isOpen) {
            ui.win.classList.add('open');
            ui.win.style.display = 'flex';
            setTimeout(() => ui.win.style.opacity = '1', 10);

            // Transform button to Close Icon (Orange)
            ui.btn.innerHTML = ICONS.close;
            ui.btn.style.background = '#F57C00';
            ui.btn.style.borderColor = '#F57C00';
            ui.btn.style.color = 'white';
        } else {
            ui.win.classList.remove('open');
            ui.win.style.opacity = '0';
            setTimeout(() => ui.win.style.display = 'none', 500);

            // Restore Video
            ui.btn.innerHTML = VIDEO_BTN_HTML;
            ui.btn.style.background = 'white';
            ui.btn.style.borderColor = 'white';
        }
    }
    ui.btn.onclick = toggleChat;
    ui.backBtn.onclick = toggleChat;
    ui.closeBtn.onclick = toggleChat;

    ui.input.addEventListener('input', () => {
        ui.send.disabled = !ui.input.value.trim();
    });

    // --- Demo Restrictions ---
    function showDemoToast() {
        ui.toast.classList.add('show');
        setTimeout(() => ui.toast.classList.remove('show'), 2000);
    }
    ui.attachBtn.onclick = showDemoToast;
    ui.voiceBtn.onclick = showDemoToast;

    function switchToChatMode() {
        if (hasStartedChat) return;
        hasStartedChat = true;

        ui.welcome.style.opacity = '0';
        ui.welcome.style.transform = 'translateY(-20px)';

        setTimeout(() => {
            ui.welcome.style.display = 'none';
            ui.header.style.display = 'flex';
            ui.chatArea.style.display = 'flex';
            ui.chatArea.style.opacity = '0';
            setTimeout(() => ui.chatArea.style.opacity = '1', 50);
        }, 400);
    }

    async function handleSend() {
        const text = ui.input.value.trim();
        if (!text) return;

        switchToChatMode();
        addMessage('user', text);
        ui.input.value = '';
        ui.send.disabled = true;

        showTyping();

        try {
            const response = await fetch(backendUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id: clientId, message: text, session_id: 'sess_' + Date.now() })
            });
            const data = await response.json();
            removeTyping();
            addMessage('bot', data.reply);
        } catch (e) {
            removeTyping();
            // Fallback for demo if backend unreachable
            addMessage('bot', "Thank you for visiting Amila Bakes! As this is a demo, I can't process complex queries right now, but feel free to browse our menu.");
        }
    }

    ui.send.onclick = handleSend;
    ui.input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };
    // Auto-resize Input
    ui.input.addEventListener('input', function () {
        this.style.height = 'auto'; // Reset
        this.style.height = (this.scrollHeight) + 'px';
    });

    function addMessage(role, text) {
        const div = document.createElement('div');
        div.className = `qgent-msg ${role}`;

        // Image parsing: [IMAGE: url] -> <img>
        const imgRegex = /\[IMAGE:\s*(.*?)\]/g;
        let formatted = text.replace(imgRegex, (m, url) => `<img src="${url}" class="qgent-img">`);

        // Basic Formatting
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        div.innerHTML = formatted.replace(/\n/g, '<br>');
        ui.msgs.appendChild(div);
        setTimeout(() => ui.msgs.scrollTop = ui.msgs.scrollHeight, 10);
    }

    let typingEl = null;
    function showTyping() {
        if (typingEl) return;
        typingEl = document.createElement('div');
        typingEl.className = 'qgent-msg bot';
        typingEl.innerHTML = '<span style="opacity:0.7; font-size:12px">Thinking...</span>';
        ui.msgs.appendChild(typingEl);
        ui.msgs.scrollTop = ui.msgs.scrollHeight;
    }

    function removeTyping() {
        if (typingEl) { typingEl.remove(); typingEl = null; }
    }

    // Auto-open logic
    if (new URLSearchParams(window.location.search).has('open_chat')) {
        setTimeout(toggleChat, 1000);
    }

})();
