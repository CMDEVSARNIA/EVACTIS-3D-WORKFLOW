#!/usr/bin/env node
/**
 * Builds an EVACTIS 3DWORKFLOW delivery package from the command line, with the same
 * packager Studio uses (packages/packaging): for CI acceptance runs and IT staff.
 * Everything is local; nothing is downloaded.
 *
 *   node tools/package.mjs --kind <kind> [options]
 *     --kind        installer | evx | portable | intranet | browser-folder | single-file | scorm
 *     --env         folder holding environment.json and its files (default: the demo facility)
 *     --out         output folder (default target/packages)
 *     --name        package name (default: from the environment title)
 *     --passphrase  encrypt the environment (or set EVX_PASSPHRASE)
 *     --viewer      the Viewer executable (portable, installer)
 *     --makensis    the NSIS compiler (installer; default `makensis` on PATH)
 *     --scorm       1.2 | 2004 (default 2004)
 *     --kiosk       kiosk deployment
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { localize, parseEnvironment } from '../packages/schema/dist/index.js';
import { buildDelivery, safeName } from '../packages/packaging/src/index.ts';
import { quickStartPdf } from '../packages/print/src/index.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: a } = parseArgs({
  options: {
    kind: { type: 'string' },
    env: { type: 'string', default: join(repo, 'packages/demo-facility/dist') },
    out: { type: 'string', default: join(repo, 'target/packages') },
    name: { type: 'string' },
    passphrase: { type: 'string', default: process.env.EVX_PASSPHRASE },
    viewer: { type: 'string' },
    makensis: { type: 'string', default: 'makensis' },
    scorm: { type: 'string', default: '2004' },
    kiosk: { type: 'boolean', default: false },
    'created-at': { type: 'string' },
  },
});
const kinds = [
  'installer',
  'evx',
  'portable',
  'intranet',
  'browser-folder',
  'single-file',
  'scorm',
];
if (!kinds.includes(a.kind ?? '')) {
  console.error(`--kind must be one of: ${kinds.join(', ')}`);
  process.exit(2);
}

const envDir = resolve(a.env);
const parsed = parseEnvironment(JSON.parse(readFileSync(join(envDir, 'environment.json'), 'utf8')));
if (!parsed.success) {
  console.error(`The environment is not valid: ${parsed.error.message}`);
  process.exit(2);
}
const env = parsed.environment;
const lang = env.settings.defaultLanguage;
const name = a.name ?? safeName(localize(env.title, lang));
const out = resolve(a.out);
const createdAt = a['created-at'] ?? new Date().toISOString();
const studio = JSON.parse(readFileSync(join(repo, 'apps/studio/package.json'), 'utf8'));
const producer = `EVACTIS 3DWORKFLOW ${studio.version} (command-line packager)`;
const bytes = (p) => new Uint8Array(readFileSync(p));
const dirFiles = (dir) =>
  JSON.parse(readFileSync(join(dir, 'files.json'), 'utf8')).map((path) => ({
    path,
    data: bytes(join(dir, path)),
  }));

const brand = join(repo, 'packages/brand');
const quickStart = await quickStartPdf(
  {
    kind: a.kind,
    facility: { en: localize(env.facility.name, 'en'), fr: localize(env.facility.name, 'fr') },
    createdAt,
    producer,
    encrypted: a.passphrase !== undefined,
  },
  {
    fonts: {
      regular: bytes(join(brand, 'fonts/print/inter-latin-400-normal.woff')),
      semibold: bytes(join(brand, 'fonts/print/inter-latin-600-normal.woff')),
      bold: bytes(join(brand, 'fonts/print/inter-latin-700-normal.woff')),
      extrabold: bytes(join(brand, 'fonts/print/inter-latin-800-normal.woff')),
    },
    logo: bytes(join(brand, 'generated/print/product-lockup.png')),
  },
);

const playerDir = join(repo, 'packages/viewer/player-dist');
const classicDir = join(repo, 'packages/viewer/player-classic-dist');
const needsPlayer = a.kind === 'intranet' || a.kind === 'scorm';
const needsClassic = a.kind === 'browser-folder' || a.kind === 'single-file';
for (const [need, dir] of [
  [needsPlayer, join(playerDir, 'files.json')],
  [needsClassic, join(classicDir, 'player.js')],
])
  if (need && !existsSync(dir)) {
    console.error(
      `Build the Viewer first (pnpm --filter @evactis-3dworkflow/viewer build): ${dir}`,
    );
    process.exit(2);
  }

const started = Date.now();
const result = await buildDelivery(
  {
    env,
    kind: a.kind,
    producer,
    name,
    createdAt,
    readAsset: async (p) => bytes(join(envDir, ...p.split('/'))),
    quickStart,
    passphrase: a.passphrase,
    kiosk: a.kiosk,
    player: needsPlayer ? dirFiles(playerDir) : undefined,
    classic: needsClassic
      ? { js: bytes(join(classicDir, 'player.js')), css: bytes(join(classicDir, 'player.css')) }
      : undefined,
    viewerExe: a.viewer ? bytes(resolve(a.viewer)) : undefined,
    installerIcon: bytes(join(repo, 'apps/viewer-desktop/src-tauri/icons/icon.ico')),
    scorm: a.kind === 'scorm' ? { version: a.scorm } : undefined,
  },
  {
    async write(path, data, append) {
      const file = join(out, ...path.split('/'));
      mkdirSync(dirname(file), { recursive: true });
      if (append) appendFileSync(file, data);
      else writeFileSync(file, data);
    },
  },
);

const outputs = [...new Set(result.outputs.map((p) => p.split('/')[0]))];
if (a.kind === 'installer') {
  // A UTF-8 locale: the Linux makensis crashes on accented file names under POSIX.
  execFileSync(a.makensis, ['-V2', 'installer.nsi'], {
    cwd: join(out, name),
    stdio: 'inherit',
    env: { ...process.env, LC_ALL: 'C.UTF-8' },
  });
  outputs.push(`${name} Setup.exe`);
}
console.log(
  JSON.stringify(
    {
      kind: a.kind,
      encrypted: result.manifest.encryption !== null,
      createdAt,
      files: result.manifest.files.length,
      megabytes: Math.round(result.bytes / 1e5) / 10,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      outputs: outputs.map((o) => join(out, o)),
    },
    null,
    2,
  ),
);
