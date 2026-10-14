#!/usr/bin/env node
/**
 * Offline guardrail (static half): fails if any build output contains an http(s)/ws(s)
 * URL that is not on tools/guardrail/allowlist.json. The runtime half is the
 * Playwright network-blocked mode (e2e/offline.ts) and the Windows smoke test.
 *
 *   node tools/guardrail/scan-urls.mjs [dir ...]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const allow = JSON.parse(
  readFileSync(join(repo, 'tools/guardrail/allowlist.json'), 'utf8'),
).entries.map((e) => new RegExp(e.pattern));
const DEFAULT_DIRS = [
  'apps/studio/dist',
  'apps/viewer-desktop/dist',
  'packages/brand/sheet-dist',
  'packages/brand/dist',
  'packages/schema/dist',
  'packages/desktop-bridge/dist',
];
const SCANNED = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.json',
  '.svg',
  '.map',
  '.webmanifest',
  '.xml',
]);
const URL_RE = /\b(?:https?|wss?|ftp):\/\/[^\s"'`<>)\\]+/g;

const dirs = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_DIRS).map((d) =>
  resolve(repo, d),
);
const missing = dirs.filter((d) => !existsSync(d));
if (missing.length) {
  console.error(
    `Build output missing (run the build first):\n  ${missing.map((d) => relative(repo, d)).join('\n  ')}`,
  );
  process.exit(1);
}

const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const violations = [];
let files = 0;
for (const dir of dirs)
  for (const file of walk(dir)) {
    if (!SCANNED.has(extname(file))) continue;
    files++;
    for (const m of readFileSync(file, 'utf8').matchAll(URL_RE)) {
      const url = m[0].replace(/[.,;]+$/, '');
      if (!allow.some((re) => re.test(url))) violations.push(`${relative(repo, file)}: ${url}`);
    }
  }

if (violations.length) {
  console.error(`Offline guardrail: ${violations.length} non-allowlisted URL(s) in build output:`);
  for (const v of [...new Set(violations)]) console.error(`  ${v}`);
  process.exit(1);
}
console.log(`Offline guardrail: ${files} files scanned, no external URLs.`);
