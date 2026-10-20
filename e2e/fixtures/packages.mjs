#!/usr/bin/env node
/**
 * Builds the fixture for e2e/delivery.spec.ts with the real delivery packager
 * (tools/package.mjs): the demo facility as an intranet bundle, a browser folder and a
 * single HTML file, each plain and passphrase-encrypted, plus copies with one altered
 * file to prove the integrity check.
 *
 *   node e2e/fixtures/packages.mjs [out-dir]   (default target/e2e-packages)
 */
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(repo, process.argv[2] ?? 'target/e2e-packages');
export const PASSPHRASE = 'correct horse battery staple';

rmSync(out, { recursive: true, force: true });
const make = (kind, name, encrypted) =>
  execFileSync(
    process.execPath,
    [
      join(repo, 'tools/package.mjs'),
      '--kind',
      kind,
      '--out',
      out,
      '--name',
      name,
      ...(encrypted ? ['--passphrase', PASSPHRASE] : []),
    ],
    { cwd: repo, stdio: ['ignore', 'ignore', 'inherit'] },
  );
for (const [kind, name] of [
  ['intranet', 'intranet'],
  ['browser-folder', 'folder'],
  ['single-file', 'single'],
]) {
  make(kind, name, false);
  make(kind, `${name}-enc`, true);
}

/** Flips one byte in the middle of a file (an altered or damaged copy). */
const alter = (file) => {
  const b = readFileSync(file);
  b[b.length >> 1] ^= 0x20;
  writeFileSync(file, b);
};
// The environment itself altered: refused as it opens.
cpSync(join(out, 'intranet'), join(out, 'intranet-altered'), { recursive: true });
alter(join(out, 'intranet-altered/environment.json'));
// One panorama tile altered: refused when the Viewer asks for it.
cpSync(join(out, 'folder'), join(out, 'folder-altered'), { recursive: true });
const manifest = JSON.parse(readFileSync(join(out, 'folder/evx-manifest.json'), 'utf8'));
const tile = manifest.files.find((f) => /media\/lobby\/tiles\/f\/0\//.test(f.path)).path;
const chunks = readFileSync(join(out, 'folder/evx-manifest.js'), 'utf8');
const chunk = JSON.parse(chunks.slice(chunks.indexOf(',') + 1, chunks.lastIndexOf(')')))[tile];
const js = readFileSync(join(out, 'folder-altered', chunk), 'utf8');
// Change one base64 character of the data (still valid base64, different bytes).
const at = js.indexOf(',"') + 200;
writeFileSync(
  join(out, 'folder-altered', chunk),
  js.slice(0, at) + (js[at] === 'A' ? 'B' : 'A') + js.slice(at + 1),
);
writeFileSync(
  join(out, 'index.html'),
  '<!doctype html><title>Delivery fixture</title><p>intranet, folder, single</p>\n',
);
writeFileSync(join(out, 'altered.json'), JSON.stringify({ tile }, null, 2));
console.log(`Delivery packages in ${out}`);
