import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  desktopCapturer,
  screen,
  nativeImage,
  ipcMain,
  shell,
  protocol,
  net,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { getOverlayHTML } from './overlay-content';
import { analyzeScreenshot, chatAboutScreenshot, getConfig, saveConfig, getAIResult, clearAICache, getChatHistory, addChatMessage, hasChatHistory, deleteChatHistory, type AIResult, type ChatMessage } from './ai-service';
import { getChatWindowHTML } from './chat-window-content';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Directory to store screenshots
const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');

// Ensure screenshots directory exists
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

// Create a simple tray icon programmatically (16x16 colored circle)
function createTrayIcon(): nativeImage {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const cx = x - size / 2;
      const cy = y - size / 2;
      const dist = Math.sqrt(cx * cx + cy * cy);

      if (dist <= size / 2 - 1) {
        const alpha = dist < size / 2 - 3 ? 255 : 128;
        buffer[idx] = 139;       // R
        buffer[idx + 1] = 92;    // G
        buffer[idx + 2] = 246;   // B
        buffer[idx + 3] = alpha; // A
      } else {
        buffer[idx] = 0;
        buffer[idx + 1] = 0;
        buffer[idx + 2] = 0;
        buffer[idx + 3] = 0;
      }
    }
  }

  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function getScreenshots(): Array<{
  name: string;
  path: string;
  time: number;
  aiText: string | null;
  aiDescription: string | null;
  aiModel: string | null;
  hasChat: boolean;
  chatPreview: string | null;
}> {
  try {
    const files = fs.readdirSync(screenshotsDir);
    return files
      .filter((f) => f.endsWith('.png'))
      .map((f) => {
        const fullPath = path.join(screenshotsDir, f);
        const stats = fs.statSync(fullPath);
        const ai = getAIResult(f);
        const chatMsgs = getChatHistory(f);
        const chatPreview = chatMsgs.length > 0
          ? chatMsgs.map((m) => m.text).join(' ').slice(0, 300)
          : null;
        return {
          name: f,
          path: fullPath,
          time: stats.mtimeMs,
          aiText: ai?.extractedText || null,
          aiDescription: ai?.description || null,
          aiModel: ai?.model || null,
          hasChat: chatMsgs.length > 0,
          chatPreview,
        };
      })
      .sort((a, b) => b.time - a.time);
  } catch {
    return [];
  }
}

/** After a screenshot is saved, run AI analysis and notify the renderer */
async function onScreenshotCaptured(filepath: string) {
  const filename = path.basename(filepath);

  // Open the floating chat window immediately
  openChatWindow(filepath, filename);

  notifyScreenshotsUpdated();

  // Run AI analysis in background
  const config = getConfig();
  if (!config.openrouterApiKey) return;

  try {
    const result = await analyzeScreenshot(filepath);
    if (result && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ai-result-ready', {
        filename,
        text: result.extractedText,
        description: result.description,
        model: result.model,
      });
    }
  } catch (err) {
    console.error('Background AI analysis failed:', err);
  }
}

/** Get the total bounds covering all displays */
function getTotalBounds(): { x: number; y: number; width: number; height: number } {
  const displays = screen.getAllDisplays();
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const d of displays) {
    const { x, y, width, height } = d.bounds;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Capture a specific region of the screen and save to file */
async function captureRegion(
  region: { x: number; y: number; width: number; height: number },
): Promise<string | null> {
  try {
    // Use the primary display's thumbnail and crop
    const { width: displayW, height: displayH } = screen.getPrimaryDisplay().bounds;
    const totalBounds = getTotalBounds();

    // Request thumbnail at full resolution of the total display area
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: totalBounds.width, height: totalBounds.height },
    });

    if (sources.length === 0) return null;

    const fullImage = sources[0].thumbnail;

    // If the source thumbnail doesn't cover the region exactly, try to find the right display
    // For simplicity, crop from the full image relative to totalBounds
    const cropX = region.x - totalBounds.x;
    const cropY = region.y - totalBounds.y;

    // Ensure crop is within bounds
    const cx = Math.max(0, cropX);
    const cy = Math.max(0, cropY);
    const cw = Math.min(region.width, fullImage.getSize().width - cx);
    const ch = Math.min(region.height, fullImage.getSize().height - cy);

    if (cw <= 0 || ch <= 0) return null;

    const cropped = fullImage.crop({ x: cx, y: cy, width: cw, height: ch });

    // If the cropped image is smaller than expected (desktopCapturer may scale),
    // adjust by taking a second capture at native resolution
    const croppedSize = cropped.getSize();
    const scaleX = displayW / totalBounds.width;
    const scaleY = displayH / totalBounds.height;

    // Save to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot-${timestamp}.png`;
    const filepath = path.join(screenshotsDir, filename);

    const pngBuffer = cropped.toPNG();
    fs.writeFileSync(filepath, pngBuffer);

    return filepath;
  } catch (err) {
    console.error('Region capture failed:', err);
    return null;
  }
}

/** Open the transparent overlay for drag-to-select region capture */
function openRegionCapture() {
  // Prevent multiple overlays
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.focus();
    return;
  }

  const totalBounds = getTotalBounds();

  // Create hidden first to avoid space-switch on macOS
  overlayWindow = new BrowserWindow({
    x: totalBounds.x,
    y: totalBounds.y,
    width: totalBounds.width,
    height: totalBounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    fullscreenable: false,
    focusable: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: false,
    },
  });

  // Must set these BEFORE showing to appear on fullscreen spaces
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');

  // Load the overlay HTML as a data URL
  const html = getOverlayHTML(totalBounds);
  overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  overlayWindow.once('ready-to-show', () => {
    overlayWindow?.showInactive();
  });

  // Prevent window from being closed by Cmd+W / Alt+F4
  overlayWindow.on('close', (e) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      e.preventDefault();
    }
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function closeOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
    overlayWindow = null;
  }
}

/** Open the floating chat window for a captured screenshot */
function openChatWindow(filepath: string, filename: string) {
  // Close existing chat window
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.destroy();
    chatWindow = null;
  }

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const winW = 420;
  const winH = 520;
  const winX = Math.round((sw - winW) / 2);
  const winY = Math.round((sh - winH) / 2);

  chatWindow = new BrowserWindow({
    x: winX,
    y: winY,
    width: winW,
    height: winH,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    hasShadow: true,
    focusable: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: false,
    },
    title: 'Vellum Chat',
  });

  chatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  chatWindow.setAlwaysOnTop(true, 'floating');

  const history = getChatHistory(filename);
  const html = getChatWindowHTML(filepath, filename, history);
  chatWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  chatWindow.once('ready-to-show', () => {
    chatWindow?.show();
    chatWindow?.focus();
  });

  chatWindow.on('closed', () => {
    chatWindow = null;
  });
}

function closeChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.destroy();
    chatWindow = null;
  }
}

function notifyScreenshotsUpdated() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('screenshot-added', getScreenshots());
  }
}

/** Full-screen capture (fallback / quick capture) */
async function captureFullScreen(): Promise<string | null> {
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
    });

    if (sources.length === 0) return null;

    const image = sources[0].thumbnail;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot-${timestamp}.png`;
    const filepath = path.join(screenshotsDir, filename);

    const pngBuffer = image.toPNG();
    fs.writeFileSync(filepath, pngBuffer);

    return filepath;
  } catch (err) {
    console.error('Full-screen capture failed:', err);
    return null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Vellum - AI Helper',
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Vellum - AI Helper');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Vellum',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: 'Capture Region (Drag)',
      accelerator: 'CmdOrCtrl+Shift+1',
      click: () => {
        openRegionCapture();
      },
    },
    {
      label: 'Capture Full Screen',
      accelerator: 'CmdOrCtrl+Shift+2',
      click: async () => {
        const filepath = await captureFullScreen();
        if (filepath) onScreenshotCaptured(filepath);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function registerShortcuts() {
  // Region capture
  const ok1 = globalShortcut.register('CmdOrCtrl+Shift+1', () => {
    console.log('Global shortcut: CmdOrCtrl+Shift+1 (region capture)');
    openRegionCapture();
  });

  // Full-screen capture
  const ok2 = globalShortcut.register('CmdOrCtrl+Shift+2', async () => {
    console.log('Global shortcut: CmdOrCtrl+Shift+2 (full screen)');
    const filepath = await captureFullScreen();
    if (filepath) onScreenshotCaptured(filepath);
  });

  if (!ok1) console.error('Failed to register CmdOrCtrl+Shift+1');
  if (!ok2) console.error('Failed to register CmdOrCtrl+Shift+2');
}

function setupIPC() {
  ipcMain.handle('get-screenshots', () => getScreenshots());

  ipcMain.handle('open-screenshot', async (_event, filepath: string) => {
    try {
      await shell.openPath(filepath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('delete-screenshot', async (_event, filepath: string) => {
    try {
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      deleteChatHistory(path.basename(filepath));
    } catch { /* ignore */ }
    return getScreenshots();
  });

  // Trigger region capture from renderer
  ipcMain.handle('capture-region', async () => {
    openRegionCapture();
    return getScreenshots();
  });

  // Trigger full-screen capture from renderer
  ipcMain.handle('capture-fullscreen', async () => {
    const filepath = await captureFullScreen();
    if (filepath) onScreenshotCaptured(filepath);
    return getScreenshots();
  });

  ipcMain.handle('show-screenshots-folder', async () => {
    await shell.openPath(screenshotsDir);
  });

  // Settings / Config
  ipcMain.handle('get-config', () => getConfig());

  ipcMain.handle('save-config', (_event, config: Partial<{ openrouterApiKey: string; aiModel: string }>) => {
    return saveConfig(config);
  });

  // AI results for a specific screenshot
  ipcMain.handle('get-ai-result', (_event, filename: string) => {
    return getAIResult(filename);
  });

  // Clear AI cache
  ipcMain.handle('clear-ai-cache', () => {
    clearAICache();
    return true;
  });

  // Open URL in default browser
  ipcMain.handle('open-external', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // Overlay IPC: region selected
  ipcMain.on('capture-region-selected', async (event, region: { x: number; y: number; width: number; height: number }) => {
    closeOverlay();

    // Small delay to ensure overlay is gone before capturing
    await new Promise((resolve) => setTimeout(resolve, 200));

    const filepath = await captureRegion(region);
    if (filepath) onScreenshotCaptured(filepath);
  });

  // Overlay IPC: cancelled
  ipcMain.on('capture-cancelled', () => {
    closeOverlay();
  });

  // Chat window IPC
  ipcMain.handle('chat-message', async (_event, filepath: string, message: string) => {
    const filename = path.basename(filepath);
    // Save user message
    addChatMessage(filename, { role: 'user', text: message, time: Date.now() });
    // Get AI reply
    const reply = await chatAboutScreenshot(filepath, message);
    if (reply) {
      addChatMessage(filename, { role: 'ai', text: reply, time: Date.now() });
    }
    return reply;
  });

  ipcMain.handle('get-chat-history', (_event, filename: string) => {
    return getChatHistory(filename);
  });

  ipcMain.on('chat-window-close', () => {
    closeChatWindow();
  });

  // Open chat window from renderer (gallery)
  ipcMain.handle('open-chat-window', (_event, filepath: string, filename: string) => {
    openChatWindow(filepath, filename);
  });
}

// App lifecycle
app.whenReady().then(() => {
  // Register custom protocol to serve screenshots to the renderer
  // (file:// is blocked when contextIsolation is enabled)
  protocol.handle('vellum-file', (request) => {
    const filePath = decodeURIComponent(request.url.replace('vellum-file://', ''));
    return net.fetch(`file://${filePath}`);
  });
  setupIPC();
  createWindow();
  createTray();
  registerShortcuts();

  // Run as accessory app — tray only, never steals focus from fullscreen apps
  app.setActivationPolicy('accessory');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  closeChatWindow();
  globalShortcut.unregisterAll();
});
