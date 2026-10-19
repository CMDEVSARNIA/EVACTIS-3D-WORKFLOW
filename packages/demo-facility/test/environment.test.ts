import { findMissingTranslations } from '@evactis-3dworkflow/schema';
import { describe, expect, it } from 'vitest';
import { demoEnvironment } from '../src/environment.ts';
import { SCENES, anglesOf, featureAngles, shade } from '../src/scenes.ts';

describe('demo facility', () => {
  const env = demoEnvironment();

  it('is a valid, fully bilingual environment with 4–6 panoramas on two floors', () => {
    // Panoramas are the places; the fire-drill 360° video is training content on top.
    const panoramas = env.scenes.filter((s) => s.media.type === 'equirect');
    expect(panoramas.length).toBeGreaterThanOrEqual(4);
    expect(panoramas.length).toBeLessThanOrEqual(6);
    expect(new Set(env.scenes.map((s) => s.floorId).filter(Boolean))).toEqual(
      new Set(['f1', 'f2']),
    );
    expect(findMissingTranslations(env)).toEqual([]);
  });

  it('every scene can be reached from the lobby', () => {
    const seen = new Set(['lobby']);
    const queue = ['lobby'];
    while (queue.length) {
      const id = queue.shift()!;
      for (const h of env.hotspots.filter((x) => x.sceneId === id))
        for (const a of h.actions)
          if (a.type === 'goToScene' && !seen.has(a.sceneId)) {
            seen.add(a.sceneId);
            queue.push(a.sceneId);
          }
    }
    expect([...seen].sort()).toEqual(env.scenes.map((s) => s.id).sort());
  });

  it('places equipment hotspots on the rendered feature (extinguisher is red)', () => {
    const a = featureAngles('lobby', 'extinguisher', 'w');
    const spec = SCENES.find((s) => s.id === 'lobby')!;
    const r0 = Math.PI / 180;
    const d: [number, number, number] = [
      Math.sin(a.yaw * r0) * Math.cos(a.pitch * r0),
      Math.sin(a.pitch * r0),
      -Math.cos(a.yaw * r0) * Math.cos(a.pitch * r0),
    ];
    const [r, g, b] = shade(spec, d);
    expect(r).toBeGreaterThan(g * 2);
    expect(r).toBeGreaterThan(b * 2);
    expect(anglesOf([0, 0, -1])).toEqual({ yaw: 0, pitch: 0 });
  });
});
