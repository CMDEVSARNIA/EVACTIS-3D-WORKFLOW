#!/usr/bin/env node
/**
 * Performance budgets for what people download or load (gzipped). The Viewer core,
 * everything needed to show a panorama with Three.js, must stay under 300 KB; the other
 * budgets sit about 10–20 % above today's sizes so growth is a decision, not a drift.
 * Lazy chunks load only when a feature is used (PDF reader, certificate, GLB, VR).
 * A pattern's `*` matches a build hash; the largest matching file is measured.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BUDGETS = [
  // Viewer core and the players delivered to clients (first load).
  ['packages/viewer/dist/evactis-viewer.js', 300],
  ['packages/viewer/player-dist/player.js', 260],
  // One file for packages opened from disk (no module loading there; ADR 0018).
  ['packages/viewer/player-classic-dist/player.js', 1550],
  // Lazy features.
  ['packages/viewer/player-dist/pdf.js', 110],
  ['packages/viewer/player-dist/pdf.worker.js', 440],
  ['packages/viewer/player-dist/certificate.js', 720],
  ['packages/viewer/player-dist/GLTFLoader.js', 18],
  ['packages/viewer/player-dist/vr.js', 7],
  ['packages/viewer/player-dist/splat.js', 6],
  // The apps' own code.
  ['apps/studio/dist/assets/index-*.js', 220],
  ['apps/viewer-desktop/dist/assets/index-*.js', 95],
  ['apps/site-server/dist/web/assets/view-*.js', 260],
];

const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length / 1024;
let failed = false;
for (const [pattern, maxKb] of BUDGETS) {
  const dir = join(repo, dirname(pattern));
  const re = new RegExp(
    `^${pattern.split('/').at(-1).replace(/[.]/g, '\\.').replace(/\*/g, '[^/]+')}$`,
  );
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => re.test(f)) : [];
  if (!files.length) {
    console.log(`FAIL ${pattern}: not built`);
    failed = true;
    continue;
  }
  const kb = Math.max(...files.map((f) => gz(join(dir, f))));
  const ok = kb <= maxKb;
  failed ||= !ok;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${pattern}: ${kb.toFixed(1)} KB gzipped (budget ${maxKb} KB)`,
  );
}
if (failed) process.exit(1);
