import { desktopCapturer, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { screenshotsDir } from './screenshots';

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bounding box covering every display. */
export function getTotalBounds(): Region {
  const displays = screen.getAllDisplays();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of displays) {
    const { x, y, width, height } = d.bounds;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + width > maxX) maxX = x + width;
    if (y + height > maxY) maxY = y + height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function saveAsScreenshot(image: Electron.NativeImage): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filepath = path.join(screenshotsDir, `screenshot-${timestamp}.png`);
  fs.writeFileSync(filepath, image.toPNG());
  return filepath;
}

export async function captureRegion(region: Region): Promise<string | null> {
  try {
    const displays = screen.getAllDisplays();

    // Find display with most overlap with the selected region.
    let best = displays[0];
    let bestOverlap = -1;
    for (const d of displays) {
      const b = d.bounds;
      const ox = Math.max(0, Math.min(region.x + region.width, b.x + b.width) - Math.max(region.x, b.x));
      const oy = Math.max(0, Math.min(region.y + region.height, b.y + b.height) - Math.max(region.y, b.y));
      const overlap = ox * oy;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = d;
      }
    }

    const { x: dx, y: dy, width: dw, height: dh } = best.bounds;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: dw, height: dh },
    });
    if (sources.length === 0) return null;

    const source = sources.find((s) => s.display_id === String(best.id)) ?? sources[0];
    const fullImage = source.thumbnail;
    const imgSize = fullImage.getSize();

    // Scale region from logical points to image pixels.
    const scaleX = imgSize.width / dw;
    const scaleY = imgSize.height / dh;
    const cx = Math.max(0, Math.round((region.x - dx) * scaleX));
    const cy = Math.max(0, Math.round((region.y - dy) * scaleY));
    const cw = Math.min(Math.round(region.width * scaleX), imgSize.width - cx);
    const ch = Math.min(Math.round(region.height * scaleY), imgSize.height - cy);

    if (cw <= 0 || ch <= 0) return null;

    return saveAsScreenshot(fullImage.crop({ x: cx, y: cy, width: cw, height: ch }));
  } catch (err) {
    console.error('Region capture failed:', err);
    return null;
  }
}

export async function captureFullScreen(): Promise<string | null> {
  try {
    const { width, height } = screen.getPrimaryDisplay().bounds;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
    });
    if (sources.length === 0) return null;
    return saveAsScreenshot(sources[0].thumbnail);
  } catch (err) {
    console.error('Full-screen capture failed:', err);
    return null;
  }
}
