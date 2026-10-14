#!/usr/bin/env node
/**
 * Performance budget: the Viewer core (everything needed to show a panorama, Three.js
 * included) must stay under 300 KB gzipped. Video, splat, VR and training modules will
 * be lazy-loaded chunks and are not counted here.
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BUDGETS = [{ file: 'packages/viewer/dist/evactis-viewer.js', maxKb: 300 }];
let failed = false;
for (const { file, maxKb } of BUDGETS) {
  const kb = gzipSync(readFileSync(join(repo, file)), { level: 9 }).length / 1024;
  const ok = kb <= maxKb;
  failed ||= !ok;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${file}: ${kb.toFixed(1)} KB gzipped (budget ${maxKb} KB)`);
}
if (failed) process.exit(1);
