import { screenshotsTbl } from '../db';
import { saveAsPng } from './encode';
import { fullScreenSource, regionSource, type CaptureSource } from './sources';
import type { Region } from './displays';

export type { Region } from './displays';

/** Run a CaptureSource → save PNG → record in DB. Returns filepath or null. */
async function runPipeline(source: CaptureSource): Promise<string | null> {
  try {
    const image = await source.capture();
    if (!image) return null;
    const { filename, filepath, createdAt } = saveAsPng(image);
    screenshotsTbl.insert(filename, filepath, createdAt);
    return filepath;
  } catch (err) {
    console.error('Capture pipeline failed:', err);
    return null;
  }
}

export function captureRegion(region: Region): Promise<string | null> {
  return runPipeline(regionSource(region));
}

export function captureFullScreen(): Promise<string | null> {
  return runPipeline(fullScreenSource());
}
