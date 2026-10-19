import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAFETY_SIGN_NAMES } from '@evactis-3dworkflow/schema';
import { drawPlan } from '../../demo-facility/src/plans.ts';
import type { PlanAssets } from '../src/index.ts';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs') as typeof import('pngjs');
const brand = resolve(dirname(fileURLToPath(import.meta.url)), '../../brand');
const read = (p: string) => new Uint8Array(readFileSync(join(brand, p)));

/** The brand's print assets and the demo facility's plan images, as Studio passes them. */
export function demoAssets(): PlanAssets {
  const plans = new Map<string, Uint8Array>();
  return {
    fonts: {
      regular: read('fonts/print/inter-latin-400-normal.woff'),
      semibold: read('fonts/print/inter-latin-600-normal.woff'),
      bold: read('fonts/print/inter-latin-700-normal.woff'),
      extrabold: read('fonts/print/inter-latin-800-normal.woff'),
    },
    signs: Object.fromEntries(
      SAFETY_SIGN_NAMES.map((n) => [n, read(`generated/print/sign-${n}.png`)]),
    ),
    logo: read('generated/print/product-lockup.png'),
    planImage: (floorId) => {
      if (!plans.has(floorId)) {
        const { width, height, rgba } = drawPlan(floorId as 'f1' | 'f2');
        const png = new PNG({ width, height });
        png.data = Buffer.from(rgba);
        plans.set(floorId, new Uint8Array(PNG.sync.write(png, { colorType: 2 })));
      }
      return plans.get(floorId);
    },
  };
}
