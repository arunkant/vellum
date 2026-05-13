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
    /* Custom precision crosshair: white lines with a dark outline for contrast on any background, and a purple center dot. Hotspot is the center (16,16). */
    cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><g fill='none' stroke-linecap='round'><g stroke='black' stroke-width='3'><line x1='16' y1='2' x2='16' y2='12'/><line x1='16' y1='20' x2='16' y2='30'/><line x1='2' y1='16' x2='12' y2='16'/><line x1='20' y1='16' x2='30' y2='16'/></g><g stroke='white' stroke-width='1.5'><line x1='16' y1='2' x2='16' y2='12'/><line x1='16' y1='20' x2='16' y2='30'/><line x1='2' y1='16' x2='12' y2='16'/><line x1='20' y1='16' x2='30' y2='16'/></g></g><circle cx='16' cy='16' r='2' fill='%238b5cf6'/></svg>") 16 16, crosshair;
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

  // Window-local CSS px (clientX/Y) for drawing; absolute screen logical
  // points (screenX/Y) for the captured region. We don't derive screen coords
  // from clientX + totalBounds, since the OS can shift the window's actual
  // on-screen position slightly from what we requested.
  let startLX = 0, startLY = 0;
  let curLX = 0, curLY = 0;
  let startSX = 0, startSY = 0;
  let isDragging = false;
  let cancelled = false;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function render() {
    if (!isDragging) return;
    const cx = clamp(curLX, 0, totalBounds.width);
    const cy = clamp(curLY, 0, totalBounds.height);

    const x = Math.min(startLX, cx);
    const y = Math.min(startLY, cy);
    const w = Math.abs(cx - startLX);
    const h = Math.abs(cy - startLY);

    selection.style.display = 'block';
    selection.style.left = x + 'px';
    selection.style.top = y + 'px';
    selection.style.width = w + 'px';
    selection.style.height = h + 'px';

    info.style.display = 'block';
    info.style.left = Math.min(cx + 16, totalBounds.width - 120) + 'px';
    info.style.top = Math.max(cy - 30, 4) + 'px';
    info.textContent = Math.round(w) + ' × ' + Math.round(h) + ' px';
  }

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    startLX = e.clientX;
    startLY = e.clientY;
    curLX = e.clientX;
    curLY = e.clientY;
    startSX = e.screenX;
    startSY = e.screenY;
    isDragging = true;
    hint.style.display = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    curLX = e.clientX;
    curLY = e.clientY;
    render();
  });

  document.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;

    const endLX = clamp(e.clientX, 0, totalBounds.width);
    const endLY = clamp(e.clientY, 0, totalBounds.height);
    const w = Math.abs(endLX - startLX);
    const h = Math.abs(endLY - startLY);

    // Absolute screen coords: use the event's screenX/Y so we don't rely on
    // the window landing exactly where we requested.
    const x = Math.min(startSX, e.screenX);
    const y = Math.min(startSY, e.screenY);

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
