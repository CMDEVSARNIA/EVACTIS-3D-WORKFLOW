import { planBearing, routesForScene, visibleEquipment } from '@evactis-3dworkflow/schema';
import { describe, expect, it } from 'vitest';
import { demoEnvironment } from '../src/environment.ts';
import { drawPlan } from '../src/plans.ts';
import { featureAngles } from '../src/scenes.ts';

const env = demoEnvironment();
const yawDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('demo safety layer', () => {
  it('places every item where the plan says it is (panorama direction = plan bearing)', () => {
    for (const e of env.equipment)
      for (const p of e.placements) {
        const scene = env.scenes.find((s) => s.id === p.sceneId)!;
        if (!e.planPosition || scene.floorId !== e.floorId || p.position.kind !== 'spherical')
          continue;
        // Standing at the item (the assembly point): no bearing to compare.
        const { x, y } = scene.planPosition!;
        if (Math.hypot(x - e.planPosition.x, y - e.planPosition.y) < 40) continue;
        const bearing = planBearing(scene.planPosition!, e.planPosition);
        expect(yawDiff(p.position.yaw, bearing), `${e.id} in ${scene.id}`).toBeLessThan(1);
      }
  });

  it('points each route heading at a door of that room', () => {
    const doors = (id: string) =>
      (['n', 'e', 's', 'w'] as const).flatMap((w) => {
        try {
          return [featureAngles(id, 'door', w).yaw];
        } catch {
          return [];
        }
      });
    for (const r of env.routes)
      for (const s of r.starts) {
        if (s.sceneId === 'assembly') continue;
        const near = Math.min(...doors(s.sceneId).map((y) => yawDiff(y, s.heading.yaw)));
        expect(near, `${r.id} in ${s.sceneId}`).toBeLessThan(15);
      }
  });

  it('gives first responders layers that staff do not see', () => {
    const staff = visibleEquipment(env, 'staff').map((e) => e.id);
    const fr = visibleEquipment(env, 'first-responders').map((e) => e.id);
    const extra = fr.filter((id) => !staff.includes(id));
    expect(extra).toEqual(
      expect.arrayContaining(['facp', 'riser-a', 'fdc', 'key-box', 'elec-main']),
    );
    expect(staff.every((id) => fr.includes(id))).toBe(true);
  });

  it('routes every scene to the primary route, with the other one tap away', () => {
    for (const s of env.scenes.filter((x) => x.planPosition)) {
      const r = routesForScene(env, s.id, 'first-responders');
      expect(r.primary?.id, s.id).toBe('route-south');
      expect(r.secondary?.id, s.id).toBe('route-north');
    }
  });

  it('draws plans with walls and door openings', () => {
    const { width, height, rgba } = drawPlan('f1');
    const at = (x: number, y: number) => [
      ...rgba.slice((y * width + x) * 4, (y * width + x) * 4 + 3),
    ];
    expect([width, height]).toEqual([1280, 2240]);
    // Lobby south wall west of the door is navy; the main door itself is open.
    expect(at(Math.round((-3 + 12) * 40), Math.round((4 + 30) * 40))).toEqual([10, 47, 91]);
    expect(at(Math.round(12 * 40), Math.round((4 + 30) * 40))).toEqual([241, 243, 246]);
  });
});
