// @vitest-environment jsdom
import { EnvironmentSchema } from '@evactis-3dworkflow/schema';
import { demoEnvironmentInput } from '@evactis-3dworkflow/demo-facility/environment';
import { describe, expect, it } from 'vitest';
import { soundDirection } from '../src/audio.ts';
import { LiveLayers } from '../src/live.ts';
import { adaptation } from '../src/panorama/adaptive.ts';
import { hazeForVisibility } from '../src/panorama/grading.ts';
import { regionGeometry } from '../src/panorama/regions.ts';

const env = EnvironmentSchema.parse(demoEnvironmentInput());

describe('live layers', () => {
  it('grades scenes by the current state, and only the scenes it overrides', () => {
    const layers = new LiveLayers(() => env);
    expect(layers.grade('lobby')).toEqual({ exposure: 0, haze: 0, hazeColor: '#808080' });
    layers.set('conditions', 'smoke');
    const smoke = layers.grade('lobby');
    expect(smoke.exposure).toBe(-0.6);
    expect(smoke.haze).toBeCloseTo(hazeForVisibility(3), 6);
    expect(smoke.hazeColor).toBe('#6f6c66');
    // Outdoors is not in the smoke override list.
    expect(layers.grade('assembly').haze).toBe(0);
    expect(() => layers.set('conditions', 'fog')).toThrow(/Unknown state/);
  });

  it('thicker smoke (shorter visibility) means more haze', () => {
    expect(hazeForVisibility(undefined)).toBe(0);
    expect(hazeForVisibility(10)).toBeLessThan(hazeForVisibility(5));
    expect(hazeForVisibility(1)).toBeGreaterThan(0.99);
  });
});

describe('adaptive exposure', () => {
  it('darkens bright views and brightens dark ones, within limits', () => {
    expect(adaptation(0)).toBe(-0);
    expect(adaptation(2)).toBeLessThan(0);
    expect(adaptation(-1)).toBeGreaterThan(0);
    expect(adaptation(8)).toBe(-2);
    expect(adaptation(-8)).toBe(1.5);
  });
});

describe('spatial sound captions', () => {
  it('names the direction relative to the view', () => {
    expect(soundDirection(0, 20)).toBe('ahead');
    expect(soundDirection(0, 90)).toBe('right');
    expect(soundDirection(0, -90)).toBe('left');
    expect(soundDirection(170, -20)).toBe('behind');
    expect(soundDirection(-170, 100)).toBe('left');
  });
});

describe('animated regions', () => {
  it('covers the polygon on the sphere with UVs spanning the source', () => {
    // A square straddling ±180°.
    const g = regionGeometry([
      { yaw: 170, pitch: 10 },
      { yaw: -170, pitch: 10 },
      { yaw: -170, pitch: -10 },
      { yaw: 170, pitch: -10 },
    ]);
    const uv = g.getAttribute('uv');
    const pos = g.getAttribute('position');
    let minU = 1;
    let maxU = 0;
    for (let i = 0; i < uv.count; i++) {
      minU = Math.min(minU, uv.getX(i));
      maxU = Math.max(maxU, uv.getX(i));
      // On the sphere (radius 4.8), facing south (z > 0).
      expect(Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i))).toBeCloseTo(4.8, 5);
      expect(pos.getZ(i)).toBeGreaterThan(0);
    }
    expect(minU).toBeCloseTo(0, 6);
    expect(maxU).toBeCloseTo(1, 6);
  });
});
