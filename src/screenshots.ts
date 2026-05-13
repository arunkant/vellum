import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { aiCache, chatHistory } from './storage';

export const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

export interface ScreenshotEntry {
  name: string;
  path: string;
  time: number;
  aiText: string | null;
  aiDescription: string | null;
  aiModel: string | null;
  hasChat: boolean;
  chatPreview: string | null;
}

/**
 * Resolve a screenshot name/path to an absolute path confined to screenshotsDir.
 * Returns null on path traversal or non-png input.
 */
export function resolveScreenshotPath(input: string): string | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  const base = path.basename(input);
  if (base !== input && path.dirname(input) !== screenshotsDir) return null;
  if (!base.toLowerCase().endsWith('.png')) return null;
  const resolved = path.resolve(screenshotsDir, base);
  if (resolved !== path.join(screenshotsDir, base)) return null;
  if (!resolved.startsWith(screenshotsDir + path.sep)) return null;
  return resolved;
}

export function listScreenshots(): ScreenshotEntry[] {
  try {
    return fs.readdirSync(screenshotsDir)
      .filter((f) => f.endsWith('.png'))
      .map((f) => {
        const fullPath = path.join(screenshotsDir, f);
        const stats = fs.statSync(fullPath);
        const ai = aiCache.get(f);
        const msgs = chatHistory.get(f);
        return {
          name: f,
          path: fullPath,
          time: stats.mtimeMs,
          aiText: ai?.extractedText ?? null,
          aiDescription: ai?.description ?? null,
          aiModel: ai?.model ?? null,
          hasChat: msgs.length > 0,
          chatPreview: msgs.length > 0 ? msgs.map((m) => m.text).join(' ').slice(0, 300) : null,
        };
      })
      .sort((a, b) => b.time - a.time);
  } catch {
    return [];
  }
}

export function deleteScreenshot(filepath: string) {
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    chatHistory.remove(path.basename(filepath));
  } catch (err) {
    console.error('Failed to delete screenshot:', err);
  }
}
