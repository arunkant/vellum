import './index.css';

type AIProvider = 'openrouter' | 'local';

type LocalLlmStatus = {
  state: 'idle' | 'missing-binary' | 'missing-model' | 'downloading' | 'starting' | 'ready' | 'error';
  message?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  modelPresent: boolean;
  binaryPresent: boolean;
};

type ScreenshotEntry = {
  name: string;
  path: string;
  time: number;
  url: string | null;
  aiText: string | null;
  aiDescription: string | null;
  aiModel: string | null;
  hasChat: boolean;
  chatPreview: string | null;
};

const emptyState = document.getElementById('empty-state')!;
const grid = document.getElementById('screenshots-grid')!;
const toastEl = document.getElementById('toast')!;

// --- Search ---
const searchInput = document.getElementById('search-input') as HTMLInputElement;
let allScreenshots: ScreenshotEntry[] = [];
let searchQuery = '';
let searchDebounce: ReturnType<typeof setTimeout> | null = null;

function filterScreenshots(query: string): ScreenshotEntry[] {
  if (!query.trim()) return allScreenshots;
  const q = query.toLowerCase().trim();
  return allScreenshots.filter((s) => {
    if (s.name.toLowerCase().includes(q)) return true;
    if (s.url && s.url.toLowerCase().includes(q)) return true;
    if (s.aiText && s.aiText.toLowerCase().includes(q)) return true;
    if (s.aiDescription && s.aiDescription.toLowerCase().includes(q)) return true;
    if (s.chatPreview && s.chatPreview.toLowerCase().includes(q)) return true;
    return false;
  });
}

// --- Settings panel ---
const settingsOverlay = document.getElementById('settings-overlay')!;
const providerSelect = document.getElementById('provider-select') as HTMLSelectElement;
const openrouterSection = document.getElementById('openrouter-section')!;
const localSection = document.getElementById('local-section')!;
const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
const saveSettingsBtn = document.getElementById('save-settings-btn')!;
const settingsBtn = document.getElementById('settings-btn')!;
const closeSettingsBtn = document.getElementById('close-settings-btn')!;
const settingsStatus = document.getElementById('settings-status')!;

// Local LLM controls
const localModelState = document.getElementById('local-model-state')!;
const localServerState = document.getElementById('local-server-state')!;
const localProgressWrap = document.getElementById('local-progress-wrap')!;
const localProgressFill = document.getElementById('local-progress-fill')!;
const localProgressText = document.getElementById('local-progress-text')!;
const downloadModelBtn = document.getElementById('download-model-btn') as HTMLButtonElement;
const cancelDownloadBtn = document.getElementById('cancel-download-btn') as HTMLButtonElement;
const stopServerBtn = document.getElementById('stop-server-btn') as HTMLButtonElement;

const LOCAL_MODEL_TOTAL_BYTES = 5_400_000_000;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function renderLocalLlmStatus(status: LocalLlmStatus) {
  if (status.modelPresent) {
    localModelState.textContent = 'Downloaded';
    localModelState.className = 'local-llm-value ok';
    downloadModelBtn.style.display = 'none';
  } else {
    localModelState.textContent = 'Not downloaded';
    localModelState.className = 'local-llm-value warn';
    downloadModelBtn.style.display = status.state === 'downloading' ? 'none' : 'inline-block';
  }

  const serverLabels: Record<LocalLlmStatus['state'], { text: string; cls: string }> = {
    'idle':           { text: 'Stopped',           cls: '' },
    'missing-binary': { text: 'Binary missing',    cls: 'err' },
    'missing-model':  { text: 'Model not ready',   cls: 'warn' },
    'downloading':    { text: 'Downloading model', cls: 'warn' },
    'starting':       { text: 'Starting…',         cls: 'warn' },
    'ready':          { text: 'Running',           cls: 'ok' },
    'error':          { text: status.message || 'Error', cls: 'err' },
  };
  const label = serverLabels[status.state];
  localServerState.textContent = label.text;
  localServerState.className = `local-llm-value ${label.cls}`;

  if (status.state === 'downloading') {
    localProgressWrap.style.display = 'flex';
    cancelDownloadBtn.style.display = 'inline-block';
    const done = status.downloadedBytes || 0;
    const total = status.totalBytes || LOCAL_MODEL_TOTAL_BYTES;
    const pct = Math.min(100, Math.round((done / total) * 100));
    localProgressFill.style.width = `${pct}%`;
    localProgressText.textContent = `${formatBytes(done)} / ~${formatBytes(total)} (${pct}%)`;
  } else {
    localProgressWrap.style.display = 'none';
    cancelDownloadBtn.style.display = 'none';
  }

  stopServerBtn.style.display =
    status.state === 'ready' || status.state === 'starting' ? 'inline-block' : 'none';
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function formatTime(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// --- Toast ---
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string, ms = 2500) {
  toastEl.textContent = msg;
  toastEl.classList.add('visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), ms);
}

// --- Icon SVGs ---
const ICON_CHAT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

const ICON_SLACK =
  '<svg class="ws-brand-icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"/>' +
  '<path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"/>' +
  '<path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"/>' +
  '<path fill="#ECB22E" d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>' +
  '</svg>';

const ICON_JIRA =
  '<svg class="ws-brand-icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="#2684FF" d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005z"/>' +
  '<path fill="#1976D2" d="M17.294 5.757H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.762a1.001 1.001 0 0 0-1.001-1.005z"/>' +
  '<path fill="#0052CC" d="M23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0z"/>' +
  '</svg>';

function renderEmptyState() {
  const isSearching = searchQuery.trim().length > 0;
  if (isSearching) {
    emptyState.innerHTML = `
      <h2>No matches</h2>
      <p>No screenshots match your search.</p>
    `;
  } else {
    emptyState.innerHTML = `
      <h2>No screenshots yet</h2>
      <p>
        Press <kbd>⌘⇧1</kbd> to drag-select a region,<br/>
        or <kbd>⌘⇧2</kbd> for a full-screen capture.<br/>
        <br/>
        Hotkeys work even when this window is hidden.
      </p>
    `;
  }
}

function renderScreenshots(screenshots: ScreenshotEntry[]) {
  const isSearching = searchQuery.trim().length > 0;
  const noContent = allScreenshots.length === 0 || (isSearching && screenshots.length === 0);

  if (noContent) {
    renderEmptyState();
    emptyState.style.display = 'flex';
    grid.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';

  for (const shot of screenshots) {
    grid.appendChild(buildCard(shot));
  }
}

function buildCard(shot: ScreenshotEntry): HTMLElement {
  const card = document.createElement('div');
  card.className = 'screenshot-card';
  card.dataset.filename = shot.name;

  // Preview
  const preview = document.createElement('div');
  preview.className = 'card-preview';
  const img = document.createElement('img');
  img.src = `vellum-file://${encodeURI(shot.path)}`;
  img.alt = shot.name;
  img.loading = 'lazy';
  img.addEventListener('error', () => {
    preview.innerHTML = '<div class="image-error">Preview unavailable</div>';
  });
  preview.appendChild(img);
  card.appendChild(preview);

  // Body
  const body = document.createElement('div');
  body.className = 'card-body';

  const time = document.createElement('span');
  time.className = 'card-time';
  time.title = `${new Date(shot.time).toLocaleString()}\n${shot.name}`;
  time.textContent = formatTime(shot.time);
  if (shot.hasChat) {
    const dot = document.createElement('span');
    dot.className = 'chat-dot';
    dot.textContent = '●';
    dot.title = 'Has chat';
    time.appendChild(dot);
  }
  body.appendChild(time);

  if (shot.url) {
    const source = document.createElement('a');
    source.className = 'card-source';
    source.textContent = hostnameOf(shot.url);
    source.title = shot.url;
    source.dataset.action = 'open-url';
    body.appendChild(source);
  }

  const aiContent = shot.aiDescription || shot.aiText || '';
  if (aiContent) {
    const ai = document.createElement('div');
    ai.className = 'card-ai';
    ai.textContent = aiContent;
    body.appendChild(ai);
  }
  card.appendChild(body);

  // Floating actions (hover-revealed)
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const chatBtn = document.createElement('button');
  chatBtn.className = 'btn-icon';
  chatBtn.title = 'Chat about this screenshot';
  chatBtn.setAttribute('aria-label', 'Chat');
  chatBtn.dataset.action = 'open-chat';
  chatBtn.innerHTML = ICON_CHAT;
  actions.appendChild(chatBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-icon';
  delBtn.title = 'Delete';
  delBtn.setAttribute('aria-label', 'Delete');
  delBtn.dataset.action = 'delete';
  delBtn.innerHTML = ICON_TRASH;
  actions.appendChild(delBtn);

  card.appendChild(actions);

  card.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (btn) {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'delete') {
        allScreenshots = await window.vellum.deleteScreenshot(shot.path);
        renderScreenshots(filterScreenshots(searchQuery));
        showToast('Screenshot deleted');
      } else if (action === 'open-chat') {
        window.vellum.openChatWindow(shot.path);
      } else if (action === 'open-url' && shot.url) {
        window.vellum.openExternal(shot.url);
      }
      return;
    }
    openDetail(shot);
  });

  return card;
}

async function refreshScreenshots() {
  try {
    allScreenshots = await window.vellum.getScreenshots();
    renderScreenshots(filterScreenshots(searchQuery));
  } catch (err) {
    console.error('Failed to load screenshots:', err);
  }
}

// --- Detail panel (workspace) ---
type ChatMessage = { role: 'user' | 'ai'; text: string; time: number };
type SavedPrompt = { id: string; name: string; command: string; description: string; prompt: string };
type WorkspaceAction = {
  id: string;
  label: string;
  iconHtml?: string;
  iconText?: string;
  run: () => Promise<boolean | void>;
};

const detailBackdrop = document.getElementById('detail-backdrop')!;
const detailPanel = document.getElementById('detail-panel')!;
const detailTitleEl = document.getElementById('detail-title')!;
const detailSourceBar = document.getElementById('detail-source-bar')!;
const detailSourceLink = document.getElementById('detail-source-link') as HTMLAnchorElement;
const detailImageEl = document.getElementById('detail-image') as HTMLImageElement;
const detailTagRail = document.getElementById('detail-tag-rail')!;
const detailActionBar = document.getElementById('detail-action-bar')!;
const detailReplyStrip = document.getElementById('detail-reply-strip')!;
const detailReplyText = document.getElementById('detail-reply-text')!;
const detailChatPanel = document.getElementById('detail-chat-panel')!;
const detailMessages = document.getElementById('detail-messages')!;
const detailOmniInput = document.getElementById('detail-omni-input') as HTMLInputElement;
const detailSendBtn = document.getElementById('detail-send-btn') as HTMLButtonElement;
const detailCloseBtn = document.getElementById('detail-close')!;
const detailChatToggle = document.getElementById('detail-chat-toggle')!;
const detailChatClose = document.getElementById('detail-chat-close')!;
const detailOpenBtn = document.getElementById('detail-open')!;
const detailDeleteBtn = document.getElementById('detail-delete')!;

let currentDetail: ScreenshotEntry | null = null;
let currentTags: string[] = [];
let currentActions: WorkspaceAction[] = [];
let savedPrompts: SavedPrompt[] = [];
let wsWaiting = false;

function buildActions(filepath: string): WorkspaceAction[] {
  const ws = window.vellum.workspace;
  return [
    { id: 'copy-image', label: 'Copy image', iconText: '📋', run: () => ws.copyImage(filepath) },
    { id: 'copy-slack', label: 'Slack',      iconHtml: ICON_SLACK, run: () => ws.copyAs(filepath, 'slack') },
    { id: 'copy-jira',  label: 'JIRA',       iconHtml: ICON_JIRA,  run: () => ws.copyAs(filepath, 'jira') },
    ...savedPrompts.map((p) => ({
      id: 'prompt:' + p.id,
      label: '/' + p.command,
      iconText: '✨',
      run: async () => { await runSavedPrompt(p.id); return true; },
    })),
  ];
}

function renderTags() {
  detailTagRail.innerHTML = '';
  for (const t of currentTags) {
    const chip = document.createElement('span');
    chip.className = 'ws-tag';
    chip.textContent = '#' + t + ' ';
    const x = document.createElement('span');
    x.className = 'x';
    x.title = 'Remove';
    x.textContent = '×';
    x.addEventListener('click', async () => {
      if (!currentDetail) return;
      currentTags = await window.vellum.workspace.removeTag(currentDetail.path, t);
      renderTags();
    });
    chip.appendChild(x);
    detailTagRail.appendChild(chip);
  }
}

function renderActions() {
  detailActionBar.innerHTML = '';
  currentActions.forEach((a, idx) => {
    const btn = document.createElement('button');
    btn.className = 'ws-action';
    btn.dataset.actionId = a.id;

    if (a.iconHtml) {
      const wrap = document.createElement('span');
      wrap.className = 'ws-action-icon';
      wrap.innerHTML = a.iconHtml;
      btn.appendChild(wrap);
    } else if (a.iconText) {
      const wrap = document.createElement('span');
      wrap.className = 'ws-action-icon';
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

    btn.addEventListener('click', () => runWsAction(a));
    detailActionBar.appendChild(btn);
  });
}

function flashAction(actionId: string) {
  const btn = detailActionBar.querySelector(
    `[data-action-id="${CSS.escape(actionId)}"]`,
  ) as HTMLElement | null;
  if (!btn) return;
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 600);
}

async function runWsAction(a: WorkspaceAction) {
  const ok = await a.run();
  if (ok !== false) flashAction(a.id);
}

function appendMessage(text: string, role: 'user' | 'ai') {
  const msg = document.createElement('div');
  msg.className = 'ws-msg ' + role;
  msg.textContent = text;
  detailMessages.appendChild(msg);
  detailMessages.scrollTop = detailMessages.scrollHeight;
}

function renderHistory(history: ChatMessage[]) {
  detailMessages.innerHTML = '';
  for (const m of history) appendMessage(m.text, m.role);
}

function showReply(text: string) {
  detailReplyText.textContent = text;
  detailReplyStrip.classList.add('show');
}
function hideReply() {
  detailReplyStrip.classList.remove('show');
  detailReplyText.textContent = '';
}

function openChatHistory() {
  detailChatPanel.classList.add('show');
  detailMessages.scrollTop = detailMessages.scrollHeight;
}
function closeChatHistory() {
  detailChatPanel.classList.remove('show');
}

function showLoading() {
  const loader = document.createElement('div');
  loader.className = 'ws-loading';
  loader.id = 'ws-loader';
  loader.innerHTML = 'Thinking<span>.</span><span>.</span><span>.</span>';
  detailMessages.appendChild(loader);
  detailMessages.scrollTop = detailMessages.scrollHeight;
}
function hideLoading() {
  document.getElementById('ws-loader')?.remove();
}

function parseInput(raw: string): { tags: string[]; scriptCommand: string | null; text: string } {
  const tags: string[] = [];
  let scriptCommand: string | null = null;
  const rest: string[] = [];
  const tokens = raw.match(/\S+/g) || [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.startsWith('#') && tok.length > 1) {
      tags.push(tok.slice(1));
    } else if (tok.startsWith('/') && tok.length > 1 && scriptCommand === null) {
      scriptCommand = tok.slice(1).toLowerCase();
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].startsWith('#') && tokens[j].length > 1) tags.push(tokens[j].slice(1));
      }
      break;
    } else {
      rest.push(tok);
    }
  }
  return { tags, scriptCommand, text: rest.join(' ').trim() };
}

async function submitOmni() {
  if (wsWaiting || !currentDetail) return;
  const raw = detailOmniInput.value;
  if (!raw.trim()) return;
  detailOmniInput.value = '';

  const { tags, scriptCommand, text } = parseInput(raw);

  for (const t of tags) {
    currentTags = await window.vellum.workspace.addTag(currentDetail.path, t);
  }
  renderTags();

  if (scriptCommand) {
    const prompt = savedPrompts.find((p) => p.command === scriptCommand);
    if (prompt) {
      await runSavedPrompt(prompt.id);
      return;
    }
    appendMessage('/' + scriptCommand, 'user');
    const msg =
      'Unknown script: /' + scriptCommand +
      '. Try: ' + savedPrompts.map((p) => '/' + p.command).join(', ');
    appendMessage(msg, 'ai');
    showReply(msg);
    openChatHistory();
    return;
  }

  if (text) await askAI(text);
}

async function askAI(text: string) {
  if (!currentDetail) return;
  wsWaiting = true;
  detailSendBtn.disabled = true;
  appendMessage(text, 'user');
  showReply('Thinking…');
  openChatHistory();
  showLoading();

  const reply = await window.vellum.workspace.sendChat(currentDetail.path, text);
  hideLoading();
  const body = reply || '❌ Something went wrong. Try again.';
  appendMessage(body, 'ai');
  showReply(body);

  wsWaiting = false;
  detailSendBtn.disabled = false;
  detailOmniInput.focus();
}

async function runSavedPrompt(promptId: string) {
  if (wsWaiting || !currentDetail) return;
  const prompt = savedPrompts.find((p) => p.id === promptId);
  if (!prompt) return;

  wsWaiting = true;
  detailSendBtn.disabled = true;
  appendMessage('/' + prompt.command, 'user');
  showReply('Running /' + prompt.command + '…');
  showLoading();

  const reply = await window.vellum.workspace.runSavedPrompt(currentDetail.path, promptId);
  hideLoading();
  const body = reply || '❌ Something went wrong. Try again.';
  appendMessage(body, 'ai');
  showReply(body);

  wsWaiting = false;
  detailSendBtn.disabled = false;
  detailOmniInput.focus();
}

async function openDetail(shot: ScreenshotEntry) {
  currentDetail = shot;
  detailTitleEl.textContent = shot.name;
  if (shot.url) {
    detailSourceLink.textContent = hostnameOf(shot.url);
    detailSourceLink.title = shot.url;
    detailSourceBar.classList.add('show');
  } else {
    detailSourceBar.classList.remove('show');
  }
  detailImageEl.src = `vellum-file://${encodeURI(shot.path)}`;
  detailImageEl.alt = shot.name;

  detailBackdrop.classList.add('open');
  detailPanel.classList.add('open');
  detailPanel.setAttribute('aria-hidden', 'false');

  hideReply();
  closeChatHistory();
  detailMessages.innerHTML = '';
  detailTagRail.innerHTML = '';

  if (savedPrompts.length === 0) {
    savedPrompts = await window.vellum.workspace.listSavedPrompts();
  }
  currentActions = buildActions(shot.path);
  renderActions();

  const [tags, history] = await Promise.all([
    window.vellum.workspace.listTags(shot.path),
    window.vellum.workspace.getHistory(shot.path),
  ]);

  // Bail if user already navigated away.
  if (currentDetail !== shot) return;

  currentTags = tags;
  renderTags();
  renderHistory(history);
  if (history.length > 0) {
    const last = history[history.length - 1];
    if (last.role === 'ai') showReply(last.text);
  }

  detailOmniInput.focus();
}

function closeDetail() {
  currentDetail = null;
  detailBackdrop.classList.remove('open');
  detailPanel.classList.remove('open');
  detailPanel.setAttribute('aria-hidden', 'true');
  closeChatHistory();
  hideReply();
}

detailCloseBtn.addEventListener('click', closeDetail);
detailBackdrop.addEventListener('click', closeDetail);
detailChatToggle.addEventListener('click', () => {
  detailChatPanel.classList.contains('show') ? closeChatHistory() : openChatHistory();
});
detailChatClose.addEventListener('click', closeChatHistory);

detailOpenBtn.addEventListener('click', () => {
  if (!currentDetail) return;
  window.vellum.openScreenshot(currentDetail.path);
});

detailSourceLink.addEventListener('click', () => {
  if (currentDetail?.url) window.vellum.openExternal(currentDetail.url);
});

detailImageEl.addEventListener('click', () => {
  if (!currentDetail) return;
  window.vellum.openScreenshot(currentDetail.path);
});

detailDeleteBtn.addEventListener('click', async () => {
  if (!currentDetail) return;
  const path = currentDetail.path;
  closeDetail();
  allScreenshots = await window.vellum.deleteScreenshot(path);
  renderScreenshots(filterScreenshots(searchQuery));
  showToast('Screenshot deleted');
});

detailSendBtn.addEventListener('click', submitOmni);
detailOmniInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitOmni(); }
});

document.addEventListener('keydown', (e) => {
  const panelOpen = detailPanel.classList.contains('open');
  if (!panelOpen) return;

  if (e.key === 'Escape') {
    if (detailChatPanel.classList.contains('show')) {
      closeChatHistory();
    } else {
      closeDetail();
    }
    return;
  }

  if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
    // Don't hijack ⌘1/⌘2 when the global capture shortcuts apply (those use ⇧).
    if (e.shiftKey) return;
    const idx = parseInt(e.key, 10) - 1;
    const action = currentActions[idx];
    if (action) {
      e.preventDefault();
      runWsAction(action);
    }
  }
});

// --- Settings ---
function applyProviderVisibility(provider: AIProvider) {
  openrouterSection.style.display = provider === 'openrouter' ? 'flex' : 'none';
  localSection.style.display = provider === 'local' ? 'flex' : 'none';
}

function ensureModelOption(value: string) {
  if (!value) return;
  if ([...modelSelect.options].some((o) => o.value === value)) return;
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = value;
  modelSelect.appendChild(opt);
}

async function loadSettings() {
  const config = await window.vellum.getConfig();
  providerSelect.value = config.aiProvider || 'openrouter';
  apiKeyInput.value = config.openrouterApiKey || '';
  ensureModelOption(config.aiModel || 'google/gemini-2.5-flash-lite');
  modelSelect.value = config.aiModel || 'google/gemini-2.5-flash-lite';
  applyProviderVisibility(config.aiProvider);
  updateSettingsHint(config.openrouterApiKey);

  const status = await window.vellum.getLocalLlmStatus();
  renderLocalLlmStatus(status);

  const versionEl = document.getElementById('app-version');
  if (versionEl) {
    const v = await window.vellum.getAppVersion();
    versionEl.textContent = `Vellum v${v}`;
  }
}

function updateSettingsHint(hasKey: string) {
  const hint = document.getElementById('settings-hint');
  if (hint) {
    hint.style.display = hasKey ? 'none' : 'block';
  }
}

settingsBtn.addEventListener('click', () => {
  settingsOverlay.style.display = 'flex';
  loadSettings();
});

closeSettingsBtn.addEventListener('click', () => {
  settingsOverlay.style.display = 'none';
});

document.getElementById('openrouter-link')!.addEventListener('click', (e) => {
  e.preventDefault();
  window.vellum.openExternal('https://openrouter.ai/keys');
});

document.getElementById('homepage-link')!.addEventListener('click', (e) => {
  e.preventDefault();
  window.vellum.openExternal('https://www.arunkant.com/vellum/');
});

settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) {
    settingsOverlay.style.display = 'none';
  }
});

saveSettingsBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  const model = modelSelect.value;
  const aiProvider = providerSelect.value as AIProvider;
  await window.vellum.saveConfig({ aiProvider, openrouterApiKey: key, aiModel: model });
  settingsStatus.textContent = 'Saved';
  updateSettingsHint(key);
  setTimeout(() => { settingsStatus.textContent = ''; }, 2000);
});

providerSelect.addEventListener('change', () => {
  applyProviderVisibility(providerSelect.value as AIProvider);
});

downloadModelBtn.addEventListener('click', () => {
  window.vellum.downloadLocalModel();
});

cancelDownloadBtn.addEventListener('click', () => {
  window.vellum.cancelLocalModelDownload();
});

stopServerBtn.addEventListener('click', () => {
  window.vellum.stopLocalServer();
});

document.getElementById('folder-btn')!.addEventListener('click', () => {
  window.vellum.showScreenshotsFolder();
});

window.vellum.onLocalLlmStatus((status) => renderLocalLlmStatus(status));

// Esc closes settings, or clears search when search has focus
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (settingsOverlay.style.display === 'flex') {
      settingsOverlay.style.display = 'none';
    } else if (document.activeElement === searchInput && searchQuery) {
      searchInput.value = '';
      searchQuery = '';
      renderScreenshots(filterScreenshots(''));
    }
  }
});

async function init() {
  await refreshScreenshots();

  window.vellum.onScreenshotAdded((screenshots) => {
    allScreenshots = screenshots;
    renderScreenshots(filterScreenshots(searchQuery));
    showToast('Screenshot captured');
  });

  window.vellum.onAIResultReady(async (data) => {
    showToast(`AI analysis ready: ${data.filename}`);
    await refreshScreenshots();
    if (currentDetail && currentDetail.name === data.filename) {
      const updated = allScreenshots.find((s) => s.name === data.filename);
      if (updated) openDetail(updated);
    }
  });

  document.getElementById('capture-btn')!.addEventListener('click', async () => {
    showToast('Drag to select a region…');
    await window.vellum.captureRegion();
  });

  document.getElementById('full-capture-btn')!.addEventListener('click', async () => {
    showToast('Capturing full screen…');
    allScreenshots = await window.vellum.captureFullScreen();
    renderScreenshots(filterScreenshots(searchQuery));
    showToast('Full screen captured');
  });

  // Native search input fires 'input' for typing and clearing (X button)
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      renderScreenshots(filterScreenshots(searchQuery));
    }, 200);
  });

  document.addEventListener('keydown', async (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '1') {
      e.preventDefault();
      showToast('Drag to select a region…');
      await window.vellum.captureRegion();
    } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '2') {
      e.preventDefault();
      showToast('Capturing full screen…');
      allScreenshots = await window.vellum.captureFullScreen();
      renderScreenshots(filterScreenshots(searchQuery));
      showToast('Full screen captured');
    }
  });
}

init();
