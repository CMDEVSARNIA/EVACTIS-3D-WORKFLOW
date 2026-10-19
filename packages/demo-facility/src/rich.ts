/**
 * Phase 6 demo content, all procedural and deterministic:
 * - the open office as an HDR capture (bright windows), tone-mapped like the Studio
 *   importer does, with its luminance map for adaptive exposure;
 * - a fire alarm sound (temporal-3 pattern) for the spatial-audio demo;
 * - "photos" for an album: rectilinear views rendered from the panoramas;
 * - the frames of the fire-drill 360° video and of the alarm strobe region (encoded to
 *   WebM by scripts/video.ts, which needs FFmpeg; the WebM files are committed).
 */
import { DEG, direction } from '../../viewer/src/math.ts';
import { anglesOf, featurePoint, radiance, shade, sceneSpec, type RoomSpec } from './scenes.ts';

type V3 = [number, number, number];
type RGB = [number, number, number];

const lum = (c: V3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const toSrgb = (x: number) => {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};

// ----------------------------------------------------------------------------- HDR

/** Log-average luminance of a scene's radiance (the exposure tiles are made for). */
export function logAverage(sceneId: string): number {
  const spec = sceneSpec(sceneId);
  let sum = 0;
  let weight = 0;
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 256; x++) {
      const pitch = 90 - ((y + 0.5) / 128) * 180;
      const w = Math.cos(pitch * DEG);
      const L = lum(radiance(spec, direction(-180 + ((x + 0.5) / 256) * 360, pitch)));
      sum += Math.log(1e-4 + L) * w;
      weight += w;
    }
  return Math.exp(sum / weight);
}

const KEY = 1.25;

/** Tone-mapped colour (Reinhard on luminance, as evx-media does for .hdr imports). */
export function hdrShade(sceneId: string, avg: number) {
  const spec = sceneSpec(sceneId);
  return (d: V3): RGB => {
    const c = radiance(spec, d);
    const L = lum(c);
    if (L <= 0) return [0, 0, 0];
    const x = (L * KEY) / avg;
    const scale = x / (1 + x) / L;
    return [toSrgb(c[0] * scale), toSrgb(c[1] * scale), toSrgb(c[2] * scale)];
  };
}

/**
 * Luminance map (w × h greyscale): log2(L / average) as (v / 255) × 16 − 8 stops, the
 * format the Viewer's adaptive exposure reads.
 */
export function luminanceMap(sceneId: string, avg: number, w = 128, h = 64): Uint8Array {
  const spec = sceneSpec(sceneId);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      // 3 × 3 samples per texel.
      for (let j = 0; j < 3; j++)
        for (let i = 0; i < 3; i++) {
          const yaw = -180 + ((x + (i + 0.5) / 3) / w) * 360;
          const pitch = 90 - ((y + (j + 0.5) / 3) / h) * 180;
          s += lum(radiance(spec, direction(yaw, pitch)));
        }
      const stops = Math.log2(Math.max(1e-4, s / 9) / avg);
      out[y * w + x] = Math.max(0, Math.min(255, Math.round(((stops + 8) / 16) * 255)));
    }
  return out;
}

// ----------------------------------------------------------------------------- audio

/**
 * Fire alarm, temporal-3 pattern (three 0.5 s tones, 0.5 s apart, then 1.5 s quiet),
 * a 3 kHz-ish horn with some harmonics. Mono 16-bit WAV, 22.05 kHz, 4 s (loops).
 */
export function alarmWav(): Uint8Array {
  const rate = 22050;
  const n = rate * 4;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const on = t < 2.5 && t % 1 < 0.5;
    if (!on) continue;
    const local = t % 1;
    const env = Math.min(1, local / 0.01, (0.5 - local) / 0.01);
    const f = 2950;
    const s =
      Math.sin(2 * Math.PI * f * t) * 0.6 +
      Math.sin(2 * Math.PI * f * 2 * t) * 0.2 +
      Math.sin(2 * Math.PI * 520 * t) * 0.2;
    pcm[i] = Math.round(s * env * 0.7 * 32767);
  }
  const data = new Uint8Array(pcm.buffer);
  const header = new DataView(new ArrayBuffer(44));
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => header.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  header.setUint32(4, 36 + data.length, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  str(36, 'data');
  header.setUint32(40, data.length, true);
  const out = new Uint8Array(44 + data.length);
  out.set(new Uint8Array(header.buffer), 0);
  out.set(data, 44);
  return out;
}

// ----------------------------------------------------------------------------- photos

/** A rectilinear "photo" of a scene: width × height, looking at yaw/pitch. */
export function photo(
  sceneId: string,
  view: { yaw: number; pitch: number; hfov: number },
  w: number,
  h: number,
) {
  const spec = sceneSpec(sceneId);
  const f = w / 2 / Math.tan((view.hfov / 2) * DEG);
  const cy = Math.cos(view.yaw * DEG);
  const sy = Math.sin(view.yaw * DEG);
  const cp = Math.cos(view.pitch * DEG);
  const sp = Math.sin(view.pitch * DEG);
  return (x: number, y: number): RGB => {
    // Camera space: +x right, +y up, -z forward; pitch, then yaw (clockwise from north).
    const vx = x - w / 2;
    const vy = h / 2 - y;
    const vz = -f;
    const py = vy * cp - vz * sp;
    const pz = vy * sp + vz * cp;
    const d: V3 = [vx * cy - pz * sy, py, vx * sy + pz * cy];
    const n = Math.hypot(...d);
    return shade(spec, [d[0] / n, d[1] / n, d[2] / n]);
  };
}

// ----------------------------------------------------------------------------- video

/** The lobby's fire alarm pull station: where the strobe flashes and the alarm sounds. */
export function lobbyAlarm(): { yaw: number; pitch: number } {
  const room = sceneSpec('lobby') as RoomSpec;
  const f = room.features.find((x) => x.kind === 'alarm')!;
  return anglesOf(featurePoint(room, f));
}

/** The animated strobe region: a square around the alarm, in yaw/pitch. */
export function strobePolygon() {
  const a = lobbyAlarm();
  const r = 5;
  return [
    { yaw: a.yaw - r, pitch: a.pitch + r },
    { yaw: a.yaw + r, pitch: a.pitch + r },
    { yaw: a.yaw + r, pitch: a.pitch - r },
    { yaw: a.yaw - r, pitch: a.pitch - r },
  ];
}

const flash = (t: number) => {
  // Strobes flash about once a second, briefly.
  const p = t % 1;
  return p < 0.12 ? 1 - p / 0.12 : 0;
};

/**
 * One frame of the strobe region at time t (s): the lobby wall as rendered, with the
 * strobe's glow. Pixels map linearly to the polygon's yaw/pitch bounds, as the Viewer
 * stretches region sources, so the frame lines up with the panorama underneath.
 */
export function strobeFrame(t: number, size = 96) {
  const spec = sceneSpec('lobby');
  const poly = strobePolygon();
  const [y0, y1] = [poly[0]!.yaw, poly[1]!.yaw];
  const [p0, p1] = [poly[2]!.pitch, poly[0]!.pitch];
  const a = lobbyAlarm();
  const k = flash(t);
  return (x: number, y: number): RGB => {
    const yaw = y0 + ((x + 0.5) / size) * (y1 - y0);
    const pitch = p1 - ((y + 0.5) / size) * (p1 - p0);
    const c = shade(spec, direction(yaw, pitch));
    const g = k * Math.exp(-(Math.hypot(yaw - a.yaw, pitch - (a.pitch + 1.2)) ** 2) / 3);
    return [
      Math.min(255, c[0] + 255 * g),
      Math.min(255, c[1] + 240 * g),
      Math.min(255, c[2] + 240 * g),
    ];
  };
}

/** Length of the fire-drill video (s) and its frame rate. */
export const DRILL = { seconds: 10, fps: 12, width: 1024, height: 512 };

/**
 * One frame of the fire-drill 360° video (the east corridor): the alarm strobe flashes
 * and smoke gathers under the ceiling over the ten seconds.
 */
export function drillFrame(t: number, base: (x: number, y: number) => RGB) {
  const room = sceneSpec('corridor') as RoomSpec;
  const alarm = anglesOf(featurePoint(room, room.features.find((f) => f.kind === 'alarm')!));
  const k = flash(t);
  const smoke = Math.min(0.55, (t / DRILL.seconds) * 0.6);
  const { width: w, height: h } = DRILL;
  return (x: number, y: number): RGB => {
    const yaw = -180 + ((x + 0.5) / w) * 360;
    const pitch = 90 - ((y + 0.5) / h) * 180;
    const c = base(x, y);
    const dy = ((yaw - alarm.yaw + 540) % 360) - 180;
    const g = k * Math.exp(-(Math.hypot(dy, pitch - alarm.pitch) ** 2) / 8);
    // Denser towards the ceiling, as hot smoke collects there first.
    const s = smoke * Math.min(1, Math.max(0, (pitch + 20) / 60));
    const mix = (v: number, glow: number) => Math.min(255, v * (1 - s) + 118 * s + glow * g);
    return [mix(c[0], 255), mix(c[1], 230), mix(c[2], 230)];
  };
}
