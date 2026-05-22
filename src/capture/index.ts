import { screenshotsTbl } from '../db';
import { saveAsPng } from './encode';
import { fullScreenSource, regionSource, type CaptureSource } from './sources';
import type { Region } from './displays';

export type { Region } from './displays';
export { getActiveBrowserURL } from './active-url';

/** Run a CaptureSource → save PNG → record in DB. Returns filepath or null. */
async function runPipeline(source: CaptureSource, url: string | null): Promise<string | null> {
  try {
    const image = await source.capture();
    if (!image) return null;
    const { filename, filepath, createdAt } = saveAsPng(image);
    screenshotsTbl.insert(filename, filepath, createdAt, url);
    return filepath;
  } catch (err) {
    console.error('Capture pipeline failed:', err);
    return null;
  }
}

export function captureRegion(region: Region, url: string | null = null): Promise<string | null> {
  return runPipeline(regionSource(region), url);
}

export function captureFullScreen(url: string | null = null): Promise<string | null> {
  return runPipeline(fullScreenSource(), url);
}
