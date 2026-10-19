#!/usr/bin/env node
/**
 * Builds the fixture for e2e/studio-tour.spec.ts: Studio's browser test build (in-memory
 * backend, apps/studio/src/testing/memoryApi.ts) next to a project whose media was
 * imported with the real pipeline (crates/evx-media, `--example import`): ten distinct
 * test panoramas and two floor plans.
 *
 *   node e2e/fixtures/studio-project.mjs [out-dir]   (default target/e2e-studio-project)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(repo, process.argv[2] ?? 'target/e2e-studio-project');
const project = join(out, 'project');
const inbox = join(out, '.inbox');

rmSync(out, { recursive: true, force: true });
mkdirSync(project, { recursive: true });
mkdirSync(inbox, { recursive: true });

execFileSync('cargo', ['build', '--quiet', '-p', 'evx-media', '--example', 'import'], {
  cwd: repo,
  stdio: 'inherit',
});
const example = join(
  repo,
  'target/debug/examples/import' + (process.platform === 'win32' ? '.exe' : ''),
);
const run = (...args) =>
  execFileSync(example, args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

const ROOMS = [
  'Main entrance',
  'Reception',
  'Corridor west',
  'Corridor east',
  'Stair A ground',
  'Stair A level 2',
  'Office 201',
  'Server room',
  'Meeting room',
  'Roof access',
];
const fixtures = [];
ROOMS.forEach((name, i) => {
  const file = join(inbox, `${name}.jpg`);
  run('--write-room', '2048', String(i + 1), file);
  fixtures.push({
    path: `fixture:${name}.jpg`,
    purpose: 'scene',
    asset: JSON.parse(run(file, project)),
  });
});
['Level 1 plan', 'Level 2 plan'].forEach((name, i) => {
  const file = join(inbox, `${name}.png`);
  run('--write-plan', '1600', '1000', String(i + 1), file);
  fixtures.push({
    path: `fixture:${name}.png`,
    purpose: 'floor-plan',
    asset: JSON.parse(run('--plan', file, project)),
  });
});
writeFileSync(join(project, 'fixtures.json'), JSON.stringify(fixtures, null, 2));
rmSync(inbox, { recursive: true, force: true });

execFileSync(
  'pnpm',
  ['exec', 'vite', 'build', '--mode', 'e2e', '--outDir', out, '--emptyOutDir', 'false'],
  {
    cwd: join(repo, 'apps/studio'),
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: process.platform === 'win32',
  },
);
console.log(`Studio project fixture: ${fixtures.length} files in ${out}`);
