import './index.css';

type ScreenshotEntry = {
  name: string;
  path: string;
  time: number;
  aiText: string | null;
  aiDescription: string | null;
  aiModel: string | null;
  hasChat: boolean;
};

const emptyState = document.getElementById('empty-state')!;
const noMatchesState = document.getElementById('no-matches-state')!;
const grid = document.getElementById('screenshots-grid')!;
const statusText = document.getElementById('status-text')!;

// --- Search ---
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const searchClearBtn = document.getElementById('search-clear-btn')!;
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
    return false;
  });
}

// --- Settings panel ---
const settingsOverlay = document.getElementById('settings-overlay')!;
const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
const saveSettingsBtn = document.getElementById('save-settings-btn')!;
const settingsBtn = document.getElementById('settings-btn')!;
const closeSettingsBtn = document.getElementById('close-settings-btn')!;
const settingsStatus = document.getElementById('settings-status')!;

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

function escapeHTML(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderScreenshots(screenshots: ScreenshotEntry[]) {
  const isSearching = searchQuery.trim().length > 0;

  // No screenshots at all
  if (allScreenshots.length === 0) {
    emptyState.style.display = 'flex';
    noMatchesState.style.display = 'none';
    grid.style.display = 'none';
    return;
  }

  // Search returned no results
  if (isSearching && screenshots.length === 0) {
    emptyState.style.display = 'none';
    noMatchesState.style.display = 'flex';
    grid.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  noMatchesState.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';

  for (const shot of screenshots) {
    const card = document.createElement('div');
    card.className = 'screenshot-card';
    card.dataset.filename = shot.name;

    const hasAI = shot.aiText || shot.aiDescription;
    const aiLoading = !hasAI && !!shot.aiText === false; // No AI data yet

    let aiSection = '';
    if (hasAI) {
      aiSection = `
        <div class="card-ai">
          ${shot.aiDescription ? `<div class="ai-desc">🤖 ${escapeHTML(shot.aiDescription.slice(0, 120))}${shot.aiDescription.length > 120 ? '...' : ''}</div>` : ''}
          ${shot.aiText ? `<div class="ai-text-preview">📝 <span>${escapeHTML(shot.aiText.slice(0, 80))}${shot.aiText.length > 80 ? '...' : ''}</span></div>` : ''}
          ${shot.aiModel ? `<div class="ai-model-badge">${escapeHTML(shot.aiModel.split('/').pop() || shot.aiModel)}</div>` : ''}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-preview">
        <img
          src="vellum-file://${encodeURI(shot.path)}"
          alt="${shot.name}"
          loading="lazy"
          onerror="this.parentElement.innerHTML='<div class=\\'image-error\\'>🖼️<br/>Preview unavailable</div>'"
        />
      </div>
      <div class="card-info">
        <span class="card-time" title="${new Date(shot.time).toLocaleString()}">${formatTime(shot.time)}</span>
        <span class="card-name" title="${shot.name}">${shot.name}${shot.hasChat ? ' 💬' : ''}</span>
      </div>
      ${aiSection}
      <div class="card-actions">
        <button class="btn-icon" title="Chat about this screenshot" data-action="open-chat" data-filename="${shot.name}" data-path="${shot.path}">💬</button>
        ${hasAI ? '<button class="btn-icon" title="View AI details" data-action="view-ai" data-filename="' + shot.name + '">🔍</button>' : ''}
        <button class="btn-icon" title="Open" data-action="open" data-path="${shot.path}">👁️</button>
        <button class="btn-icon" title="Delete" data-action="delete" data-path="${shot.path}">🗑️</button>
      </div>
    `;

    // Click on card preview to open the image
    const preview = card.querySelector('.card-preview')!;
    preview.addEventListener('click', () => {
      window.vellum.openScreenshot(shot.path);
    });

    grid.appendChild(card);
  }
}

function showAIDetail(filename: string) {
  const card = document.querySelector(`[data-filename="${CSS.escape(filename)}"]`);
  if (!card) return;

  // Remove any existing detail panel
  const existing = card.querySelector('.ai-detail-panel');
  if (existing) {
    existing.remove();
    return;
  }

  window.vellum.getAIResult(filename).then((result) => {
    if (!result) return;

    const panel = document.createElement('div');
    panel.className = 'ai-detail-panel';

    panel.innerHTML = `
      <div class="ai-detail-header">
        <span>🤖 AI Analysis</span>
        <span class="ai-model-badge">${escapeHTML(result.model.split('/').pop() || result.model)}</span>
      </div>
      ${result.description ? `
        <div class="ai-detail-section">
          <div class="ai-detail-label">📋 Description</div>
          <div class="ai-detail-content">${escapeHTML(result.description)}</div>
        </div>
      ` : ''}
      ${result.extractedText ? `
        <div class="ai-detail-section">
          <div class="ai-detail-label">📝 Extracted Text</div>
          <pre class="ai-detail-text">${escapeHTML(result.extractedText)}</pre>
        </div>
      ` : ''}
      <button class="btn btn-secondary btn-sm ai-detail-close">Close</button>
    `;

    panel.querySelector('.ai-detail-close')!.addEventListener('click', () => panel.remove());
    card.appendChild(panel);
  });
}

function setStatus(msg: string) {
  statusText.textContent = msg;
  setTimeout(() => {
    statusText.textContent = '🟢 Ready — ⌘⇧1 drag region | ⌘⇧2 full screen';
  }, 3000);
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
async function loadSettings() {
  const config = await window.vellum.getConfig();
  apiKeyInput.value = config.openrouterApiKey || '';
  modelSelect.value = config.aiModel || 'google/gemini-2.5-flash-lite';
  updateSettingsHint(config.openrouterApiKey);
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

// OpenRouter link opens in default browser, not in-app
document.getElementById('openrouter-link')!.addEventListener('click', (e) => {
  e.preventDefault();
  window.vellum.openExternal('https://openrouter.ai/keys');
});

settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) {
    settingsOverlay.style.display = 'none';
  }
});

saveSettingsBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  const model = modelSelect.value;
  await window.vellum.saveConfig({ openrouterApiKey: key, aiModel: model });
  settingsStatus.textContent = '✅ Settings saved!';
  updateSettingsHint(key);
  setTimeout(() => { settingsStatus.textContent = ''; }, 2000);
});

// Close settings with Escape; also clear search if search is focused
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (settingsOverlay.style.display === 'flex') {
      settingsOverlay.style.display = 'none';
    } else if (document.activeElement === searchInput && searchQuery) {
      searchInput.value = '';
      searchQuery = '';
      searchClearBtn.style.display = 'none';
      renderScreenshots(filterScreenshots(''));
    }
  }
});

async function init() {
  await refreshScreenshots();

  // Single delegated click handler for all card actions
  grid.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest('[data-action]') as HTMLElement | null;
    if (!btn) return;

    const action = btn.dataset.action;
    const filepath = btn.dataset.path;
    const filename = btn.dataset.filename;

    if (action === 'open' && filepath) {
      await window.vellum.openScreenshot(filepath);
    } else if (action === 'delete' && filepath) {
      allScreenshots = await window.vellum.deleteScreenshot(filepath);
      renderScreenshots(filterScreenshots(searchQuery));
      setStatus('🗑️ Screenshot deleted');
    } else if (action === 'view-ai' && filename) {
      showAIDetail(filename);
    } else if (action === 'open-chat' && filename && filepath) {
      window.vellum.openChatWindow(filepath, filename);
    }
  });

  // Listen for new screenshots
  window.vellum.onScreenshotAdded((screenshots) => {
    allScreenshots = screenshots;
    renderScreenshots(filterScreenshots(searchQuery));
    setStatus('📸 Screenshot captured!');
  });

  // Listen for AI results coming in
  window.vellum.onAIResultReady((data) => {
    setStatus(`🤖 AI analysis complete for ${data.filename}`);
    // Refresh to show updated data
    refreshScreenshots();
  });

  // Region capture button
  document.getElementById('capture-btn')!.addEventListener('click', async () => {
    setStatus('✂️ Drag to select a region on screen...');
    await window.vellum.captureRegion();
  });

  // Full-screen capture button
  document.getElementById('full-capture-btn')!.addEventListener('click', async () => {
    setStatus('🖥️ Capturing full screen...');
    allScreenshots = await window.vellum.captureFullScreen();
    renderScreenshots(filterScreenshots(searchQuery));
    setStatus('📸 Full screen captured!');
  });

  // Open folder button
  document.getElementById('folder-btn')!.addEventListener('click', () => {
    window.vellum.showScreenshotsFolder();
  });

  // Search input with debounce
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    searchClearBtn.style.display = searchQuery ? 'block' : 'none';

    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      renderScreenshots(filterScreenshots(searchQuery));
    }, 200);
  });

  // Clear search
  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClearBtn.style.display = 'none';
    renderScreenshots(filterScreenshots(''));
    searchInput.focus();
  });

  // In-window keyboard shortcuts
  document.addEventListener('keydown', async (e) => {
    // Cmd+F / Ctrl+F → focus search
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '1') {
      e.preventDefault();
      setStatus('✂️ Drag to select a region on screen...');
      await window.vellum.captureRegion();
    } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '2') {
      e.preventDefault();
      setStatus('🖥️ Capturing full screen...');
      allScreenshots = await window.vellum.captureFullScreen();
      renderScreenshots(filterScreenshots(searchQuery));
      setStatus('📸 Full screen captured!');
    }
  });
}

init();
