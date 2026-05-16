import { desktopCapturer, screen } from 'electron';
import { pickBestDisplay, type Region } from './displays';

/**
 * A CaptureSource produces a raw NativeImage. It does not save to disk or
 * touch the DB — those steps live in encode.ts and index.ts respectively.
 */
export interface CaptureSource {
  capture(): Promise<Electron.NativeImage | null>;
}

export function regionSource(region: Region): CaptureSource {
  return {
    async capture() {
      const best = pickBestDisplay(region);
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
      return fullImage.crop({ x: cx, y: cy, width: cw, height: ch });
    },
  };
}

export function fullScreenSource(): CaptureSource {
  return {
    async capture() {
      const { width, height } = screen.getPrimaryDisplay().bounds;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width, height },
      });
      if (sources.length === 0) return null;
      return sources[0].thumbnail;
    },
  };
}
