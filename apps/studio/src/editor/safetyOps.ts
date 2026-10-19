/**
 * Safety-layer editing operations (equipment, routes, postings, audience lock). Like
 * ops.ts they run on a store draft and keep references valid.
 *
 * Confirmation rule (CLAUDE.md): safety content counts only once a person confirms it.
 * Anything that changes where an item is, what it is, or where a route goes clears its
 * confirmation, so a moved extinguisher or redrawn route must be confirmed again.
 */
import {
  allFloors,
  distanceToPolyline,
  equipmentTypeInfo,
  planBearing,
  type Environment,
  type Equipment,
  type EquipmentType,
  type LocalizedText,
  type PlanPoint,
  type Route,
  type Spherical,
} from '@evactis-3dworkflow/schema';
import { EditError, floor, scene, uniqueId, wrapDeg } from './ops.ts';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

const safetyIds = (env: Environment) => [
  ...env.equipment.map((e) => e.id),
  ...env.equipmentTypes.map((t) => t.id),
  ...env.routes.map((r) => r.id),
  ...env.postings.map((p) => p.id),
  ...env.scenes.map((s) => s.id),
  ...env.hotspots.map((h) => h.id),
];

export function equipment(env: Environment, id: string): Equipment {
  const e = env.equipment.find((x) => x.id === id);
  if (!e) throw new EditError(`unknown equipment ${id}`);
  return e;
}

export function route(env: Environment, id: string): Route {
  const r = env.routes.find((x) => x.id === id);
  if (!r) throw new EditError(`unknown route ${id}`);
  return r;
}

// ---------------------------------------------------------------- equipment

export function addEquipmentType(
  env: Environment,
  t: { name: LocalizedText; category: EquipmentType['category']; symbol?: string },
): string {
  const id = uniqueId(t.name.en ?? Object.values(t.name)[0] ?? 'type', safetyIds(env));
  env.equipmentTypes.push({
    id,
    name: t.name,
    category: t.category,
    ...(t.symbol && { symbol: t.symbol.slice(0, 4).toUpperCase() }),
  });
  return id;
}

/** A new, unplaced item of a type on a floor. */
export function addEquipment(env: Environment, typeId: string, floorId: string): string {
  floor(env, floorId);
  const info = equipmentTypeInfo(env, typeId);
  const id = uniqueId(info.name.en ?? typeId, safetyIds(env));
  env.equipment.push({
    id,
    typeId,
    floorId,
    placements: [],
    photos: [],
    audienceIds: [],
    attributes: {},
  });
  return id;
}

export type EquipmentDetails = Partial<
  Pick<
    Equipment,
    | 'tag'
    | 'label'
    | 'description'
    | 'lastInspection'
    | 'nextInspection'
    | 'responsiblePerson'
    | 'audienceIds'
  >
>;

/** Details that do not move or retype the item keep its confirmation. */
export function updateEquipment(env: Environment, id: string, patch: EquipmentDetails) {
  const e = equipment(env, id);
  for (const [k, v] of Object.entries(patch) as [keyof EquipmentDetails, unknown][]) {
    if (v === undefined || v === '') delete e[k];
    else (e as Record<string, unknown>)[k] = v;
  }
}

/** What the item is: a different type is a different item, so confirm again. */
export function setEquipmentType(env: Environment, id: string, typeId: string) {
  const e = equipment(env, id);
  if (e.typeId === typeId) return;
  e.typeId = typeId;
  delete e.confirmed;
}

/** Where it is on the plan (and on which floor). */
export function placeEquipmentOnPlan(
  env: Environment,
  id: string,
  floorId: string,
  at?: PlanPoint,
) {
  const e = equipment(env, id);
  const f = floor(env, floorId);
  e.floorId = floorId;
  if (at && f.plan)
    e.planPosition = {
      x: r1(Math.max(0, Math.min(f.plan.widthPx, at.x))),
      y: r1(Math.max(0, Math.min(f.plan.heightPx, at.y))),
    };
  else delete e.planPosition;
  delete e.confirmed;
}

/** Where its sign is in a scene (one placement per scene). */
export function placeEquipmentInScene(
  env: Environment,
  id: string,
  sceneId: string,
  at: Spherical,
) {
  const e = equipment(env, id);
  scene(env, sceneId);
  const position = {
    kind: 'spherical' as const,
    yaw: r2(wrapDeg(at.yaw)),
    pitch: r2(Math.max(-90, Math.min(90, at.pitch))),
  };
  const existing = e.placements.find((p) => p.sceneId === sceneId);
  if (existing) existing.position = position;
  else e.placements.push({ sceneId, position, style: 'A' });
  delete e.confirmed;
}

export function removePlacement(env: Environment, id: string, sceneId: string) {
  const e = equipment(env, id);
  e.placements = e.placements.filter((p) => p.sceneId !== sceneId);
  delete e.confirmed;
}

export function removeEquipment(env: Environment, id: string) {
  equipment(env, id);
  const usedBy = env.routes.filter((r) => r.assemblyPointId === id);
  if (usedBy.length) throw new EditError(`routes end here: ${usedBy.map((r) => r.id).join(', ')}`);
  env.equipment = env.equipment.filter((e) => e.id !== id);
}

// ---------------------------------------------------------------- confirmation

export interface Confirmation {
  by: string;
  at: string;
}

export function confirmEquipment(env: Environment, id: string, c: Confirmation) {
  if (!c.by.trim()) throw new EditError('a name is needed to confirm');
  equipment(env, id).confirmed = { by: c.by.trim(), at: c.at };
}

export function confirmRoute(env: Environment, id: string, c: Confirmation) {
  if (!c.by.trim()) throw new EditError('a name is needed to confirm');
  const r = route(env, id);
  if (!r.sceneSequence.length) throw new EditError('add the scenes the route passes through first');
  r.confirmed = { by: c.by.trim(), at: c.at };
}

export function unconfirm(env: Environment, kind: 'equipment' | 'route', id: string) {
  delete (kind === 'equipment' ? equipment(env, id) : route(env, id)).confirmed;
}

// ---------------------------------------------------------------- routes

/** A route needs its assembly point and a first line of at least two points. */
export function addRoute(
  env: Environment,
  r: {
    name: LocalizedText;
    priority: Route['priority'];
    assemblyPointId: string;
    floorId: string;
    points: PlanPoint[];
  },
): string {
  const ap = equipment(env, r.assemblyPointId);
  if (ap.typeId !== 'assembly-point') throw new EditError('a route ends at an assembly point');
  floor(env, r.floorId);
  if (r.points.length < 2) throw new EditError('draw at least two points');
  const id = uniqueId(r.name.en ?? Object.values(r.name)[0] ?? 'route', safetyIds(env));
  env.routes.push({
    id,
    name: r.name,
    priority: r.priority,
    segments: [{ floorId: r.floorId, points: r.points.map((p) => ({ x: r1(p.x), y: r1(p.y) })) }],
    sceneSequence: [],
    zoneIds: [],
    assemblyPointId: r.assemblyPointId,
    starts: [],
    audienceIds: [],
  });
  return id;
}

export function updateRoute(
  env: Environment,
  id: string,
  patch: Partial<Pick<Route, 'name' | 'priority' | 'assemblyPointId' | 'audienceIds'>>,
) {
  const r = route(env, id);
  if (patch.assemblyPointId && equipment(env, patch.assemblyPointId).typeId !== 'assembly-point')
    throw new EditError('a route ends at an assembly point');
  const changesWhere =
    patch.assemblyPointId !== undefined && patch.assemblyPointId !== r.assemblyPointId;
  Object.assign(r, patch);
  if (changesWhere) delete r.confirmed;
}

/** Adds a line on a floor, or replaces line `index`. */
export function setRouteSegment(
  env: Environment,
  id: string,
  index: number | null,
  floorId: string,
  points: PlanPoint[],
) {
  const r = route(env, id);
  floor(env, floorId);
  if (points.length < 2) throw new EditError('draw at least two points');
  const seg = { floorId, points: points.map((p) => ({ x: r1(p.x), y: r1(p.y) })) };
  if (index === null) r.segments.push(seg);
  else {
    if (!r.segments[index]) throw new EditError(`no line ${index}`);
    r.segments[index] = seg;
  }
  delete r.confirmed;
}

export function removeRouteSegment(env: Environment, id: string, index: number) {
  const r = route(env, id);
  if (r.segments.length <= 1) throw new EditError('a route keeps at least one line');
  r.segments.splice(index, 1);
  delete r.confirmed;
}

export function setRouteScenes(env: Environment, id: string, sceneIds: string[]) {
  const r = route(env, id);
  for (const s of sceneIds) scene(env, s);
  r.sceneSequence = [...new Set(sceneIds)];
  r.starts = r.starts.filter((s) => r.sceneSequence.includes(s.sceneId));
  delete r.confirmed;
}

export function setRouteHeading(env: Environment, id: string, sceneId: string, heading: Spherical) {
  const r = route(env, id);
  scene(env, sceneId);
  const h = {
    yaw: r2(wrapDeg(heading.yaw)),
    pitch: r2(Math.max(-60, Math.min(10, heading.pitch))),
  };
  const s = r.starts.find((x) => x.sceneId === sceneId);
  if (s) s.heading = h;
  else r.starts.push({ sceneId, heading: h });
  delete r.confirmed;
}

export function removeRoute(env: Environment, id: string) {
  route(env, id);
  env.routes = env.routes.filter((r) => r.id !== id);
  for (const h of env.hotspots)
    h.actions = h.actions.filter((a) => !(a.type === 'showRoute' && a.routeId === id));
}

/** Metres per plan pixel on a floor (1 when not calibrated). */
function ppm(env: Environment, floorId: string): number {
  return allFloors(env).find((f) => f.id === floorId)?.plan?.pixelsPerMetre ?? 20;
}

/**
 * Scenes the drawn route passes (within `withinM` metres of a line on their floor), in
 * walking order. A suggestion: the author checks and applies it.
 */
export function suggestRouteScenes(
  env: Environment,
  r: Pick<Route, 'segments'>,
  withinM = 3,
): string[] {
  const found: { id: string; order: number }[] = [];
  r.segments.forEach((seg, si) => {
    const scale = ppm(env, seg.floorId);
    let walked = 0;
    for (let i = 1; i < seg.points.length; i++) {
      const a = seg.points[i - 1]!;
      const b = seg.points[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (const s of env.scenes) {
        if (s.floorId !== seg.floorId || !s.planPosition) continue;
        const d = distanceToPolyline(s.planPosition, [a, b]) / scale;
        if (d > withinM || found.some((f) => f.id === s.id)) continue;
        const t = len
          ? ((s.planPosition.x - a.x) * (b.x - a.x) + (s.planPosition.y - a.y) * (b.y - a.y)) / len
          : 0;
        found.push({ id: s.id, order: si * 1e9 + walked + Math.max(0, Math.min(len, t)) });
      }
      walked += len;
    }
  });
  return found.sort((x, y) => x.order - y.order).map((f) => f.id);
}

/**
 * The direction to walk in a scene: along the route line nearest to it, turned into the
 * panorama's yaw by the plan's and the scene's north. Null when the scene is not placed
 * on a plan the route crosses.
 */
export function suggestHeading(
  env: Environment,
  r: Pick<Route, 'segments'>,
  sceneId: string,
): Spherical | null {
  const s = env.scenes.find((x) => x.id === sceneId);
  if (!s?.planPosition || !s.floorId) return null;
  const plan = allFloors(env).find((f) => f.id === s.floorId)?.plan;
  if (!plan) return null;
  let best: { d: number; a: PlanPoint; b: PlanPoint; ahead: number } | null = null;
  for (const seg of r.segments.filter((x) => x.floorId === s.floorId))
    for (let i = 1; i < seg.points.length; i++) {
      const a = seg.points[i - 1]!;
      const b = seg.points[i]!;
      const d = distanceToPolyline(s.planPosition, [a, b]);
      // At a corner the scene touches two lines: take the one leaving it.
      const ahead = Math.hypot(b.x - s.planPosition.x, b.y - s.planPosition.y);
      if (!best || d < best.d - 1 || (Math.abs(d - best.d) <= 1 && ahead > best.ahead))
        best = { d, a, b, ahead };
    }
  if (!best) return null;
  // Walk towards the end of the nearest line; at its very end, use the line's direction.
  const toEnd = Math.hypot(best.b.x - s.planPosition.x, best.b.y - s.planPosition.y);
  const from = toEnd > 1 ? s.planPosition : best.a;
  const bearing = planBearing(from, best.b) - plan.northDeg;
  return { yaw: r1(wrapDeg(s.northOffsetDeg + bearing)), pitch: -12 };
}

// ---------------------------------------------------------------- postings and package

export function addPosting(
  env: Environment,
  floorId: string,
  at: PlanPoint,
  name: LocalizedText,
): string {
  const f = floor(env, floorId);
  if (!f.plan) throw new EditError('the floor has no plan');
  const id = uniqueId(`posting ${name.en ?? ''}`, safetyIds(env));
  env.postings.push({ id, name, floorId, planPosition: { x: r1(at.x), y: r1(at.y) } });
  return id;
}

export function updatePosting(
  env: Environment,
  id: string,
  patch: {
    name?: LocalizedText;
    facingDeg?: number | null;
    sceneId?: string | null;
    at?: PlanPoint;
  },
) {
  const p = env.postings.find((x) => x.id === id);
  if (!p) throw new EditError(`unknown posting ${id}`);
  if (patch.name) p.name = patch.name;
  if (patch.at) p.planPosition = { x: r1(patch.at.x), y: r1(patch.at.y) };
  if (patch.facingDeg === null) delete p.facingDeg;
  else if (patch.facingDeg !== undefined) {
    const d = Math.round(((patch.facingDeg % 360) + 360) % 360);
    p.facingDeg = d >= 360 ? 0 : d;
  }
  if (patch.sceneId === null) delete p.sceneId;
  else if (patch.sceneId !== undefined) {
    scene(env, patch.sceneId);
    p.sceneId = patch.sceneId;
  }
}

export function removePosting(env: Environment, id: string) {
  env.postings = env.postings.filter((p) => p.id !== id);
}

/** Package option: lock viewers to one audience (it becomes the default). */
export function setAudienceLock(env: Environment, lock: boolean, audienceId?: string) {
  if (audienceId !== undefined) {
    if (!env.audiences.some((a) => a.id === audienceId))
      throw new EditError(`unknown audience ${audienceId}`);
    env.settings.defaultAudienceId = audienceId;
  }
  if (lock && !env.settings.defaultAudienceId)
    throw new EditError('choose the audience to lock to');
  env.settings.lockAudience = lock;
}
