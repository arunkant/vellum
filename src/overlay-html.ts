/**
 * HTML for the region capture overlay window. Loaded as a data URL into a
 * transparent fullscreen BrowserWindow with `overlay-preload.js`.
 */
export function getOverlayHTML(totalBounds: { x: number; y: number; width: number; height: number }): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%;
    overflow: hidden;
    cursor: crosshair;
    user-select: none;
    background: transparent;
  }
  #overlay {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }
  #selection {
    position: fixed;
    border: 2px solid #8b5cf6;
    background: rgba(139, 92, 246, 0.08);
    display: none;
    pointer-events: none;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);
  }
  #info {
    position: fixed;
    display: none;
    padding: 4px 8px;
    background: rgba(0,0,0,0.8);
    color: #e8e8ed;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 12px;
    border-radius: 4px;
    pointer-events: none;
    white-space: nowrap;
  }
  #hint {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    color: rgba(255,255,255,0.7);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    text-align: center;
    pointer-events: none;
    text-shadow: 0 1px 3px rgba(0,0,0,0.5);
  }
  #hint span { display: block; font-size: 11px; opacity: 0.6; margin-top: 6px; }
</style>
</head>
<body>

<div id="overlay"></div>
<div id="selection"></div>
<div id="info"></div>
<div id="hint">
  Drag to select a region
  <span>Press Esc to cancel</span>
</div>

<script>
  const api = window.overlay;
  const selection = document.getElementById('selection');
  const info = document.getElementById('info');
  const hint = document.getElementById('hint');

  const totalBounds = ${JSON.stringify(totalBounds)};

  let startX = 0, startY = 0;
  let isDragging = false;
  let cancelled = false;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function updateSelection() {
    if (!isDragging) return;
    const pt = api.cursorPoint();
    const currentX = clamp(pt.x, totalBounds.x, totalBounds.x + totalBounds.width);
    const currentY = clamp(pt.y, totalBounds.y, totalBounds.y + totalBounds.height);

    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);

    selection.style.display = 'block';
    selection.style.left = (x - totalBounds.x) + 'px';
    selection.style.top = (y - totalBounds.y) + 'px';
    selection.style.width = w + 'px';
    selection.style.height = h + 'px';

    info.style.display = 'block';
    info.style.left = Math.min(currentX - totalBounds.x + 16, totalBounds.width - 120) + 'px';
    info.style.top = Math.max(currentY - totalBounds.y - 30, 4) + 'px';
    info.textContent = Math.round(w) + ' × ' + Math.round(h) + ' px';
  }

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const pt = api.cursorPoint();
    startX = pt.x;
    startY = pt.y;
    isDragging = true;
    hint.style.display = 'none';
  });

  document.addEventListener('mousemove', updateSelection);

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;

    const pt = api.cursorPoint();
    const endX = clamp(pt.x, totalBounds.x, totalBounds.x + totalBounds.width);
    const endY = clamp(pt.y, totalBounds.y, totalBounds.y + totalBounds.height);

    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);

    if (w < 10 || h < 10) {
      api.cancelled();
      return;
    }
    api.selected({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      cancelled = true;
      api.cancelled();
    }
  });

  // Plain click without meaningful drag → full screen.
  document.addEventListener('click', () => {
    setTimeout(() => {
      if (!isDragging && !cancelled && selection.style.display === 'none') {
        api.selected({ x: totalBounds.x, y: totalBounds.y, width: totalBounds.width, height: totalBounds.height });
      }
    }, 50);
  });

  document.addEventListener('contextmenu', (e) => e.preventDefault());
</script>
</body>
</html>`;
}
