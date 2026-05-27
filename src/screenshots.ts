import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { listScreenshotEntries, screenshotsTbl } from './db';

export const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

export interface ScreenshotEntry {
  name: string;
  path: string;
  time: number;
  url: string | null;
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
    return listScreenshotEntries().map((r) => ({
      name: r.name,
      path: r.path,
      time: r.time,
      url: r.url,
      aiText: r.aiText,
      aiDescription: r.aiDescription,
      aiModel: r.aiModel,
      hasChat: r.chatCount > 0,
      chatPreview: r.chatPreview ? r.chatPreview.slice(0, 300) : null,
    }));
  } catch (err) {
    console.error('Failed to list screenshots:', err);
    return [];
  }
}

export function deleteScreenshot(filepath: string) {
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    screenshotsTbl.deleteByFilename(path.basename(filepath));
  } catch (err) {
    console.error('Failed to delete screenshot:', err);
  }
}
