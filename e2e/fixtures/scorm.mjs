#!/usr/bin/env node
/**
 * Builds the fixture for e2e/scorm.spec.ts: SCORM 1.2 and 2004 packages of the demo
 * facility (the real packager and player), unpacked next to a strict local LMS harness
 * (e2e/scorm-harness), as an LMS would serve them.
 *
 *   node e2e/fixtures/scorm.mjs [out-dir]   (default target/e2e-scorm)
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzip } from '../../packages/packaging/src/index.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(repo, process.argv[2] ?? 'target/e2e-scorm');
const demo = join(repo, 'packages/demo-facility/dist');
const playerDir = join(repo, 'packages/viewer/player-dist');
const shell = process.platform === 'win32';

if (!existsSync(join(demo, 'environment.json')))
  execFileSync('pnpm', ['--filter', '@evactis-3dworkflow/demo-facility', 'build'], {
    cwd: repo,
    stdio: 'inherit',
    shell,
  });
if (!existsSync(join(playerDir, 'files.json')))
  execFileSync('pnpm', ['exec', 'vite', 'build', '--config', 'player/vite.config.ts'], {
    cwd: join(repo, 'packages/viewer'),
    stdio: ['ignore', 'ignore', 'inherit'],
    shell,
  });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const [name, version] of [
  ['scorm12', '1.2'],
  ['scorm2004', '2004'],
]) {
  // The real delivery packager (as Studio and IT staff use it), then unpacked as an LMS does.
  execFileSync(
    process.execPath,
    [
      join(repo, 'tools/package.mjs'),
      '--kind',
      'scorm',
      '--scorm',
      version,
      '--out',
      out,
      '--name',
      name,
    ],
    { cwd: repo, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const zip = readFileSync(join(out, `${name}.zip`));
  for (const e of unzip(zip)) {
    mkdirSync(dirname(join(out, name, e.name)), { recursive: true });
    writeFileSync(join(out, name, e.name), e.data);
  }
}
cpSync(join(repo, 'e2e/scorm-harness'), out, { recursive: true });
console.log(`SCORM fixture in ${out}`);
