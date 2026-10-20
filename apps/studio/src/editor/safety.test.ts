import { EnvironmentSchema, routesForScene, type Environment } from '@evactis-3dworkflow/schema';
import { demoEnvironment } from '@evactis-3dworkflow/demo-facility/environment';
import { describe, expect, it } from 'vitest';
import * as ops from './ops.ts';
import { EditError, InUseError } from './ops.ts';
import * as s from './safetyOps.ts';

const valid = (env: Environment) => {
  const r = EnvironmentSchema.safeParse(env);
  if (!r.success)
    throw new Error(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
};
const who = { by: 'J. Tremblay', at: '2026-10-19T10:00:00-04:00' };

describe('safety editing operations', () => {
  it('places signs and hotspots on the model surface in GLB and splat scenes', () => {
    const env = demoEnvironment();
    const id = s.addEquipment(env, 'fire-extinguisher', 'f1');
    const point = { x: 1.23456, y: 0.98765, z: -2.5 };
    s.placeEquipmentInScene(env, id, 'dock', { yaw: 10, pitch: -5, point });
    expect(s.equipment(env, id).placements).toEqual([
      { sceneId: 'dock', position: { kind: 'world', x: 1.235, y: 0.988, z: -2.5 }, style: 'A' },
    ]);
    const h = ops.addHotspot(env, 'mechanical', { yaw: 0, pitch: 0, point }, 'info');
    expect(ops.hotspot(env, h).position).toEqual({ kind: 'world', x: 1.235, y: 0.988, z: -2.5 });
    // Dragged in the preview: onto the surface found there.
    ops.moveHotspot(env, h, { yaw: 0, pitch: 0, point: { x: 0, y: 1, z: -3 } });
    expect(ops.hotspot(env, h).position).toEqual({ kind: 'world', x: 0, y: 1, z: -3 });
    valid(env);
  });

  it('adds equipment, places it in a scene and on the plan, and needs confirming again after a move', () => {
    const env = demoEnvironment();
    const id = s.addEquipment(env, 'fire-extinguisher', 'f1');
    expect(id).toBe('fire-extinguisher');
    s.updateEquipment(env, id, { tag: 'FE-104', lastInspection: '2026-10-01', label: undefined });
    s.placeEquipmentInScene(env, id, 'corridor', { yaw: 270.004, pitch: -10 });
    s.placeEquipmentOnPlan(env, id, 'f1', { x: 520.04, y: 400 });
    s.confirmEquipment(env, id, who);
    const e = s.equipment(env, id);
    expect(e).toMatchObject({
      tag: 'FE-104',
      placements: [{ sceneId: 'corridor', position: { kind: 'spherical', yaw: -90, pitch: -10 } }],
      planPosition: { x: 520, y: 400 },
      confirmed: who,
    });
    // Details keep the confirmation; moving it does not.
    s.updateEquipment(env, id, { nextInspection: '2026-11-01' });
    expect(e.confirmed).toEqual(who);
    s.placeEquipmentInScene(env, id, 'corridor', { yaw: -80, pitch: -10 });
    expect(e.confirmed).toBeUndefined();
    expect(e.placements).toHaveLength(1);
    s.confirmEquipment(env, id, who);
    s.setEquipmentType(env, id, 'fire-alarm');
    expect(e.confirmed).toBeUndefined();
    expect(() => s.confirmEquipment(env, id, { by: '  ', at: who.at })).toThrow(EditError);
    valid(env);
    s.removePlacement(env, id, 'corridor');
    s.removeEquipment(env, id);
    expect(env.equipment.some((x) => x.id === id)).toBe(false);
    expect(() => s.removeEquipment(env, 'ap-a')).toThrow(/routes end here/);
  });

  it('adds custom types with a short symbol', () => {
    const env = demoEnvironment();
    const t = s.addEquipmentType(env, {
      name: { en: 'Gas shut-off', fr: 'Robinet de gaz' },
      category: 'utility',
      symbol: 'gas!',
    });
    expect(env.equipmentTypes.find((x) => x.id === t)).toMatchObject({
      id: 'gas-shut-off',
      symbol: 'GAS!',
    });
    s.addEquipment(env, t, 'f2');
    valid(env);
  });

  it('suggests the scenes a drawn route passes, in walking order, and their headings', () => {
    const env = demoEnvironment();
    const south = s.route(env, 'route-south');
    // The demo's own route: lines in order (the corridor branch is the last line), and
    // every heading comes back from the drawing.
    expect(s.suggestRouteScenes(env, south)).toEqual([
      'electrical',
      'office',
      'stairwell',
      'lobby',
      'assembly',
      'corridor',
    ]);
    for (const start of south.starts) {
      if (start.sceneId === 'assembly') continue;
      const h = s.suggestHeading(env, south, start.sceneId)!;
      const diff = Math.abs(((h.yaw - start.heading.yaw + 540) % 360) - 180);
      expect(diff, start.sceneId).toBeLessThan(1);
    }
    expect(s.suggestHeading(env, south, 'nope')).toBeNull();
  });

  it('builds a route from a drawing; any change needs confirming again', () => {
    const env = demoEnvironment();
    const north = s.route(env, 'route-north');
    const id = s.addRoute(env, {
      name: { en: 'West door', fr: 'Porte ouest' },
      priority: 'secondary',
      assemblyPointId: 'ap-a',
      floorId: 'f1',
      points: north.segments[2]!.points,
    });
    expect(() => s.confirmRoute(env, id, who)).toThrow(/scenes the route passes/);
    const r = s.route(env, id);
    s.setRouteScenes(env, id, s.suggestRouteScenes(env, r));
    expect(r.sceneSequence).toEqual(['stairwell', 'lobby', 'corridor', 'assembly']);
    for (const sc of r.sceneSequence) {
      const h = s.suggestHeading(env, r, sc);
      if (h) s.setRouteHeading(env, id, sc, h);
    }
    s.confirmRoute(env, id, who);
    valid(env);
    s.setRouteSegment(env, id, null, 'f2', north.segments[1]!.points);
    expect(r.confirmed).toBeUndefined();
    expect(() =>
      s.addRoute(env, {
        name: { en: 'X' },
        priority: 'primary',
        assemblyPointId: 'fe-101',
        floorId: 'f1',
        points: [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      }),
    ).toThrow(/assembly point/);
    expect(() => s.removeRouteSegment(env, 'route-south', 0)).not.toThrow();
    // Only confirmed routes reach the Viewer and print.
    s.unconfirm(env, 'route', 'route-south');
    expect(routesForScene(env, 'lobby', 'staff').primary?.id).toBe('route-north');
    s.removeRoute(env, id);
    valid(env);
  });

  it('places postings and locks the audience', () => {
    const env = demoEnvironment();
    const p = s.addPosting(
      env,
      'f2',
      { x: 500, y: 600 },
      { en: 'Office door', fr: 'Porte du bureau' },
    );
    s.updatePosting(env, p, { facingDeg: -90, sceneId: 'office' });
    expect(env.postings.find((x) => x.id === p)).toMatchObject({
      facingDeg: 270,
      sceneId: 'office',
    });
    s.setAudienceLock(env, true, 'first-responders');
    expect(env.settings).toMatchObject({
      lockAudience: true,
      defaultAudienceId: 'first-responders',
    });
    expect(() => s.setAudienceLock(env, true, 'nobody')).toThrow(EditError);
    valid(env);
    s.removePosting(env, p);
    expect(InUseError).toBeDefined();
  });
});
