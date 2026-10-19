/**
 * Encodes the demo's two videos with FFmpeg (VP9 WebM, plays in every supported
 * webview and in Playwright's Chromium): the fire-drill 360° video and the alarm strobe
 * region. Frames come from src/rich.ts. The outputs are committed in assets/ so builds
 * do not need FFmpeg; rerun after changing the frames:
 *
 *   node scripts/video.ts
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { direction } from '../../viewer/src/math.ts';
import { DRILL, drillFrame, strobeFrame } from '../src/rich.ts';
import { sceneSpec, shade } from '../src/scenes.ts';

const assets = resolve(dirname(fileURLToPath(import.meta.url)), '../assets');

function encode(file: string, w: number, h: number, fps: number, frames: Buffer[], crf: number) {
  const r = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-s',
      `${w}x${h}`,
      '-r',
      String(fps),
      '-i',
      '-',
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      String(crf),
      '-row-mt',
      '0',
      '-threads',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-an',
      '-fflags',
      '+bitexact',
      '-flags:v',
      '+bitexact',
      join(assets, file),
    ],
    { input: Buffer.concat(frames), maxBuffer: 1 << 30 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  console.log(`  ${file}: ${frames.length} frames`);
}

function frame(w: number, h: number, px: (x: number, y: number) => [number, number, number]) {
  const b = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = px(x, y);
      b.set([Math.round(c[0]), Math.round(c[1]), Math.round(c[2])], (y * w + x) * 3);
    }
  return b;
}

// Strobe region: one second, looping.
encode(
  'strobe.webm',
  96,
  96,
  12,
  Array.from({ length: 12 }, (_, i) => frame(96, 96, strobeFrame(i / 12))),
  24,
);

// Fire drill: the corridor rendered once, then the strobe and smoke per frame.
const { width: w, height: h, fps, seconds } = DRILL;
const spec = sceneSpec('corridor');
const base = new Uint8Array(w * h * 3);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const c = shade(spec, direction(-180 + ((x + 0.5) / w) * 360, 90 - ((y + 0.5) / h) * 180));
    base.set(c, (y * w + x) * 3);
  }
const at = (x: number, y: number): [number, number, number] => {
  const i = (y * w + x) * 3;
  return [base[i]!, base[i + 1]!, base[i + 2]!];
};
encode(
  'drill.webm',
  w,
  h,
  fps,
  Array.from({ length: seconds * fps }, (_, i) => frame(w, h, drillFrame(i / fps, at))),
  40,
);
