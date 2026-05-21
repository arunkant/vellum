import type { ChatMessage } from './db';
import type { SavedPrompt } from './ai/saved-prompts';

export interface ChatWindowData {
  filepath: string;
  history: ChatMessage[];
  tags: string[];
  savedPrompts: SavedPrompt[];
}

/**
 * HTML for the floating screenshot workspace. Loaded as a data URL with `chat-preload.js`.
 */
export function getChatHTML(data: ChatWindowData): string {
  const { filepath, history, tags, savedPrompts } = data;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --bg: #111114;
    --bg-input: #17171a;
    --bg-elevated: #1c1c20;
    --border: #26262b;
    --border-strong: #34343c;
    --text: #f4f4f5;
    --text-secondary: #a1a1aa;
    --text-tertiary: #71717a;
    --accent: #3b82f6;
    --accent-hover: #2563eb;
    --accent-subtle: rgba(59, 130, 246, 0.12);
    --msg-ai: #17171a;
    --success: #10b981;
    --tag-bg: rgba(59, 130, 246, 0.18);
    --tag-border: rgba(59, 130, 246, 0.35);
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    font-size: 13px;
    letter-spacing: -0.005em;
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
    padding: 9px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    background: var(--bg);
  }
  .titlebar-left { font-size: 11.5px; font-weight: 600; color: var(--text); }
  .titlebar-actions { -webkit-app-region: no-drag; display: flex; gap: 4px; }

  .btn-icon {
    background: none; border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
    padding: 3px 7px;
    border-radius: 5px;
    line-height: 1;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .btn-icon:hover { background: rgba(255,255,255,0.06); color: var(--text); }

  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    background: #0a0a0c;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .stage img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    -webkit-user-drag: none;
  }
  .tag-rail {
    position: absolute;
    top: 8px;
    right: 8px;
    left: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    justify-content: flex-end;
    pointer-events: none;
    -webkit-app-region: no-drag;
  }
  .tag {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 7px 2px 8px;
    background: var(--tag-bg);
    border: 1px solid var(--tag-border);
    color: #cfe1ff;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.5;
    backdrop-filter: blur(4px);
  }
  .tag .x {
    cursor: pointer;
    color: #9ec2ff;
    font-size: 11px;
    padding: 0 1px;
    border-radius: 2px;
  }
  .tag .x:hover { color: #fff; }

  .reply-strip {
    flex-shrink: 0;
    padding: 8px 12px;
    background: var(--bg-elevated);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-secondary);
    cursor: pointer;
    -webkit-app-region: no-drag;
    display: none;
    align-items: flex-start;
    gap: 8px;
    max-height: 78px;
    overflow: hidden;
  }
  .reply-strip.show { display: flex; }
  .reply-strip:hover { background: #1e1e23; }
  .reply-strip .label {
    flex-shrink: 0;
    font-size: 10.5px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-top: 1px;
  }
  .reply-strip .text {
    flex: 1;
    color: var(--text);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }
  .reply-strip .chev { color: var(--text-tertiary); }

  .action-bar {
    flex-shrink: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    padding: 8px 10px;
    border-top: 1px solid var(--border);
    background: var(--bg);
    -webkit-app-region: no-drag;
  }
  .action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 9px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
  }
  .action:hover { background: #1f1f24; border-color: var(--border-strong); }
  .action:active { transform: translateY(1px); }
  .action.flash { background: var(--success); border-color: var(--success); color: white; }
  .action .kbd {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 10px;
    color: var(--text-tertiary);
    background: rgba(255,255,255,0.04);
    padding: 1px 5px;
    border-radius: 3px;
    border: 1px solid var(--border);
  }
  .action.flash .kbd { background: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.3); color: white; }
  .action-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    font-size: 12px;
    line-height: 1;
    flex-shrink: 0;
  }
  .brand-icon { width: 14px; height: 14px; display: block; }

  .input-area {
    display: flex;
    padding: 10px 12px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    -webkit-app-region: no-drag;
    background: var(--bg);
    gap: 6px;
  }
  .input-area input {
    flex: 1;
    padding: 8px 11px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 12.5px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .input-area input::placeholder { color: var(--text-tertiary); }
  .input-area input:hover { border-color: var(--border-strong); }
  .input-area input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-subtle); }
  .btn-send {
    padding: 8px 14px;
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 6px;
    color: white;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }
  .btn-send:hover { background: var(--accent-hover); }
  .btn-send:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Full chat panel — overlays the stage when expanded */
  .chat-panel {
    position: absolute;
    inset: 0;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    transform: translateY(100%);
    transition: transform 0.18s ease;
    z-index: 5;
  }
  .chat-panel.show { transform: translateY(0); }
  .chat-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-secondary);
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    -webkit-app-region: no-drag;
  }
  .msg {
    max-width: 88%;
    padding: 8px 11px;
    border-radius: 10px;
    font-size: 12.5px;
    line-height: 1.5;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .msg.user { align-self: flex-end; background: var(--accent); color: white; }
  .msg.ai { align-self: flex-start; background: var(--msg-ai); border: 1px solid var(--border); color: var(--text); }
  .loading { align-self: flex-start; padding: 8px 12px; color: var(--text-tertiary); font-size: 12px; }
  .loading span { animation: blink 1.4s infinite both; }
  .loading span:nth-child(2) { animation-delay: 0.2s; }
  .loading span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0% { opacity: 0.2; } 20% { opacity: 1; } 100% { opacity: 0.2; } }

  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; border: 2px solid transparent; background-clip: padding-box; }
  ::-webkit-scrollbar-thumb:hover { background: var(--border-strong); background-clip: padding-box; }
</style>
</head>
<body>

<div class="titlebar">
  <div class="titlebar-left">📐 Vellum workspace</div>
  <div class="titlebar-actions">
    <button class="btn-icon" id="chat-toggle" title="Toggle chat history">💬</button>
    <button class="btn-icon" id="close-btn" title="Close (Esc)">✕</button>
  </div>
</div>

<div class="stage" id="stage">
  <img src="vellum-file://${encodeURI(filepath)}" alt="Screenshot" />
  <div class="tag-rail" id="tag-rail"></div>

  <div class="chat-panel" id="chat-panel">
    <div class="chat-panel-head">
      <span>Chat history</span>
      <button class="btn-icon" id="chat-close">▾</button>
    </div>
    <div class="messages" id="messages"></div>
  </div>
</div>

<div class="reply-strip" id="reply-strip">
  <span class="label">AI</span>
  <span class="text" id="reply-text"></span>
  <span class="chev">▴</span>
</div>

<div class="action-bar" id="action-bar"></div>

<div class="input-area">
  <input type="text" id="omni-input"
    placeholder="Ask, #tag, or /script…"
    autocomplete="off" autocapitalize="off" spellcheck="false" />
  <button class="btn-send" id="send-btn">↵</button>
</div>

<script>
  const api = window.chat;
  const filepath = ${JSON.stringify(filepath)};
  const savedHistory = ${JSON.stringify(history)};
  const initialTags = ${JSON.stringify(tags)};
  const savedPrompts = ${JSON.stringify(savedPrompts)};

  const ICON_SLACK =
    '<svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"/>' +
    '<path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"/>' +
    '<path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"/>' +
    '<path fill="#ECB22E" d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>' +
    '</svg>';

  const ICON_JIRA =
    '<svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="#2684FF" d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005z"/>' +
    '<path fill="#1976D2" d="M17.294 5.757H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.762a1.001 1.001 0 0 0-1.001-1.005z"/>' +
    '<path fill="#0052CC" d="M23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0z"/>' +
    '</svg>';

  const ACTIONS = [
    { id: 'copy-image',  label: 'Copy image', iconText: '📋',         run: () => api.copyImage(filepath) },
    { id: 'copy-shadow', label: 'Shadow',     iconText: '🖼️',         run: () => api.copyWithShadow(filepath) },
    { id: 'copy-slack',  label: 'Slack',      iconHtml: ICON_SLACK,   run: () => api.copyAs(filepath, 'slack') },
    { id: 'copy-jira',  label: 'JIRA',       iconHtml: ICON_JIRA,    run: () => api.copyAs(filepath, 'jira') },
    ...savedPrompts.map((p) => ({
      id: 'prompt:' + p.id,
      label: '/' + p.command,
      iconText: '✨',
      run: () => runSavedPrompt(p.id),
    })),
  ];

  const stageEl = document.getElementById('stage');
  const tagRail = document.getElementById('tag-rail');
  const actionBar = document.getElementById('action-bar');
  const replyStrip = document.getElementById('reply-strip');
  const replyText = document.getElementById('reply-text');
  const chatPanel = document.getElementById('chat-panel');
  const chatToggle = document.getElementById('chat-toggle');
  const chatClose = document.getElementById('chat-close');
  const messagesEl = document.getElementById('messages');
  const inputEl = document.getElementById('omni-input');
  const sendBtn = document.getElementById('send-btn');
  const closeBtn = document.getElementById('close-btn');

  let isWaiting = false;
  let currentTags = initialTags.slice();

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- tags ----
  function renderTags() {
    tagRail.innerHTML = '';
    for (const t of currentTags) {
      const chip = document.createElement('span');
      chip.className = 'tag';
      chip.innerHTML = '#' + escapeHTML(t) + ' <span class="x" title="Remove">×</span>';
      chip.querySelector('.x').addEventListener('click', async () => {
        currentTags = await api.removeTag(filepath, t);
        renderTags();
      });
      tagRail.appendChild(chip);
    }
  }

  async function addTag(raw) {
    currentTags = await api.addTag(filepath, raw);
    renderTags();
  }

  // ---- action bar ----
  function renderActions() {
    actionBar.innerHTML = '';
    ACTIONS.forEach((a, idx) => {
      const btn = document.createElement('button');
      btn.className = 'action';
      btn.dataset.actionId = a.id;

      if (a.iconHtml) {
        const wrap = document.createElement('span');
        wrap.className = 'action-icon';
        wrap.innerHTML = a.iconHtml;
        btn.appendChild(wrap);
      } else if (a.iconText) {
        const wrap = document.createElement('span');
        wrap.className = 'action-icon';
        wrap.textContent = a.iconText;
        btn.appendChild(wrap);
      }

      const label = document.createElement('span');
      label.textContent = a.label;
      btn.appendChild(label);

      if (idx < 9) {
        const kbd = document.createElement('span');
        kbd.className = 'kbd';
        kbd.textContent = '⌘' + (idx + 1);
        btn.appendChild(kbd);
      }

      btn.addEventListener('click', () => runAction(a));
      actionBar.appendChild(btn);
    });
  }

  function flashAction(actionId) {
    const btn = actionBar.querySelector('[data-action-id="' + CSS.escape(actionId) + '"]');
    if (!btn) return;
    btn.classList.add('flash');
    setTimeout(() => btn.classList.remove('flash'), 600);
  }

  async function runAction(a) {
    const result = await a.run();
    if (result !== false) flashAction(a.id);
  }

  // ---- chat panel ----
  function renderMessages() {
    messagesEl.innerHTML = '';
    for (const m of savedHistory) appendMessage(m.text, m.role, false);
  }

  function appendMessage(text, role, persist = true) {
    const msg = document.createElement('div');
    msg.className = 'msg ' + role;
    msg.textContent = text;
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (persist) savedHistory.push({ role, text, time: Date.now() });
  }

  function showReply(text) {
    replyText.textContent = text;
    replyStrip.classList.add('show');
  }

  function openChat() { chatPanel.classList.add('show'); messagesEl.scrollTop = messagesEl.scrollHeight; }
  function closeChat() { chatPanel.classList.remove('show'); }

  // ---- omni-input ----
  function parseInput(raw) {
    const tags = [];
    let scriptCommand = null;
    let scriptArgs = '';
    const rest = [];

    const tokens = raw.match(/\\S+/g) || [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.startsWith('#') && tok.length > 1) {
        tags.push(tok.slice(1));
      } else if (tok.startsWith('/') && tok.length > 1 && scriptCommand === null) {
        scriptCommand = tok.slice(1).toLowerCase();
        scriptArgs = tokens.slice(i + 1).filter((t) => !t.startsWith('#')).join(' ');
        // Remaining non-tag tokens are absorbed into scriptArgs; tags after / still tag.
        for (let j = i + 1; j < tokens.length; j++) {
          if (tokens[j].startsWith('#') && tokens[j].length > 1) tags.push(tokens[j].slice(1));
        }
        break;
      } else {
        rest.push(tok);
      }
    }
    return { tags, scriptCommand, scriptArgs, text: rest.join(' ').trim() };
  }

  async function submitInput() {
    if (isWaiting) return;
    const raw = inputEl.value;
    if (!raw.trim()) return;
    inputEl.value = '';

    const { tags, scriptCommand, text } = parseInput(raw);

    for (const t of tags) await addTag(t);

    if (scriptCommand) {
      const prompt = savedPrompts.find((p) => p.command === scriptCommand);
      if (prompt) {
        await runSavedPrompt(prompt.id);
        return;
      } else {
        appendMessage('/' + scriptCommand, 'user');
        appendMessage('Unknown script: /' + scriptCommand + '. Try: ' + savedPrompts.map((p) => '/' + p.command).join(', '), 'ai');
        showReply('Unknown script: /' + scriptCommand);
        openChat();
        return;
      }
    }

    if (text) await askAI(text);
  }

  async function askAI(text) {
    isWaiting = true;
    sendBtn.disabled = true;
    appendMessage(text, 'user');
    showReply('Thinking…');
    openChat();
    showLoading();

    const reply = await api.send(filepath, text);
    hideLoading();
    const body = reply || '❌ Something went wrong. Try again.';
    appendMessage(body, 'ai');
    showReply(body);

    isWaiting = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }

  async function runSavedPrompt(promptId) {
    if (isWaiting) return;
    const prompt = savedPrompts.find((p) => p.id === promptId);
    if (!prompt) return;
    isWaiting = true;
    sendBtn.disabled = true;
    appendMessage('/' + prompt.command, 'user');
    showReply('Running /' + prompt.command + '…');
    showLoading();

    const reply = await api.runPrompt(filepath, promptId);
    hideLoading();
    const body = reply || '❌ Something went wrong. Try again.';
    appendMessage(body, 'ai');
    showReply(body);

    isWaiting = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }

  function showLoading() {
    const loader = document.createElement('div');
    loader.className = 'loading';
    loader.id = 'loader';
    loader.innerHTML = 'Thinking<span>.</span><span>.</span><span>.</span>';
    messagesEl.appendChild(loader);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function hideLoading() { document.getElementById('loader')?.remove(); }

  // ---- wiring ----
  renderTags();
  renderActions();
  renderMessages();
  if (savedHistory.length > 0) {
    const last = savedHistory[savedHistory.length - 1];
    if (last.role === 'ai') showReply(last.text);
  }

  sendBtn.addEventListener('click', submitInput);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitInput(); }
  });
  inputEl.focus();

  replyStrip.addEventListener('click', openChat);
  chatToggle.addEventListener('click', () => {
    chatPanel.classList.contains('show') ? closeChat() : openChat();
  });
  chatClose.addEventListener('click', closeChat);

  closeBtn.addEventListener('click', () => api.close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (chatPanel.classList.contains('show')) { closeChat(); return; }
      api.close();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
      const idx = parseInt(e.key, 10) - 1;
      const action = ACTIONS[idx];
      if (action) {
        e.preventDefault();
        runAction(action);
      }
    }
  });
</script>
</body>
</html>`;
}
