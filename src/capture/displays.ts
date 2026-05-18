import { screen } from 'electron';

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pick the display with the most overlap with a given region. */
export function pickBestDisplay(region: Region): Electron.Display {
  const displays = screen.getAllDisplays();
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
  return best;
}
