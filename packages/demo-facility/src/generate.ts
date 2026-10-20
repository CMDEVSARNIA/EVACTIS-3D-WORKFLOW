/**
 * Renders the demo facility to dist/: environment.json, equirectangular previews and
 * multi-resolution cube tiles in the layout the Viewer reads (see viewer cube.ts).
 * Deterministic; run by `pnpm build`.
 */
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACES, facePixelDirection, tilePath } from '../../viewer/src/panorama/cube.ts';
import { direction } from '../../viewer/src/math.ts';
import { demoEnvironment } from './environment.ts';
import { drawPlan } from './plans.ts';
import { procedures } from './procedures.ts';
import { alarmWav, hdrShade, logAverage, luminanceMap, photo } from './rich.ts';
import { dockModel, mechanicalSplats } from './models.ts';
import { odsOrigin, SCENES, shade, type SceneSpec } from './scenes.ts';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs') as typeof import('pngjs');
const jpeg = require('jpeg-js') as {
  encode(img: { data: Uint8Array; width: number; height: number }, q: number): { data: Buffer };
};

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const QUALITY = 85;

function write(path: string, data: Buffer | string) {
  const abs = join(out, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, data);
}

function encode(
  w: number,
  h: number,
  px: (x: number, y: number) => [number, number, number],
): Buffer {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = px(x, y);
      const i = (y * w + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  return jpeg.encode({ data, width: w, height: h }, QUALITY).data;
}

type Shader = (d: [number, number, number]) => [number, number, number];

/** 2×2 supersampled shading for smoother edges. */
function sample(shader: Shader, dirAt: (sx: number, sy: number) => [number, number, number]) {
  return (x: number, y: number): [number, number, number] => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const [ox, oy] of [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ] as const) {
      const d = dirAt(x + ox, y + oy);
      const n = Math.hypot(...d);
      const c = shader([d[0] / n, d[1] / n, d[2] / n]);
      r += c[0];
      g += c[1];
      b += c[2];
    }
    return [Math.round(r / 4), Math.round(g / 4), Math.round(b / 4)];
  };
}

const env = demoEnvironment();
const started = Date.now();
for (const scene of env.scenes) {
  const m = scene.media;
  if (m.type !== 'equirect') continue;
  const spec: SceneSpec | undefined = SCENES.find((s) => s.id === scene.id);
  if (!spec) continue;
  let shader: Shader = (d) => shade(spec, d);
  // HDR capture: tone-mapped tiles plus the luminance map for adaptive exposure.
  if (m.hdr && m.luminance) {
    const avg = logAverage(scene.id);
    shader = hdrShade(scene.id, avg);
    const png = new PNG({ width: 128, height: 64, colorType: 0 });
    const grey = luminanceMap(scene.id, avg);
    for (let i = 0; i < grey.length; i++) png.data.set([grey[i]!, grey[i]!, grey[i]!, 255], i * 4);
    write(m.luminance, PNG.sync.write(png, { colorType: 0 }));
  }
  const equirect = (w: number, h: number) =>
    encode(
      w,
      h,
      sample(shader, (sx, sy) => direction(-180 + (360 * sx) / w, 90 - (180 * sy) / h)),
    );
  if (m.tiles) {
    write(m.preview!, equirect(1024, 512));
    const t = m.tiles;
    t.levels.forEach((level, li) => {
      const n = Math.ceil(level.size / t.tileSize);
      for (const face of FACES)
        for (let row = 0; row < n; row++)
          for (let col = 0; col < n; col++) {
            const w = Math.min(t.tileSize, level.size - col * t.tileSize);
            const h = Math.min(t.tileSize, level.size - row * t.tileSize);
            const img = encode(
              w,
              h,
              sample(shader, (sx, sy) =>
                facePixelDirection(
                  face,
                  level.size,
                  col * t.tileSize + sx - 0.5,
                  row * t.tileSize + sy - 0.5,
                ),
              ),
            );
            write(tilePath(t.basePath, face, li, row, col, t.format), img);
          }
    });
  } else {
    write(m.source, equirect(2048, 1024));
  }
  console.log(`  ${scene.id}`);
}
for (const f of env.buildings.flatMap((b) => b.floors)) {
  if (!f.plan) continue;
  const { width, height, rgba } = drawPlan(f.id as 'f1' | 'f2');
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  write(f.plan.image, PNG.sync.write(png, { colorType: 2 }));
  console.log(`  plan ${f.id}`);
}
// Phase 6 media: sound, album photos, procedures PDF, and the committed WebM videos.
write('media/audio/alarm.wav', Buffer.from(alarmWav()));
const photos: [string, string, { yaw: number; pitch: number; hfov: number }][] = [
  ['entrance', 'lobby', { yaw: 180, pitch: 0, hfov: 70 }],
  ['extinguisher', 'lobby', { yaw: -85, pitch: -6, hfov: 55 }],
  ['assembly', 'assembly', { yaw: 20, pitch: 3, hfov: 50 }],
];
for (const [name, sceneId, view] of photos)
  write(`media/album/${name}.jpg`, encode(800, 533, photo(sceneId, view, 800, 533)));
write('docs/emergency-procedures.pdf', Buffer.from(await procedures()));
const assets = resolve(dirname(fileURLToPath(import.meta.url)), '../assets');
for (const [from, to] of [
  ['drill.webm', 'media/drill/drill.webm'],
  ['strobe.webm', 'media/lobby/strobe.webm'],
] as const) {
  mkdirSync(dirname(join(out, to)), { recursive: true });
  copyFileSync(join(assets, from), join(out, to));
}
// Phase 9: the lobby in omni-directional stereo (left eye on top), the loading dock as a
// GLB model and the mechanical room as Gaussian splats.
const lobbySpec = SCENES.find((x) => x.id === 'lobby')!;
{
  const W = 2048;
  const H = 1024;
  const eyes = (['left', 'right'] as const).map(
    (eye) => (x: number, y: number) =>
      sample(
        (d) => shade(lobbySpec, d, odsOrigin(d, eye)),
        (sx, sy) => direction(-180 + (360 * sx) / W, 90 - (180 * sy) / H),
      )(x, y),
  );
  write(
    'media/lobby-stereo/stereo.jpg',
    encode(W, H * 2, (x, y) => (y < H ? eyes[0]!(x, y) : eyes[1]!(x, y - H))),
  );
  console.log('  lobby-stereo');
}
write('media/dock/dock.glb', Buffer.from(dockModel()));
write('media/mechanical/room.splat', Buffer.from(mechanicalSplats()));
console.log('  dock (GLB), mechanical (splats)');
const corridor = SCENES.find((x) => x.id === 'corridor')!;
write(
  'media/drill/poster.jpg',
  encode(1024, 512, (x, y) =>
    shade(corridor, direction(-180 + ((x + 0.5) / 1024) * 360, 90 - ((y + 0.5) / 512) * 180)),
  ),
);
write('environment.json', JSON.stringify(env, null, 2) + '\n');
console.log(`Demo facility rendered to ${out} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
