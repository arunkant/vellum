import { app, BrowserWindow, globalShortcut, net, protocol } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { analyzeScreenshot } from './ai';
import { captureFullScreen } from './capture';
import { resolveScreenshotPath } from './screenshots';
import { setupIPC } from './ipc';
import {
  createMainWindow,
  createTray,
  openRegionCapture,
  closeChatWindow,
  openChatWindow,
  notifyAIResult,
  notifyScreenshotsUpdated,
  showMainWindow,
  setQuitting,
} from './windows';

if (started) app.quit();

/** After a screenshot lands on disk: show chat window, refresh gallery, run AI. */
async function onScreenshotCaptured(filepath: string) {
  const filename = path.basename(filepath);
  openChatWindow(filepath);
  notifyScreenshotsUpdated();

  try {
    const result = await analyzeScreenshot(filepath);
    if (result) {
      notifyAIResult({
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

async function fullScreenAndProcess() {
  const filepath = await captureFullScreen();
  if (filepath) onScreenshotCaptured(filepath);
}

function registerShortcuts() {
  if (!globalShortcut.register('CmdOrCtrl+Shift+1', openRegionCapture)) {
    console.error('Failed to register CmdOrCtrl+Shift+1');
  }
  if (!globalShortcut.register('CmdOrCtrl+Shift+2', fullScreenAndProcess)) {
    console.error('Failed to register CmdOrCtrl+Shift+2');
  }
}

app.whenReady().then(() => {
  // Custom protocol so the renderer can load screenshots safely
  // (file:// is blocked under contextIsolation).
  protocol.handle('vellum-file', (request) => {
    const raw = decodeURIComponent(request.url.replace('vellum-file://', ''));
    const safe = resolveScreenshotPath(raw);
    if (!safe) return new Response('Forbidden', { status: 403 });
    return net.fetch(`file://${safe}`);
  });

  setupIPC({ onScreenshotCaptured });
  createMainWindow();
  createTray({ onRegion: openRegionCapture, onFull: fullScreenAndProcess });
  registerShortcuts();

  // Tray-only accessory app — doesn't steal focus from fullscreen apps.
  app.setActivationPolicy('accessory');

  // Launch automatically at login, hidden in the tray.
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      showMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => setQuitting(true));

app.on('will-quit', () => {
  closeChatWindow();
  globalShortcut.unregisterAll();
});
