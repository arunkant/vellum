import './index.css';

type ScreenshotEntry = { name: string; path: string; time: number };

const emptyState = document.getElementById('empty-state')!;
const grid = document.getElementById('screenshots-grid')!;
const statusText = document.getElementById('status-text')!;

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

function renderScreenshots(screenshots: ScreenshotEntry[]) {
  if (screenshots.length === 0) {
    emptyState.style.display = 'flex';
    grid.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';

  for (const shot of screenshots) {
    const card = document.createElement('div');
    card.className = 'screenshot-card';

    card.innerHTML = `
      <div class="card-preview">
        <img
          src="file://${shot.path}"
          alt="${shot.name}"
          loading="lazy"
          onerror="this.parentElement.innerHTML='<div class=\\'image-error\\'>🖼️<br/>Preview unavailable</div>'"
        />
      </div>
      <div class="card-info">
        <span class="card-time" title="${new Date(shot.time).toLocaleString()}">${formatTime(shot.time)}</span>
        <span class="card-name" title="${shot.name}">${shot.name}</span>
      </div>
      <div class="card-actions">
        <button class="btn-icon" title="Open" data-action="open" data-path="${shot.path}">👁️</button>
        <button class="btn-icon" title="Delete" data-action="delete" data-path="${shot.path}">🗑️</button>
      </div>
    `;

    // Click on card preview to open
    const preview = card.querySelector('.card-preview')!;
    preview.addEventListener('click', () => {
      window.vellum.openScreenshot(shot.path);
    });

    grid.appendChild(card);
  }

  // Delegate button clicks
  grid.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest('[data-action]') as HTMLElement | null;
    if (!btn) return;

    const action = btn.dataset.action;
    const filepath = btn.dataset.path;
    if (!filepath) return;

    if (action === 'open') {
      await window.vellum.openScreenshot(filepath);
    } else if (action === 'delete') {
      const updated = await window.vellum.deleteScreenshot(filepath);
      renderScreenshots(updated);
      setStatus(`🗑️ Screenshot deleted`);
    }
  });
}

function setStatus(msg: string) {
  statusText.textContent = msg;
  // Auto-reset after 3 seconds
  setTimeout(() => {
    statusText.textContent = '🟢 Ready — ⌘⇧1 drag region | ⌘⇧2 full screen';
  }, 3000);
}

async function refreshScreenshots() {
  try {
    const screenshots = await window.vellum.getScreenshots();
    renderScreenshots(screenshots);
  } catch (err) {
    console.error('Failed to load screenshots:', err);
  }
}

async function init() {
  // Load initial data
  await refreshScreenshots();

  // Listen for new screenshots from main process
  window.vellum.onScreenshotAdded((screenshots) => {
    renderScreenshots(screenshots);
    setStatus('📸 Screenshot captured!');
  });

  // Region capture button
  document.getElementById('capture-btn')!.addEventListener('click', async () => {
    setStatus('✂️ Drag to select a region on screen...');
    await window.vellum.captureRegion();
  });

  // Full-screen capture button
  document.getElementById('full-capture-btn')!.addEventListener('click', async () => {
    setStatus('🖥️ Capturing full screen...');
    const screenshots = await window.vellum.captureFullScreen();
    renderScreenshots(screenshots);
    setStatus('📸 Full screen captured!');
  });

  // Open folder button
  document.getElementById('folder-btn')!.addEventListener('click', () => {
    window.vellum.showScreenshotsFolder();
  });

  // Keyboard shortcuts within the window
  document.addEventListener('keydown', async (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '1') {
      e.preventDefault();
      setStatus('✂️ Drag to select a region on screen...');
      await window.vellum.captureRegion();
    } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '2') {
      e.preventDefault();
      setStatus('🖥️ Capturing full screen...');
      const screenshots = await window.vellum.captureFullScreen();
      renderScreenshots(screenshots);
      setStatus('📸 Full screen captured!');
    }
  });
}

init();
