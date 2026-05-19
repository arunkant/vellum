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
  preview.addEventListener('click', () => {
    window.vellum.openScreenshot(shot.path);
  });
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

  const aiContent = shot.aiDescription || shot.aiText || '';
  if (aiContent) {
    const ai = document.createElement('div');
    ai.className = 'card-ai';
    ai.title = 'Click to expand';
    ai.textContent = aiContent.length > 140 ? aiContent.slice(0, 140) + '…' : aiContent;
    ai.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleAIDetail(card, shot.name);
    });
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
    if (!btn) return;
    e.stopPropagation();
    const action = btn.dataset.action;
    if (action === 'delete') {
      allScreenshots = await window.vellum.deleteScreenshot(shot.path);
      renderScreenshots(filterScreenshots(searchQuery));
      showToast('Screenshot deleted');
    } else if (action === 'open-chat') {
      window.vellum.openChatWindow(shot.path);
    }
  });

  return card;
}

function toggleAIDetail(card: HTMLElement, filename: string) {
  const existing = card.querySelector('.ai-detail-panel');
  if (existing) {
    existing.remove();
    return;
  }

  window.vellum.getAIResult(filename).then((result) => {
    if (!result) return;
    const content = result.description || result.extractedText || '';
    const modelShort = result.model.split('/').pop() || result.model;

    const panel = document.createElement('div');
    panel.className = 'ai-detail-panel';

    const header = document.createElement('div');
    header.className = 'ai-detail-header';
    header.innerHTML =
      '<span>AI Analysis</span>' +
      `<span class="ai-model-badge"></span>`;
    header.querySelector('.ai-model-badge')!.textContent = modelShort;
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'ai-detail-content';
    body.textContent = content;
    panel.appendChild(body);

    panel.addEventListener('click', (e) => e.stopPropagation());
    card.appendChild(panel);
  });
}

async function refreshScreenshots() {
  try {
    allScreenshots = await window.vellum.getScreenshots();
    renderScreenshots(filterScreenshots(searchQuery));
  } catch (err) {
    console.error('Failed to load screenshots:', err);
  }
}

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

  window.vellum.onAIResultReady((data) => {
    showToast(`AI analysis ready: ${data.filename}`);
    refreshScreenshots();
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
