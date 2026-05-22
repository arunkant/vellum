import { app, clipboard, ipcMain, nativeImage, shell } from 'electron';
import path from 'node:path';
import { getConfig, saveConfig, type AIProvider } from './config';
import {
  chatAboutScreenshot,
  downloadLocalModel,
  cancelLocalDownload,
  getLocalLlmStatus,
  runPromptAgainstScreenshot,
  stopLocalServer,
} from './ai';
import { findSavedPrompt, SAVED_PROMPTS } from './ai/saved-prompts';
import { aiResultsTbl, chatMessagesTbl, screenshotsTbl, tagsTbl } from './db';
import {
  listScreenshots,
  resolveScreenshotPath,
  deleteScreenshot,
  screenshotsDir,
} from './screenshots';
import { captureRegion, captureFullScreen, getActiveBrowserURL, Region } from './capture';
import { decorateScreenshot } from './decorate';
import {
  openRegionCapture,
  closeOverlay,
  openChatWindow,
  closeChatWindow,
  restoreWindowsHiddenForCapture,
  notifyScreenshotsUpdated,
  takePendingRegionCaptureURL,
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

  ipcMain.handle('capture-region', async () => {
    await openRegionCapture();
    return listScreenshots();
  });

  ipcMain.handle('capture-fullscreen', async () => {
    const url = await getActiveBrowserURL();
    const filepath = await captureFullScreen(url);
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

  ipcMain.handle('get-app-version', () => app.getVersion());

  // Overlay → main
  ipcMain.on('overlay:selected', async (_e, region: Region) => {
    closeOverlay();
    // Brief delay so the overlay isn't captured in the screenshot.
    await new Promise((r) => setTimeout(r, 200));
    const filepath = await captureRegion(region, takePendingRegionCaptureURL());
    // Restore *after* capture so our own UI isn't pulled into the screenshot.
    // On success, onScreenshotCaptured opens a new chat window which makes
    // the restored chat (if any) get destroyed and recreated — that's fine.
    restoreWindowsHiddenForCapture();
    if (filepath) onScreenshotCaptured(filepath);
  });

  ipcMain.on('overlay:cancelled', () => {
    closeOverlay();
    restoreWindowsHiddenForCapture();
  });

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

  ipcMain.handle('chat-run-prompt', async (_e, filepath: string, promptId: string) => {
    const safe = resolveScreenshotPath(filepath);
    if (!safe) return null;
    const row = screenshotsTbl.findByFilename(path.basename(safe));
    if (!row) return null;
    const saved = SAVED_PROMPTS.find((p) => p.id === promptId) ?? findSavedPrompt(promptId);
    if (!saved) return null;

    chatMessagesTbl.add(row.id, { role: 'user', text: `/${saved.command}`, time: Date.now() });
    const reply = await runPromptAgainstScreenshot(safe, saved.prompt);
    if (reply) {
      chatMessagesTbl.add(row.id, { role: 'ai', text: reply, time: Date.now() });
    }
    return reply;
  });

  ipcMain.handle('chat-add-tag', (_e, filepath: string, tag: string) => {
    const safe = resolveScreenshotPath(filepath);
    if (!safe) return [];
    const filename = path.basename(safe);
    const row = screenshotsTbl.findByFilename(filename);
    if (!row) return [];
    const cleaned = normalizeTag(tag);
    if (cleaned) tagsTbl.add(row.id, cleaned);
    return tagsTbl.listByFilename(filename);
  });

  ipcMain.handle('chat-remove-tag', (_e, filepath: string, tag: string) => {
    const safe = resolveScreenshotPath(filepath);
    if (!safe) return [];
    const filename = path.basename(safe);
    const row = screenshotsTbl.findByFilename(filename);
    if (!row) return [];
    const cleaned = normalizeTag(tag);
    if (cleaned) tagsTbl.remove(row.id, cleaned);
    return tagsTbl.listByFilename(filename);
  });

  ipcMain.handle('chat-copy-image', (_e, filepath: string) => {
    const safe = resolveScreenshotPath(filepath);
    if (!safe) return false;
    const img = nativeImage.createFromPath(safe);
    if (img.isEmpty()) return false;
    clipboard.writeImage(img);
    return true;
  });

  ipcMain.handle('chat-copy-shadow', async (_e, filepath: string) => {
    const safe = resolveScreenshotPath(filepath);
    if (!safe) return false;
    const img = await decorateScreenshot(safe);
    if (!img || img.isEmpty()) return false;
    clipboard.writeImage(img);
    return true;
  });

  ipcMain.handle('chat-copy-as', (_e, filepath: string, format: 'slack' | 'jira') => {
    const safe = resolveScreenshotPath(filepath);
    if (!safe) return false;
    const filename = path.basename(safe);
    const ai = aiResultsTbl.getByFilename(filename);
    const tags = tagsTbl.listByFilename(filename);
    const text = format === 'jira'
      ? formatForJira(filename, ai?.description ?? '', tags)
      : formatForSlack(filename, ai?.description ?? '', tags);
    const img = nativeImage.createFromPath(safe);
    if (!img.isEmpty()) {
      clipboard.write({ text, image: img });
    } else {
      clipboard.writeText(text);
    }
    return true;
  });

  ipcMain.handle('chat-list-tags', (_e, filepath: string) => {
    const safe = resolveScreenshotPath(filepath);
    return safe ? tagsTbl.listByFilename(path.basename(safe)) : [];
  });

  ipcMain.handle('chat-get-history', (_e, filepath: string) => {
    const safe = resolveScreenshotPath(filepath);
    return safe ? chatMessagesTbl.getByFilename(path.basename(safe)) : [];
  });

  ipcMain.handle('chat-list-saved-prompts', () => SAVED_PROMPTS);

  ipcMain.handle('chat-delete-screenshot', (_e, filepath: string) => {
    const safe = resolveScreenshotPath(filepath);
    if (!safe) return false;
    deleteScreenshot(safe);
    notifyScreenshotsUpdated();
    closeChatWindow();
    return true;
  });

  ipcMain.on('chat-window-close', () => closeChatWindow());

  ipcMain.handle('open-chat-window', (_e, filepath: string) => {
    const safe = resolveScreenshotPath(filepath);
    if (safe) openChatWindow(safe);
  });
}

function normalizeTag(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const stripped = raw.trim().replace(/^#+/, '').toLowerCase();
  const cleaned = stripped.replace(/[^a-z0-9_\-/]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned.length > 0 && cleaned.length <= 64 ? cleaned : null;
}

function formatForSlack(filename: string, description: string, tags: string[]): string {
  const lines: string[] = [];
  lines.push(`*Screenshot:* \`${filename}\``);
  if (description) lines.push('', description);
  if (tags.length) lines.push('', tags.map((t) => `\`#${t}\``).join(' '));
  return lines.join('\n');
}

function formatForJira(filename: string, description: string, tags: string[]): string {
  const lines: string[] = [];
  lines.push(`*Screenshot:* {{${filename}}}`);
  if (description) lines.push('', description);
  if (tags.length) lines.push('', tags.map((t) => `{{#${t}}}`).join(' '));
  return lines.join('\n');
}
