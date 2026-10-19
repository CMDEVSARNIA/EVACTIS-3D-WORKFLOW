// @vitest-environment jsdom
import { EnvironmentSchema } from '@evactis-3dworkflow/schema';
import { describe, expect, it, vi } from 'vitest';
import { AssetError, checkedResolver, resolveAsset, resolveBase } from '../src/assets.ts';
import { Emitter } from '../src/events.ts';
import { angles, direction, wrapYaw, yawDelta } from '../src/math.ts';
import { FACES, FACE_BASIS, facePixelDirection, facePoint } from '../src/panorama/cube.ts';
import { ViewerState } from '../src/state.ts';

describe('angle conventions', () => {
  it('round-trips yaw/pitch through directions', () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [90, 10],
      [-135, -40],
      [179, 89],
    ] as const) {
      const a = angles(direction(yaw, pitch));
      expect(a.yaw).toBeCloseTo(yaw, 6);
      expect(a.pitch).toBeCloseTo(pitch, 6);
    }
    expect(direction(0, 0)).toEqual([0, 0, -1]);
  });

  it('wraps yaw and takes the short way round', () => {
    expect(wrapYaw(190)).toBe(-170);
    expect(wrapYaw(-180)).toBe(180);
    expect(yawDelta(170, -170)).toBe(20);
  });
});

describe('cube faces', () => {
  it('face centres point at the expected directions', () => {
    const want = {
      f: [0, 0],
      r: [90, 0],
      b: [180, 0],
      l: [-90, 0],
      u: [0, 90],
      d: [0, -90],
    } as const;
    for (const face of FACES) {
      const a = angles(facePoint(face, 0, 0));
      expect(a.pitch).toBeCloseTo(want[face][1], 6);
      if (Math.abs(want[face][1]) < 90) expect(wrapYaw(a.yaw)).toBeCloseTo(want[face][0], 6);
    }
  });

  it('each basis is orthonormal and right-handed as seen from inside', () => {
    for (const face of FACES) {
      const { forward: f, right: r, up: u } = FACE_BASIS[face];
      const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
      expect(dot(f, r)).toBe(0);
      expect(dot(f, u)).toBe(0);
      expect(dot(r, u)).toBe(0);
      // right × up = -forward (camera convention: looking down -Z, X right, Y up).
      const cross = [
        r[1] * u[2] - r[2] * u[1],
        r[2] * u[0] - r[0] * u[2],
        r[0] * u[1] - r[1] * u[0],
      ];
      expect(cross.map((x) => x + 0)).toEqual(f.map((x) => -x + 0));
    }
  });

  it('adjacent faces meet at the same direction (no seams)', () => {
    const edgeF = angles(facePixelDirection('f', 512, 511.5, 255.5));
    const edgeR = angles(facePixelDirection('r', 512, -0.5, 255.5));
    expect(edgeF.yaw).toBeCloseTo(edgeR.yaw, 4);
  });
});

describe('asset resolution', () => {
  const page = 'http://127.0.0.1:4176/demo/index.html';
  it('accepts relative and same-origin bases', () => {
    expect(resolveBase('./', page).href).toBe('http://127.0.0.1:4176/demo/');
    expect(resolveBase('env', page).href).toBe('http://127.0.0.1:4176/demo/env/');
    expect(resolveBase('file:///D:/Riverside/', page).protocol).toBe('file:');
    expect(resolveBase('http://tauri.localhost/env/', page).hostname).toBe('tauri.localhost');
  });
  it('refuses remote bases', () => {
    expect(() => resolveBase('https://cdn.example.com/env/', page)).toThrow(AssetError);
    expect(() => resolveBase('//example.com/', page)).toThrow(AssetError);
  });
  it('refuses asset paths that leave the package', () => {
    const base = resolveBase('./', page);
    expect(resolveAsset(base, 'media/a.jpg')).toBe('http://127.0.0.1:4176/demo/media/a.jpg');
    for (const bad of ['../x.jpg', 'https://example.com/a.jpg', '/etc/passwd', 'media\\a.jpg'])
      expect(() => resolveAsset(base, bad)).toThrow(AssetError);
  });
});

describe('custom asset resolvers (Studio)', () => {
  const page = 'http://tauri.localhost/index.html';
  it('accepts local URLs from the resolver', () => {
    const studio = checkedResolver(
      (p) => `asset://localhost/${encodeURIComponent(`/data/Riverside/${p}`)}`,
      page,
    );
    expect(studio('media/abc/thumb.jpg')).toBe(
      'asset://localhost/%2Fdata%2FRiverside%2Fmedia%2Fabc%2Fthumb.jpg',
    );
    const windows = checkedResolver((p) => `http://asset.localhost/C%3A%5Cp%5C${p}`, page);
    expect(windows('media/a.jpg')).toContain('asset.localhost');
  });
  it('refuses remote URLs and bad paths even if the resolver returns them', () => {
    const remote = checkedResolver((p) => `https://cdn.example.com/${p}`, page);
    expect(() => remote('media/a.jpg')).toThrow(AssetError);
    const ok = checkedResolver((p) => `asset://localhost/${p}`, page);
    for (const bad of ['../x.jpg', 'https://example.com/a.jpg', '/etc/passwd'])
      expect(() => ok(bad)).toThrow(AssetError);
  });
});

describe('conditions and audiences', () => {
  const env = EnvironmentSchema.parse({
    schemaVersion: 1,
    id: 'x',
    title: { en: 'X' },
    facility: { name: { en: 'X' } },
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T00:00:00Z',
    scenes: [{ id: 's', name: { en: 'S' }, media: { type: 'equirect', source: 'a.jpg' } }],
    variables: [
      { id: 'n', kind: 'number', initial: 2 },
      { id: 'b', kind: 'boolean' },
    ],
    audiences: [
      { id: 'staff', name: { en: 'Staff' } },
      { id: 'fr', name: { en: 'First responders' } },
    ],
    settings: { languages: ['en'] },
  });

  it('evaluates nested conditions', () => {
    const s = new ViewerState(env, 'staff');
    expect(
      s.test({
        all: [
          { variable: 'n', op: 'gte', value: 2 },
          { not: { variable: 'b', op: 'eq', value: true } },
        ],
      }),
    ).toBe(true);
    expect(s.test({ any: [{ visited: 's' }, { audience: 'fr' }] })).toBe(false);
    s.visited.add('s');
    expect(s.test({ any: [{ visited: 's' }, { audience: 'fr' }] })).toBe(true);
  });

  it('empty audience lists mean everyone; others need a match', () => {
    const s = new ViewerState(env, 'staff');
    expect(s.inAudience([])).toBe(true);
    expect(s.inAudience(['fr'])).toBe(false);
    expect(new ViewerState(env, null).inAudience(['fr'])).toBe(false);
  });
});

describe('Emitter', () => {
  it('isolates listener errors', () => {
    const onError = vi.fn();
    const e = new Emitter<{ x: number }>(onError);
    const seen: number[] = [];
    e.on('x', () => {
      throw new Error('boom');
    });
    const off = e.on('x', (v) => seen.push(v));
    e.emit('x', 1);
    off();
    e.emit('x', 2);
    expect(seen).toEqual([1]);
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
