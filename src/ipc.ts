import { ipcMain, shell } from 'electron';
import path from 'node:path';
import { getConfig, saveConfig, type AIProvider } from './config';
import {
  chatAboutScreenshot,
  downloadLocalModel,
  cancelLocalDownload,
  getLocalLlmStatus,
  stopLocalServer,
} from './ai';
import { aiResultsTbl, chatMessagesTbl, screenshotsTbl } from './db';
import {
  listScreenshots,
  resolveScreenshotPath,
  deleteScreenshot,
  screenshotsDir,
} from './screenshots';
import { captureRegion, captureFullScreen, Region } from './capture';
import {
  openRegionCapture,
  closeOverlay,
  openChatWindow,
  closeChatWindow,
} from './windows';

export interface IPCHandlers {
  onScreenshotCaptured: (filepath: string) => void;
}

export function setupIPC({ onScreenshotCaptured }: IPCHandlers) {
  ipcMain.handle('get-screenshots', () => listScreenshots());

  ipcMain.handle('open-screenshot', async (_e, filepath: string) => {
    const safe = resolveScreenshotPath(filepath);
    if (!safe) return false;
    try { await shell.openPath(safe); return true; } catch { return false; }
  });

  ipcMain.handle('delete-screenshot', async (_e, filepath: string) => {
    const safe = resolveScreenshotPath(filepath);
    if (safe) deleteScreenshot(safe);
    return listScreenshots();
  });

  ipcMain.handle('capture-region', () => {
    openRegionCapture();
    return listScreenshots();
  });

  ipcMain.handle('capture-fullscreen', async () => {
    const filepath = await captureFullScreen();
    if (filepath) onScreenshotCaptured(filepath);
    return listScreenshots();
  });

  ipcMain.handle('show-screenshots-folder', () => shell.openPath(screenshotsDir));

  ipcMain.handle('get-config', () => getConfig());
  ipcMain.handle(
    'save-config',
    (_e, config: Partial<{ aiProvider: AIProvider; openrouterApiKey: string; aiModel: string; localServerPort: number }>) => {
      const prev = getConfig();
      const next = saveConfig(config);
      // Switching away from local → stop the running server to free RAM.
      if (prev.aiProvider === 'local' && next.aiProvider !== 'local') {
        stopLocalServer();
      }
      return next;
    },
  );

  ipcMain.handle('local-llm:status', () => getLocalLlmStatus());
  ipcMain.handle('local-llm:download', () => { downloadLocalModel(); return true; });
  ipcMain.handle('local-llm:cancel-download', () => { cancelLocalDownload(); return true; });
  ipcMain.handle('local-llm:stop-server', () => { stopLocalServer(); return true; });

  ipcMain.handle('get-ai-result', (_e, filename: string) => {
    const safe = resolveScreenshotPath(filename);
    return safe ? aiResultsTbl.getByFilename(path.basename(safe)) : null;
  });

  ipcMain.handle('open-external', (_e, url: string) => shell.openExternal(url));

  // Overlay → main
  ipcMain.on('overlay:selected', async (_e, region: Region) => {
    closeOverlay();
    // Brief delay so the overlay isn't captured in the screenshot.
    await new Promise((r) => setTimeout(r, 200));
    const filepath = await captureRegion(region);
    if (filepath) onScreenshotCaptured(filepath);
  });

  ipcMain.on('overlay:cancelled', () => closeOverlay());

  // Chat window
  ipcMain.handle('chat-message', async (_e, filepath: string, message: string) => {
    const safe = resolveScreenshotPath(filepath);
    if (!safe || typeof message !== 'string' || message.length === 0) return null;
    const row = screenshotsTbl.findByFilename(path.basename(safe));
    if (!row) return null;

    chatMessagesTbl.add(row.id, { role: 'user', text: message, time: Date.now() });
    const reply = await chatAboutScreenshot(safe, message);
    if (reply) {
      chatMessagesTbl.add(row.id, { role: 'ai', text: reply, time: Date.now() });
    }
    return reply;
  });

  ipcMain.on('chat-window-close', () => closeChatWindow());

  ipcMain.handle('open-chat-window', (_e, filepath: string) => {
    const safe = resolveScreenshotPath(filepath);
    if (safe) openChatWindow(safe);
  });
}
