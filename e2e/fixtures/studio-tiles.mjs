#!/usr/bin/env node
/**
 * Builds the fixture for e2e/studio-tiles.spec.ts: a compass panorama imported with the
 * real Studio pipeline (crates/evx-media, `--example import`), next to the built Viewer
 * demo page, with an environment whose only scene uses those tiles.
 *
 *   node e2e/fixtures/studio-tiles.mjs [out-dir]   (default target/e2e-studio-tiles)
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(repo, process.argv[2] ?? 'target/e2e-studio-tiles');
const demo = join(repo, 'packages/viewer/demo-dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const json = execFileSync(
  'cargo',
  ['run', '--quiet', '-p', 'evx-media', '--example', 'import', '--', '--compass', '4096', out],
  { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);
const asset = JSON.parse(json);

cpSync(join(demo, 'index.html'), join(out, 'index.html'));
cpSync(join(demo, 'assets'), join(out, 'assets'), { recursive: true });

// The demo facility's environment, reduced to one scene that uses the Studio output.
const env = JSON.parse(readFileSync(join(demo, 'environment.json'), 'utf8'));
env.id = 'studio-tiles';
env.buildings = [];
env.hotspots = [];
env.variables = [];
env.initialSceneId = 'compass';
env.scenes = [
  {
    id: 'compass',
    name: { en: 'Compass', fr: 'Boussole' },
    media: {
      type: 'equirect',
      source: asset.source,
      preview: asset.preview,
      tiles: asset.tiles,
      hdr: false,
    },
    initialView: { yaw: 0, pitch: 0, fov: 60 },
    northOffsetDeg: 0,
    audienceIds: [],
  },
];
writeFileSync(join(out, 'environment.json'), JSON.stringify(env, null, 2));
console.log(
  `Studio tiles fixture: ${asset.id}, levels ${asset.tiles.levels.map((l) => l.size).join('/')}`,
);
