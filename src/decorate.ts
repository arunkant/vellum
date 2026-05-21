import { BrowserWindow, nativeImage, screen } from 'electron';

// All measurements are in device pixels of the final image.
const RADIUS = 14;        // rounded corners on the capture
const SHADOW_BLUR = 38;   // softness of the drop shadow
const SHADOW_Y = 16;      // vertical offset of the drop shadow
const SHADOW_ALPHA = 0.45;
const MARGIN = 8;         // tiny gap so the faded shadow edge isn't hard-cut

// macOS frames window screenshots with *symmetric* transparent padding and lets
// the offset shadow sit a touch below centre. Mirror that: a `0 Yh Blur` shadow
// reaches farthest at the bottom (Blur + Y), so size one uniform padding to that
// extent — symmetric, but no larger than the shadow actually needs.
const PADDING = SHADOW_BLUR + SHADOW_Y + MARGIN;

/**
 * Composite `filepath` onto a transparent canvas with padding, rounded corners
 * and a soft drop shadow, then return the result.
 *
 * The work is done by laying the shot out in an offscreen BrowserWindow and
 * calling `capturePage()`, which keeps us from pulling in a native
 * image-processing dependency (sharp/canvas). We render the image at
 * `size / scaleFactor` CSS pixels so that capturePage — which renders at the
 * display's scale factor — reproduces the source pixels 1:1 and stays crisp.
 */
export async function decorateScreenshot(filepath: string): Promise<Electron.NativeImage | null> {
  const base = nativeImage.createFromPath(filepath);
  if (base.isEmpty()) return null;

  const { width: iw, height: ih } = base.getSize();
  const sf = screen.getPrimaryDisplay().scaleFactor || 1;

  const outW = iw + PADDING * 2;
  const outH = ih + PADDING * 2;
  const cssW = Math.round(outW / sf);
  const cssH = Math.round(outH / sf);

  const dataUrl = base.toDataURL();
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}
    body{display:flex;align-items:center;justify-content:center}
    img{
      width:${iw / sf}px;height:${ih / sf}px;display:block;
      border-radius:${RADIUS / sf}px;
      box-shadow:0 ${SHADOW_Y / sf}px ${SHADOW_BLUR / sf}px rgba(0,0,0,${SHADOW_ALPHA});
    }
  </style></head><body><img src="${dataUrl}"></body></html>`;

  const win = new BrowserWindow({
    width: cssW,
    height: cssH,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
    },
  });

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    // Wait for the embedded image to finish decoding and for a couple of frames
    // to paint before we grab the page, otherwise capturePage can race the
    // first layout and return a blank image.
    await win.webContents.executeJavaScript(`
      (async () => {
        const img = document.querySelector('img');
        if (img && !img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; });
        if (img && img.decode) { try { await img.decode(); } catch (e) { /* ignore */ } }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return true;
      })();
    `);
    const shot = await win.webContents.capturePage();
    return shot.isEmpty() ? null : shot;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
