import { describe, expect, it } from 'vitest';
import { EnvironmentSchema, type EnvironmentInput } from '../src/index.ts';

const T = (en: string) => ({ en, fr: en });

function env(extra: Partial<EnvironmentInput>): EnvironmentInput {
  return {
    schemaVersion: 1,
    id: 'site',
    title: T('Site'),
    facility: { name: T('Site') },
    createdAt: '2026-10-01T09:00:00-04:00',
    updatedAt: '2026-10-01T09:00:00-04:00',
    buildings: [{ id: 'b', name: T('B'), floors: [{ id: 'f1', name: T('F1'), level: 0 }] }],
    scenes: [
      { id: 'pano', name: T('Pano'), media: { type: 'equirect', source: 'm/a.jpg' } },
      {
        id: 'model',
        name: T('Model'),
        media: { type: 'glb', source: 'm/dock.glb' },
        viewpoint: { x: 1, y: 1.6, z: 2 },
      },
      {
        id: 'cloud',
        name: T('Cloud'),
        media: { type: 'splat', source: 'm/room.splat', format: 'splat' },
      },
    ],
    ...extra,
  };
}

const hotspot = (sceneId: string, kind: 'world' | 'spherical') => ({
  id: `h-${sceneId}-${kind}`,
  sceneId,
  title: T('H'),
  position: kind === 'world' ? { kind, x: 0, y: 1, z: -3 } : { kind, yaw: 0, pitch: 0 },
  appearance: { kind: 'button' as const, icon: 'info' as const },
});

describe('3D scenes', () => {
  it('accepts a viewpoint, world hotspots in GLB and splat scenes, and 3D route paths', () => {
    const r = EnvironmentSchema.safeParse(
      env({
        hotspots: [
          hotspot('model', 'world'),
          hotspot('cloud', 'world'),
          hotspot('model', 'spherical'),
        ],
        equipment: [
          {
            id: 'ap',
            typeId: 'assembly-point',
            floorId: 'f1',
            placements: [{ sceneId: 'model', position: { kind: 'world', x: 2, y: 0, z: -5 } }],
          },
        ],
        routes: [
          {
            id: 'r',
            name: T('R'),
            priority: 'primary',
            segments: [
              {
                floorId: 'f1',
                points: [
                  { x: 0, y: 0 },
                  { x: 1, y: 1 },
                ],
              },
            ],
            assemblyPointId: 'ap',
            paths3d: [
              {
                sceneId: 'model',
                points: [
                  { x: 0, y: 0, z: 0 },
                  { x: 2, y: 0, z: -5 },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    expect(r.data?.scenes[1]?.viewpoint).toEqual({ x: 1, y: 1.6, z: 2 });
  });

  it('refuses world positions in panoramas and 3D paths in panorama scenes', () => {
    const r = EnvironmentSchema.safeParse(
      env({
        hotspots: [hotspot('pano', 'world')],
        equipment: [
          {
            id: 'ap',
            typeId: 'assembly-point',
            floorId: 'f1',
            placements: [{ sceneId: 'pano', position: { kind: 'world', x: 2, y: 0, z: -5 } }],
          },
        ],
        routes: [
          {
            id: 'r',
            name: T('R'),
            priority: 'primary',
            segments: [
              {
                floorId: 'f1',
                points: [
                  { x: 0, y: 0 },
                  { x: 1, y: 1 },
                ],
              },
            ],
            assemblyPointId: 'ap',
            paths3d: [
              {
                sceneId: 'pano',
                points: [
                  { x: 0, y: 0, z: 0 },
                  { x: 1, y: 0, z: 0 },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(r.success).toBe(false);
    const msgs = r.error!.issues.map((i) => i.message);
    expect(msgs.filter((m) => m.startsWith('World positions need a 3D'))).toHaveLength(2);
    expect(msgs).toContain('Scene "pano" is not a 3D (GLB or splat) scene');
  });
});
