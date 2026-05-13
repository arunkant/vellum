import type { ChatMessage } from './storage';

/**
 * HTML for the floating chat window. Loaded as a data URL with `chat-preload.js`.
 */
export function getChatHTML(filepath: string, history: ChatMessage[]): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --bg: #1a1a24;
    --bg-input: #111118;
    --border: #2a2a3a;
    --text: #e8e8ed;
    --text-secondary: #8888a0;
    --accent: #8b5cf6;
    --msg-ai: #1e1e2e;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    background: var(--bg);
    color: var(--text);
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    -webkit-app-region: drag;
    user-select: none;
  }

  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .titlebar-left { font-size: 12px; font-weight: 600; }
  .titlebar-actions { -webkit-app-region: no-drag; }

  .btn-close {
    background: none; border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 16px;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
  }
  .btn-close:hover { background: rgba(255,255,255,0.08); color: var(--text); }

  .preview {
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    max-height: 140px;
    overflow: hidden;
    cursor: pointer;
    background: #0a0a10;
  }
  .preview img { width: 100%; height: auto; display: block; object-fit: cover; max-height: 140px; }
  .preview.collapsed { max-height: 24px; }
  .preview.collapsed img { display: none; }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    -webkit-app-region: no-drag;
  }

  .msg {
    max-width: 90%;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.5;
    word-break: break-word;
  }
  .msg.user { align-self: flex-end; background: var(--accent); color: white; }
  .msg.ai   { align-self: flex-start; background: var(--msg-ai); border: 1px solid var(--border); }

  .msg-actions {
    display: flex; gap: 6px; margin-top: 6px; justify-content: flex-end;
  }
  .btn-copy {
    background: rgba(255,255,255,0.08);
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
  }
  .btn-copy:hover { background: rgba(255,255,255,0.15); color: var(--text); }
  .btn-copy.copied { color: #34d399; }

  .loading {
    align-self: flex-start;
    padding: 8px 12px;
    color: var(--text-secondary);
    font-size: 12px;
  }
  .loading span { animation: blink 1.4s infinite both; }
  .loading span:nth-child(2) { animation-delay: 0.2s; }
  .loading span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0% { opacity: 0.2; } 20% { opacity: 1; } 100% { opacity: 0.2; } }

  .input-area {
    display: flex;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }
  .input-area input {
    flex: 1;
    padding: 8px 12px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-right: none;
    border-radius: 6px 0 0 6px;
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    outline: none;
  }
  .input-area input:focus { border-color: var(--accent); }

  .btn-send {
    padding: 8px 14px;
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 0 6px 6px 0;
    color: white;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-send:hover { background: #7c3aed; }
  .btn-send:disabled { opacity: 0.5; cursor: not-allowed; }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
</style>
</head>
<body>

<div class="titlebar">
  <div class="titlebar-left">💬 Chat about screenshot</div>
  <div class="titlebar-actions">
    <button class="btn-close" id="close-btn" title="Close (Esc)">✕</button>
  </div>
</div>

<div class="preview" id="preview" title="Click to toggle preview">
  <img src="vellum-file://${encodeURI(filepath)}" alt="Screenshot" />
</div>

<div class="messages" id="messages">
  <div class="msg ai">👋 I'm looking at your screenshot. Ask me anything about it!</div>
</div>

<div class="input-area">
  <input type="text" id="chat-input" placeholder="Ask about this screenshot..." autocomplete="off" />
  <button class="btn-send" id="send-btn">Send</button>
</div>

<script>
  const api = window.chat;
  const filepath = ${JSON.stringify(filepath)};
  const savedHistory = ${JSON.stringify(history)};

  const messagesEl = document.getElementById('messages');
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  const previewEl = document.getElementById('preview');
  const closeBtn = document.getElementById('close-btn');

  let isWaiting = false;

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function addMessage(text, role) {
    const msg = document.createElement('div');
    msg.className = 'msg ' + role;

    if (role === 'ai') {
      msg.innerHTML = escapeHTML(text) + '<div class="msg-actions"><button class="btn-copy">📋 Copy</button></div>';
      const copyBtn = msg.querySelector('.btn-copy');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = '✅ Copied!';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = '📋 Copy';
            copyBtn.classList.remove('copied');
          }, 2000);
        });
      });
    } else {
      msg.textContent = text;
    }

    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  if (savedHistory.length > 0) {
    messagesEl.innerHTML = '';
    for (const msg of savedHistory) addMessage(msg.text, msg.role);
  }

  function showLoading() {
    const loader = document.createElement('div');
    loader.className = 'loading';
    loader.id = 'loader';
    loader.innerHTML = 'Thinking<span>.</span><span>.</span><span>.</span>';
    messagesEl.appendChild(loader);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideLoading() {
    document.getElementById('loader')?.remove();
  }

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isWaiting) return;

    isWaiting = true;
    sendBtn.disabled = true;
    inputEl.value = '';

    addMessage(text, 'user');
    showLoading();

    const reply = await api.send(filepath, text);
    hideLoading();
    addMessage(reply || '❌ Something went wrong. Try again.', 'ai');

    isWaiting = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
  });
  inputEl.focus();

  previewEl.addEventListener('click', () => previewEl.classList.toggle('collapsed'));

  closeBtn.addEventListener('click', () => api.close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.close();
  });
</script>
</body>
</html>`;
}
