import fs from 'node:fs';
import path from 'node:path';
import { screenshotsDir } from '../screenshots';

export interface EncodedScreenshot {
  filename: string;
  filepath: string;
  createdAt: number;
}

/** Encode a NativeImage as PNG, write to disk, and return its location. */
export function saveAsPng(image: Electron.NativeImage): EncodedScreenshot {
  const createdAt = Date.now();
  const timestamp = new Date(createdAt).toISOString().replace(/[:.]/g, '-');
  const filename = `screenshot-${timestamp}.png`;
  const filepath = path.join(screenshotsDir, filename);
  fs.writeFileSync(filepath, image.toPNG());
  return { filename, filepath, createdAt };
}
