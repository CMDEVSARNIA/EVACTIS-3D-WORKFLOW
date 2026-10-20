// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parsePly, parseSplat } from '../src/panorama/splat.ts';
import { samplePath } from '../src/safety.ts';

/** One `.splat` record: position, scale, RGBA, rotation (w x y z as bytes). */
function splatRecord(pos: number[], scale: number[], rgba: number[], rot: number[]) {
  const b = new ArrayBuffer(32);
  const f = new Float32Array(b, 0, 6);
  f.set([...pos, ...scale]);
  new Uint8Array(b, 24, 8).set([...rgba, ...rot]);
  return new Uint8Array(b);
}

describe('splat files', () => {
  it('reads .splat records: centre, covariance from scale and rotation, colour', () => {
    const buf = new Uint8Array(64);
    buf.set(splatRecord([1, 2, 3], [0.1, 0.2, 0.3], [255, 0, 0, 128], [255, 128, 128, 128]), 0);
    // 90° about Z: x and y axes swap their scales.
    const s = Math.SQRT1_2 * 128 + 128;
    buf.set(splatRecord([0, 0, 0], [0.1, 0.2, 0.3], [0, 255, 0, 255], [s, 128, 128, s]), 32);
    const d = parseSplat(buf.buffer);
    expect(d.count).toBe(2);
    expect([...d.centers.slice(0, 3)]).toEqual([1, 2, 3]);
    const c0 = [...d.covariances.slice(0, 6)];
    expect(c0[0]).toBeCloseTo(0.01, 4); // xx
    expect(c0[3]).toBeCloseTo(0.04, 4); // yy
    expect(c0[5]).toBeCloseTo(0.09, 4); // zz
    const c1 = [...d.covariances.slice(6, 12)];
    expect(c1[0]).toBeCloseTo(0.04, 2);
    expect(c1[3]).toBeCloseTo(0.01, 2);
    expect([...d.colors.slice(0, 4)].map((v) => Math.round(v * 255))).toEqual([255, 0, 0, 128]);
  });

  it('reads binary 3DGS .ply: exp scales, sigmoid opacity, DC colour', () => {
    const props = [
      'x',
      'y',
      'z',
      'f_dc_0',
      'f_dc_1',
      'f_dc_2',
      'opacity',
      'scale_0',
      'scale_1',
      'scale_2',
      'rot_0',
      'rot_1',
      'rot_2',
      'rot_3',
    ];
    const header =
      'ply\nformat binary_little_endian 1.0\nelement vertex 1\n' +
      props.map((p) => `property float ${p}\n`).join('') +
      'end_header\n';
    const head = new TextEncoder().encode(header);
    const body = new Float32Array([
      4,
      5,
      6,
      0,
      0,
      0,
      0,
      Math.log(0.5),
      Math.log(0.5),
      Math.log(0.5),
      1,
      0,
      0,
      0,
    ]);
    const buf = new Uint8Array(head.length + body.byteLength);
    buf.set(head);
    buf.set(new Uint8Array(body.buffer), head.length);
    const d = parsePly(buf.buffer);
    expect([...d.centers]).toEqual([4, 5, 6]);
    expect(d.covariances[0]).toBeCloseTo(0.25, 5);
    expect(d.colors[0]).toBeCloseTo(0.5, 5);
    expect(d.colors[3]).toBeCloseTo(0.5, 5);
    expect(() =>
      parsePly(new TextEncoder().encode('ply\nformat ascii 1.0\nend_header\n').buffer),
    ).toThrow(/binary little-endian/);
  });
});

describe('3D route paths', () => {
  it('samples points along a polyline at a fixed spacing, across corners', () => {
    const pts = samplePath(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: -2 },
      ],
      0.9,
      10,
    );
    expect(pts).toHaveLength(4);
    expect(pts[1]).toMatchObject({ x: 0.9, z: 0 });
    expect(pts[2]!.x).toBeCloseTo(1, 6);
    expect(pts[2]!.z).toBeCloseTo(-0.8, 6);
    expect(
      samplePath(
        [
          { x: 0, y: 0, z: 0 },
          { x: 100, y: 0, z: 0 },
        ],
        1,
        5,
      ),
    ).toHaveLength(5);
  });
});
