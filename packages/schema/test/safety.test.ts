import { describe, expect, it } from 'vitest';
import {
  EnvironmentSchema,
  createEmptyEnvironment,
  distanceToPolyline,
  equipmentSymbol,
  equipmentTypeInfo,
  planBearing,
  routeHeading,
  routeLength,
  routesForScene,
  visibleEquipment,
  type Environment,
  type EnvironmentInput,
} from '../src/index.ts';

const T = (en: string, fr: string) => ({ en, fr });
const confirmed = { by: 'J. Tremblay', at: '2026-10-01T09:00:00-04:00' };
const pts = (...p: [number, number][]) => p.map(([x, y]) => ({ x, y }));

/** A corridor floor (20 px per metre): scenes A–B–C west to east, exits at both ends. */
function facility(): Environment {
  const base = createEmptyEnvironment('t', T('T', 'T'));
  const input: EnvironmentInput = {
    ...base,
    buildings: [
      {
        id: 'b',
        name: T('B', 'B'),
        floors: [
          {
            id: 'f1',
            name: T('F1', 'F1'),
            level: 0,
            plan: { image: 'p.png', widthPx: 1000, heightPx: 400, pixelsPerMetre: 20 },
          },
        ],
      },
    ],
    scenes: (['a', 'b', 'c', 'd'] as const).map((id, i) => ({
      id,
      name: T(id, id),
      media: { type: 'equirect' as const, source: `m/${id}.jpg` },
      floorId: 'f1',
      planPosition: { x: 200 + 300 * i, y: 200 },
    })),
    equipment: [
      { id: 'ap-west', typeId: 'assembly-point', floorId: 'f1', confirmed },
      { id: 'ap-east', typeId: 'assembly-point', floorId: 'f1', confirmed },
      { id: 'fdc', typeId: 'fdc', floorId: 'f1', audienceIds: ['first-responders'], confirmed },
      { id: 'riser', typeId: 'riser', floorId: 'f1', audienceIds: ['first-responders'] },
      { id: 'fe', typeId: 'fire-extinguisher', floorId: 'f1' },
    ],
    equipmentTypes: [
      {
        id: 'fdc',
        name: T('Fire department connection', 'Raccord pompiers'),
        category: 'fire',
        symbol: 'FDC',
      },
      { id: 'riser', name: T('Sprinkler riser', 'Colonne de gicleurs'), category: 'fire' },
    ],
    routes: [
      {
        id: 'west',
        name: T('West exit', 'Sortie ouest'),
        priority: 'primary',
        segments: [{ floorId: 'f1', points: pts([500, 200], [0, 200]) }],
        sceneSequence: ['b', 'a'],
        starts: [
          { sceneId: 'b', heading: { yaw: -90, pitch: -12 } },
          { sceneId: 'a', heading: { yaw: -90, pitch: -12 } },
        ],
        assemblyPointId: 'ap-west',
        confirmed,
      },
      {
        id: 'east',
        name: T('East exit', 'Sortie est'),
        priority: 'primary',
        segments: [{ floorId: 'f1', points: pts([500, 200], [1000, 200]) }],
        sceneSequence: ['b', 'c'],
        starts: [{ sceneId: 'c', heading: { yaw: 90, pitch: -12 } }],
        assemblyPointId: 'ap-east',
        confirmed,
      },
      {
        id: 'east-alt',
        name: T('East, by the yard', 'Est, par la cour'),
        priority: 'secondary',
        segments: [{ floorId: 'f1', points: pts([500, 200], [500, 400], [1000, 400]) }],
        sceneSequence: ['b'],
        assemblyPointId: 'ap-east',
        confirmed,
      },
      {
        id: 'draft',
        name: T('Draft', 'Brouillon'),
        priority: 'primary',
        segments: [{ floorId: 'f1', points: pts([1100, 200], [1000, 200]) }],
        sceneSequence: ['d'],
        assemblyPointId: 'ap-east',
      },
    ],
  };
  return EnvironmentSchema.parse(input);
}

describe('safety helpers', () => {
  it('describes built-in and custom equipment types', () => {
    const env = facility();
    expect(equipmentTypeInfo(env, 'aed')).toMatchObject({
      sign: 'aed',
      category: 'safe-condition',
      builtIn: true,
    });
    const fdc = equipmentTypeInfo(env, 'fdc');
    expect(fdc).toMatchObject({ category: 'fire', builtIn: false });
    expect(equipmentSymbol(fdc)).toBe('FDC');
    expect(equipmentSymbol(equipmentTypeInfo(env, 'riser'))).toBe('SR');
  });

  it('filters equipment by audience', () => {
    const env = facility();
    const ids = (a: string | null) => visibleEquipment(env, a).map((e) => e.id);
    expect(ids('staff')).toEqual(['ap-west', 'ap-east', 'fe']);
    expect(ids('first-responders')).toEqual(['ap-west', 'ap-east', 'fdc', 'riser', 'fe']);
  });

  it('measures routes and distances on calibrated plans', () => {
    const env = facility();
    expect(routeLength(env, env.routes[0]!)).toBe(25);
    expect(distanceToPolyline({ x: 300, y: 260 }, pts([0, 200], [500, 200]))).toBe(60);
    expect(distanceToPolyline({ x: -40, y: 230 }, pts([0, 200], [500, 200]))).toBe(50);
    expect(planBearing({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(90);
    expect(planBearing({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe(0);
  });

  it('picks the shortest primary route through the scene and another one tap away', () => {
    const env = facility();
    // b is on all three; the two primaries are 25 m each, so the first stays primary,
    // and the secondary route is the alternative offered.
    const b = routesForScene(env, 'b', 'staff');
    expect([b.primary?.id, b.secondary?.id]).toEqual(['west', 'east-alt']);
    const c = routesForScene(env, 'c', 'staff');
    expect([c.primary?.id, c.secondary?.id]).toEqual(['east', 'east-alt']);
    expect(routeHeading(c.primary!, 'c')).toEqual({ yaw: 90, pitch: -12 });
    expect(routeHeading(c.primary!, 'a')).toBeNull();
  });

  it('falls back to the nearest route on the floor, and ignores unconfirmed routes', () => {
    const env = facility();
    // d (x = 1100) is only on the draft route, which nobody confirmed.
    const d = routesForScene(env, 'd', 'staff');
    expect(d.primary?.id).toBe('east');
    expect(routesForScene(env, 'd', 'staff', { includeUnconfirmed: true }).primary?.id).toBe(
      'draft',
    );
    expect(routesForScene(env, 'nope', 'staff')).toEqual({ primary: null, secondary: null });
  });

  it('checks posting references', () => {
    const env = facility();
    env.postings.push({
      id: 'p1',
      name: T('Lobby', 'Hall'),
      floorId: 'f9',
      planPosition: { x: 1, y: 1 },
    });
    const r = EnvironmentSchema.safeParse(env);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('Unknown floor \\"f9\\"');
  });
});
