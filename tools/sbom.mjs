#!/usr/bin/env node
/**
 * Software bill of materials (CycloneDX 1.5 JSON) for a release: every npm package
 * shipped in the front ends and the Site Server, every Rust crate compiled into the
 * Windows programs, and the third-party programs the products bundle. Made offline from
 * the lockfiles (pnpm-lock.yaml, Cargo.lock) with their checksums, and reproducible:
 * the timestamp is the commit's and the serial number is derived from the content.
 *
 *   node tools/sbom.mjs [out-file]     (default target/sbom/evactis-3dworkflow.cdx.json)
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(repo, 'target/sbom/evactis-3dworkflow.cdx.json'));
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const version = JSON.parse(readFileSync(join(repo, 'apps/studio/package.json'), 'utf8')).version;

// ------------------------------------------------------------------ npm (production)
// Checksums from pnpm-lock.yaml: "name@version:" followed by resolution: {integrity: …}.
const lock = readFileSync(join(repo, 'pnpm-lock.yaml'), 'utf8');
const integrity = new Map();
for (const m of lock.matchAll(
  /^ {2}'?(@?[^@\s']+)@([^:'\s(]+)'?:\n {4}resolution: \{integrity: ([^,}]+)/gm,
))
  integrity.set(`${m[1]}@${m[2]}`, m[3]);
const npm = [];
for (const [license, pkgs] of Object.entries(
  JSON.parse(run('pnpm', ['licenses', 'list', '--prod', '--json'])),
))
  for (const p of pkgs)
    for (const v of p.versions) {
      const sri = integrity.get(`${p.name}@${v}`);
      const [alg, b64] = sri ? sri.split('-') : [];
      npm.push({
        type: 'library',
        'bom-ref': `pkg:npm/${p.name.replace('@', '%40')}@${v}`,
        name: p.name,
        version: v,
        purl: `pkg:npm/${p.name.replace('@', '%40')}@${v}`,
        licenses: [{ expression: license }],
        ...(alg === 'sha512'
          ? { hashes: [{ alg: 'SHA-512', content: Buffer.from(b64, 'base64').toString('hex') }] }
          : {}),
        properties: [{ name: 'evactis:ecosystem', value: 'npm (front ends, Site Server)' }],
      });
    }

// ------------------------------------------------------------------ Rust (Windows build)
const meta = JSON.parse(
  run('cargo', [
    'metadata',
    '--format-version',
    '1',
    '--locked',
    '--offline',
    '--filter-platform',
    'x86_64-pc-windows-msvc',
  ]),
);
const cargoLock = readFileSync(join(repo, 'Cargo.lock'), 'utf8');
const checksum = new Map();
for (const m of cargoLock.matchAll(
  /\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"\nsource = "[^"]+"\nchecksum = "([0-9a-f]+)"/g,
))
  checksum.set(`${m[1]}@${m[2]}`, m[3]);
const members = new Set(meta.workspace_members);
const reachable = new Set(meta.resolve.nodes.map((n) => n.id));
const rust = meta.packages
  .filter((p) => !members.has(p.id) && reachable.has(p.id))
  .map((p) => {
    const sum = checksum.get(`${p.name}@${p.version}`);
    return {
      type: 'library',
      'bom-ref': `pkg:cargo/${p.name}@${p.version}`,
      name: p.name,
      version: p.version,
      purl: `pkg:cargo/${p.name}@${p.version}`,
      licenses: [{ expression: (p.license ?? 'NOASSERTION').replaceAll('/', ' OR ') }],
      ...(sum ? { hashes: [{ alg: 'SHA-256', content: sum }] } : {}),
      properties: [{ name: 'evactis:ecosystem', value: 'cargo (Windows programs)' }],
    };
  });

// ------------------------------------------------------------------ bundled programs
// Fetched by the Windows build scripts; exact files and hashes are recorded beside them
// (ffmpeg\SOURCE.txt) and in the signed release kit.
const bundled = [
  [
    'FFmpeg (LGPL build)',
    'LGPL-2.1-or-later',
    'Studio: 360° video import (ffmpeg.exe, ffprobe.exe)',
  ],
  ['NSIS', 'Zlib', 'Studio: per-facility installers (makensis, stubs, plugins)'],
  [
    'Microsoft Edge WebView2 Runtime installer',
    'LicenseRef-Microsoft-WebView2',
    'Studio and Viewer installers',
  ],
  ['Node.js', 'MIT', 'Site Server standalone program and Docker image (runtime)'],
].map(([name, license, use]) => ({
  type: 'application',
  'bom-ref': `bundled:${name}`,
  name,
  licenses: [
    license.startsWith('LicenseRef') ? { license: { name: license } } : { expression: license },
  ],
  properties: [{ name: 'evactis:use', value: use }],
}));

const components = [...npm, ...rust, ...bundled].sort((a, b) =>
  a['bom-ref'].localeCompare(b['bom-ref']),
);
const timestamp = run('git', ['log', '-1', '--format=%cI']);
const body = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  version: 1,
  metadata: {
    timestamp,
    component: {
      type: 'application',
      'bom-ref': 'evactis-3dworkflow',
      name: 'EVACTIS 3DWORKFLOW',
      version,
      supplier: { name: 'Evactis' },
      description:
        'Studio, Viewer and Site Server. Runs offline; no telemetry or network services.',
    },
    properties: [{ name: 'evactis:commit', value: run('git', ['rev-parse', 'HEAD']) }],
  },
  components,
};
// A content-derived serial number keeps the file reproducible.
const h = createHash('sha256').update(JSON.stringify(body)).digest('hex');
const serialNumber = `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ ...body, serialNumber }, null, 2)}\n`);
const hashed = components.filter((c) => c.hashes).length;
console.log(
  `SBOM: ${npm.length} npm + ${rust.length} Rust + ${bundled.length} bundled programs (${hashed} with checksums) -> ${out}`,
);
