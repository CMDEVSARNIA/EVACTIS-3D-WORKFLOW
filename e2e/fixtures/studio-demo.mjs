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
import { PNG } from 'pngjs';

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
for (const dir of ['media', 'plans', 'docs'])
  cpSync(join(demo, dir), join(project, dir), { recursive: true });
const file = 'Evactis Demo Centre.evxproj';
writeFileSync(join(project, file), readFileSync(join(demo, 'environment.json')));
writeFileSync(join(project, 'project.json'), JSON.stringify({ file }));
// Files to "import" in the Content and Skin tabs, imported by the real pipeline (Rust):
// the demo's alarm sound, procedures PDF and album photos, and a made-up client logo
// (PNG with a transparent background) that only the logo picker offers.
execFileSync('cargo', ['build', '--quiet', '-p', 'evx-media', '--example', 'import'], {
  cwd: repo,
  stdio: 'inherit',
});
const example = join(repo, 'target/debug/examples/import' + (shell ? '.exe' : ''));
const logo = join(out, 'client-logo.png');
{
  // A generic client mark: a teal disc and three bars, on transparency.
  const png = new PNG({ width: 800, height: 280 });
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const disc = (x - 140) ** 2 + (y - 140) ** 2 < 110 ** 2;
      const bar = x > 290 && x < 760 && [60, 125, 190].some((t) => y > t && y < t + 36);
      const i = (y * png.width + x) * 4;
      png.data.set(disc ? [0, 128, 128, 255] : bar ? [40, 40, 48, 255] : [0, 0, 0, 0], i);
    }
  mkdirSync(out, { recursive: true });
  writeFileSync(logo, PNG.sync.write(png));
}
const fixtures = [
  ['audio', 'media/audio/alarm.wav', 'Fire alarm.wav'],
  ['document', 'docs/emergency-procedures.pdf', 'Emergency procedures.pdf'],
  ['photo', 'media/album/entrance.jpg', 'Entrance.jpg'],
  ['photo', 'media/album/assembly.jpg', 'Assembly sign.jpg'],
  ['photo', logo, 'Acme logo.png', 'Choose the client logo'],
].map(([purpose, from, file, picker]) => {
  const inbox = join(out, '.inbox');
  mkdirSync(inbox, { recursive: true });
  cpSync(resolve(demo, from), join(inbox, file));
  const asset = JSON.parse(
    execFileSync(example, [`--${purpose}`, join(inbox, file), project], { encoding: 'utf8' }),
  );
  return { path: `fixture:${file}`, purpose, asset, ...(picker && { picker }) };
});
rmSync(logo);
rmSync(join(out, '.inbox'), { recursive: true, force: true });
writeFileSync(join(project, 'fixtures.json'), JSON.stringify(fixtures, null, 2));

execFileSync(
  'pnpm',
  ['exec', 'vite', 'build', '--mode', 'e2e', '--outDir', out, '--emptyOutDir', 'false'],
  { cwd: join(repo, 'apps/studio'), stdio: ['ignore', 'ignore', 'inherit'], shell },
);
console.log(`Studio demo fixture in ${out}`);
