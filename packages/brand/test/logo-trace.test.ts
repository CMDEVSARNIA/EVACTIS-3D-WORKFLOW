import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { logoMarkSvg, MARK } from '../src/logo.ts';

const require = createRequire(import.meta.url);
const { Resvg } = require('@resvg/resvg-js') as typeof import('@resvg/resvg-js');

/**
 * Guards "never redraw the mark differently from the source": the traced SVG must
 * overlap the reference PNG's alpha mask almost exactly.
 */
describe('logo mark trace', () => {
  it('matches brand/evactis-logo-mark.png (IoU ≥ 0.99)', () => {
    const ref = PNG.sync.read(readFileSync(new URL('../../../brand/evactis-logo-mark.png', import.meta.url)));
    // The mark sits at (485, 209) in the 1536 × 1024 reference.
    const svg = logoMarkSvg().replace(
      /viewBox="[^"]*"/,
      `viewBox="-485 -209 ${ref.width} ${ref.height}" width="${ref.width}" height="${ref.height}"`,
    );
    const r = new Resvg(svg, { fitTo: { mode: 'original' } }).render();
    expect([r.width, r.height]).toEqual([ref.width, ref.height]);
    const mine = r.pixels;
    let inter = 0;
    let union = 0;
    for (let i = 0; i < ref.width * ref.height; i++) {
      const a = ref.data[i * 4 + 3]! > 128;
      const b = mine[i * 4 + 3]! > 128;
      if (a && b) inter++;
      if (a || b) union++;
    }
    expect(inter / union).toBeGreaterThanOrEqual(0.99);
    expect(MARK.width / MARK.height).toBeCloseTo(628.3 / 564, 5);
  });
});
