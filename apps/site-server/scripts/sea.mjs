#!/usr/bin/env node
/**
 * Builds the standalone Site Server program for this platform: the Node.js runtime
 * running this script, with the bundled server (dist/server.cjs) and its pages
 * (dist/web) injected as a Node single executable application. Nothing is downloaded:
 * the runtime is the local `node`, so an offline build machine makes the same file.
 *
 *   node scripts/sea.mjs [--out <folder>] [--check]
 *
 * Writes <out>/evactis-3dworkflow-site-server[.exe] (default dist/standalone) with
 * NOTICES.txt (bundled packages) and NODE-LICENSE.txt (the runtime's licence).
 * --check starts the program on a loopback port with a fresh data folder and asks it
 * for /health and its start page. On Windows the program is signed afterwards with
 * scripts/windows/sign.ps1, like the apps.
 */
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inject } from 'postject';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: { out: { type: 'string' }, check: { type: 'boolean' } },
});
const win = process.platform === 'win32';
const out = values.out ?? join(root, 'dist/standalone');
const name = `evactis-3dworkflow-site-server${win ? '.exe' : ''}`;
const exe = join(out, name);
const bundle = join(root, 'dist/server.cjs');
const web = join(root, 'dist/web');
if (!existsSync(bundle) || !existsSync(join(web, 'index.html')))
  throw new Error(
    'Build the Site Server first (pnpm --filter @evactis-3dworkflow/site-server build).',
  );

// Every page file becomes an asset named web/<path>, which webFiles() in src/main.ts reads.
const assets = {};
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry);
    if (statSync(file).isDirectory()) walk(file);
    else assets[`web/${relative(web, file).split(sep).join('/')}`] = file;
  }
};
walk(web);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'evx-sea-'));
try {
  const blob = join(work, 'sea-prep.blob');
  writeFileSync(
    join(work, 'sea-config.json'),
    JSON.stringify({
      main: bundle,
      output: blob,
      disableExperimentalSEAWarning: true,
      // Code caches and snapshots are tied to the exact runtime build; plain source is
      // portable and starts quickly enough for a server.
      useSnapshot: false,
      useCodeCache: false,
      assets,
    }),
  );
  execFileSync(process.execPath, ['--experimental-sea-config', join(work, 'sea-config.json')], {
    stdio: 'inherit',
  });
  copyFileSync(process.execPath, exe);
  // On Windows the copied runtime carries Node's own signature, which injecting would
  // break: remove it first (as Node's documentation advises); scripts/windows/sign.ps1
  // signs the finished program with the Evactis key.
  if (win) {
    const kits = join(
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'Windows Kits',
      '10',
      'bin',
    );
    const signtool = existsSync(kits)
      ? readdirSync(kits)
          .sort()
          .reverse()
          .map((v) => join(kits, v, 'x64', 'signtool.exe'))
          .find((f) => existsSync(f))
      : undefined;
    if (!signtool) throw new Error('signtool.exe not found (install the Windows 10/11 SDK)');
    execFileSync(signtool, ['remove', '/s', exe], { stdio: 'inherit' });
  }
  await inject(exe, 'NODE_SEA_BLOB', readFileSync(blob), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}

copyFileSync(join(root, 'dist/NOTICES.txt'), join(out, 'NOTICES.txt'));
const nodeLicense = [
  join(dirname(process.execPath), 'LICENSE'),
  join(dirname(process.execPath), '..', 'LICENSE'),
].find(existsSync);
if (!nodeLicense)
  throw new Error(
    `No LICENSE beside ${process.execPath}: the runtime's licence must ship with it.`,
  );
copyFileSync(nodeLicense, join(out, 'NODE-LICENSE.txt'));
console.log(
  `${relative(process.cwd(), exe)} (${(statSync(exe).size / 1048576).toFixed(0)} MB, Node ${process.version})`,
);

if (values.check) await check();

/** Starts the program with a fresh data folder on loopback and fetches two pages. */
async function check() {
  const data = mkdtempSync(join(tmpdir(), 'evx-sea-data-'));
  const port = 4290;
  writeFileSync(
    join(data, 'config.json'),
    JSON.stringify({
      siteName: 'Standalone check',
      host: '127.0.0.1',
      port,
      turn: { port: port + 1 },
    }),
  );
  const server = spawn(exe, ['--data', data], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (b) => (log += b));
  server.stderr.on('data', (b) => (log += b));
  const get = (path) =>
    new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, rejectUnauthorized: false }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }),
        );
      });
      req.on('error', reject);
      req.end();
    });
  try {
    let health = null;
    for (let i = 0; i < 60 && !health; i++) {
      await new Promise((r) => setTimeout(r, 500));
      health = await get('/health').catch(() => null);
    }
    if (health?.status !== 200) throw new Error(`no /health answer:\n${log}`);
    const page = await get('/');
    if (page.status !== 200 || !page.text.includes('<script'))
      throw new Error(`start page: ${page.status}`);
    if (!/setup code [A-Z0-9-]{14}/.test(log)) throw new Error(`no setup code in the log:\n${log}`);
    if (/ExperimentalWarning|Error/.test(log)) throw new Error(`unexpected output:\n${log}`);
    console.log('check: /health and the start page answered; setup code printed');
  } finally {
    // Wait for it to stop first: Windows keeps the database locked until the process
    // has exited.
    if (server.exitCode === null && server.signalCode === null) {
      const stopped = new Promise((r) => server.once('exit', r));
      server.kill();
      await stopped;
    }
    rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
