#!/usr/bin/env node
/**
 * Builds the fixture for e2e/studio-safety.spec.ts: Studio's browser test build (in-memory
 * backend) next to a ready-made project holding the seeded demo facility (procedural
 * panoramas, plans and its safety layer), which the test opens with "Open project…".
 *
 *   node e2e/fixtures/studio-demo.mjs [out-dir]   (default target/e2e-studio-demo)
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(repo, process.argv[2] ?? 'target/e2e-studio-demo');
const project = join(out, 'project');
const demo = join(repo, 'packages/demo-facility/dist');
const shell = process.platform === 'win32';

if (!existsSync(join(demo, 'environment.json')))
  execFileSync('pnpm', ['--filter', '@evactis-3dworkflow/demo-facility', 'build'], {
    cwd: repo,
    stdio: ['ignore', 'ignore', 'inherit'],
    shell,
  });

rmSync(out, { recursive: true, force: true });
mkdirSync(project, { recursive: true });
for (const dir of ['media', 'plans'])
  cpSync(join(demo, dir), join(project, dir), { recursive: true });
const file = 'Evactis Demo Centre.evxproj';
writeFileSync(join(project, file), readFileSync(join(demo, 'environment.json')));
writeFileSync(join(project, 'project.json'), JSON.stringify({ file }));
// Files to "import" in the Content tab, imported by the real pipeline (Rust): the demo's
// alarm sound, procedures PDF and album photos.
execFileSync('cargo', ['build', '--quiet', '-p', 'evx-media', '--example', 'import'], {
  cwd: repo,
  stdio: 'inherit',
});
const example = join(repo, 'target/debug/examples/import' + (shell ? '.exe' : ''));
const fixtures = [
  ['audio', 'media/audio/alarm.wav', 'Fire alarm.wav'],
  ['document', 'docs/emergency-procedures.pdf', 'Emergency procedures.pdf'],
  ['photo', 'media/album/entrance.jpg', 'Entrance.jpg'],
  ['photo', 'media/album/assembly.jpg', 'Assembly sign.jpg'],
].map(([purpose, from, file]) => {
  const inbox = join(out, '.inbox');
  mkdirSync(inbox, { recursive: true });
  cpSync(join(demo, from), join(inbox, file));
  const asset = JSON.parse(
    execFileSync(example, [`--${purpose}`, join(inbox, file), project], { encoding: 'utf8' }),
  );
  return { path: `fixture:${file}`, purpose, asset };
});
rmSync(join(out, '.inbox'), { recursive: true, force: true });
writeFileSync(join(project, 'fixtures.json'), JSON.stringify(fixtures, null, 2));

execFileSync(
  'pnpm',
  ['exec', 'vite', 'build', '--mode', 'e2e', '--outDir', out, '--emptyOutDir', 'false'],
  { cwd: join(repo, 'apps/studio'), stdio: ['ignore', 'ignore', 'inherit'], shell },
);
console.log(`Studio demo fixture in ${out}`);
