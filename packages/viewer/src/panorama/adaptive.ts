import { loadImage } from '../assets.ts';
import { DEG, direction } from '../math.ts';

/**
 * Adaptive exposure for HDR panoramas, like an eye adjusting: looking at a bright window
 * darkens the view, looking into a dim corner brightens it.
 *
 * Tiles are tone-mapped once at import (for the panorama's average brightness); the
 * importer also writes a small luminance map: an equirectangular greyscale PNG whose
 * value v encodes log2(luminance) relative to that average as (v / 255) × 16 − 8 stops.
 * The Viewer averages the map over the field of view and shifts the exposure against it.
 */
export class LuminanceMap {
  private constructor(
    readonly width: number,
    readonly height: number,
    private stops: Float32Array,
    private dirs: Float32Array,
    private weights: Float32Array,
  ) {}

  static async load(url: string, signal?: AbortSignal): Promise<LuminanceMap> {
    const img = await loadImage(url, signal);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    const stops = new Float32Array(w * h);
    const dirs = new Float32Array(w * h * 3);
    const weights = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        stops[i] = (px[i * 4]! / 255) * 16 - 8;
        const yaw = -180 + ((x + 0.5) / w) * 360;
        const pitch = 90 - ((y + 0.5) / h) * 180;
        const d = direction(yaw, pitch);
        dirs.set(d, i * 3);
        // Equirectangular pixels shrink towards the poles.
        weights[i] = Math.cos(pitch * DEG);
      }
    return new LuminanceMap(w, h, stops, dirs, weights);
  }

  /** Mean stops (relative to the panorama average) inside a cone around the view. */
  viewStops(yaw: number, pitch: number, fovDeg: number): number {
    const [vx, vy, vz] = direction(yaw, pitch);
    const cosLimit = Math.cos(Math.min(80, fovDeg * 0.6) * DEG);
    let sum = 0;
    let total = 0;
    for (let i = 0; i < this.stops.length; i++) {
      const dot = this.dirs[i * 3]! * vx + this.dirs[i * 3 + 1]! * vy + this.dirs[i * 3 + 2]! * vz;
      if (dot < cosLimit) continue;
      // Centre-weighted, like a camera's metering.
      const w = this.weights[i]! * (dot - cosLimit);
      sum += this.stops[i]! * w;
      total += w;
    }
    return total ? sum / total : 0;
  }
}

/** Exposure shift (stops) for a view that meters at `viewStops`. */
export function adaptation(viewStops: number): number {
  return Math.max(-2, Math.min(1.5, -0.75 * viewStops));
}
