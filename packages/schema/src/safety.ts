/**
 * Safety-layer helpers shared by the Viewer, Studio and the print package: what each
 * equipment type looks like, what an audience may see, and which evacuation route
 * applies to a scene. Pure functions; they never create safety content.
 */
import type { SafetySignName } from './kit.ts';
import type { Environment, Equipment, EquipmentType, Floor, Route, Scene } from './environment.ts';
import type { LocalizedText, PlanPoint } from './primitives.ts';

export type EquipmentCategory = EquipmentType['category'];

export interface EquipmentTypeInfo {
  id: string;
  name: LocalizedText;
  category: EquipmentCategory;
  sign?: SafetySignName;
  /** Short code for types without a sign. */
  symbol?: string;
  builtIn: boolean;
}

/** The built-in equipment types and the safety sign each uses. */
export const BUILT_IN_TYPES: Record<string, Omit<EquipmentTypeInfo, 'id' | 'builtIn'>> = {
  exit: {
    name: { en: 'Emergency exit', fr: 'Sortie de secours' },
    category: 'safe-condition',
    sign: 'emergency-exit',
  },
  'first-aid': {
    name: { en: 'First aid', fr: 'Premiers soins' },
    category: 'safe-condition',
    sign: 'first-aid',
  },
  aed: { name: { en: 'AED', fr: 'DEA' }, category: 'safe-condition', sign: 'aed' },
  'assembly-point': {
    name: { en: 'Assembly point', fr: 'Point de rassemblement' },
    category: 'safe-condition',
    sign: 'assembly-point',
  },
  'fire-extinguisher': {
    name: { en: 'Fire extinguisher', fr: 'Extincteur' },
    category: 'fire',
    sign: 'fire-extinguisher',
  },
  'fire-alarm': {
    name: { en: 'Fire alarm pull station', fr: 'Avertisseur d’incendie manuel' },
    category: 'fire',
    sign: 'fire-alarm',
  },
  hazard: { name: { en: 'Hazard', fr: 'Danger' }, category: 'warning', sign: 'warning' },
};

export function equipmentTypeInfo(env: Environment, typeId: string): EquipmentTypeInfo {
  const custom = env.equipmentTypes.find((t) => t.id === typeId);
  if (custom)
    return {
      id: custom.id,
      name: custom.name,
      category: custom.category,
      ...(custom.sign && { sign: custom.sign }),
      ...(custom.symbol && { symbol: custom.symbol }),
      builtIn: false,
    };
  const b = BUILT_IN_TYPES[typeId];
  if (b) return { id: typeId, ...b, builtIn: true };
  return { id: typeId, name: { en: typeId }, category: 'custom', builtIn: false };
}

/** Short code for a marker without a sign: the type's symbol, else its initials. */
export function equipmentSymbol(info: EquipmentTypeInfo): string {
  if (info.symbol) return info.symbol;
  const words = (info.name.en ?? Object.values(info.name)[0] ?? info.id).split(/[\s-]+/);
  return words
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

/** True when an item with these audience IDs is visible to `audience` (empty = everyone). */
export function forAudience(ids: readonly string[], audience: string | null): boolean {
  return ids.length === 0 || (audience !== null && ids.includes(audience));
}

/** Equipment the audience may see. A custom type's audience is not inherited. */
export function visibleEquipment(env: Environment, audience: string | null): Equipment[] {
  return env.equipment.filter((e) => forAudience(e.audienceIds, audience));
}

export function visibleRoutes(env: Environment, audience: string | null): Route[] {
  return env.routes.filter((r) => forAudience(r.audienceIds, audience));
}

export function allFloors(env: Environment): Floor[] {
  return env.buildings.flatMap((b) => b.floors);
}

const dist = (a: PlanPoint, b: PlanPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from a point to a polyline (plan pixels). */
export function distanceToPolyline(p: PlanPoint, line: readonly PlanPoint[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = len2
      ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2))
      : 0;
    best = Math.min(best, dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }));
  }
  return line.length === 1 ? dist(p, line[0]!) : best;
}

/** Length of a route in metres where the plans are calibrated (pixels otherwise). */
export function routeLength(env: Environment, route: Route): number {
  const floors = allFloors(env);
  return route.segments.reduce((sum, s) => {
    const ppm = floors.find((f) => f.id === s.floorId)?.plan?.pixelsPerMetre ?? 1;
    let px = 0;
    for (let i = 1; i < s.points.length; i++) px += dist(s.points[i - 1]!, s.points[i]!);
    return sum + px / ppm;
  }, 0);
}

/** How far a scene is from a route: 0 when the route passes through it. */
function sceneDistance(env: Environment, route: Route, scene: Scene): number {
  if (route.starts.some((s) => s.sceneId === scene.id) || route.sceneSequence.includes(scene.id))
    return 0;
  if (!scene.floorId || !scene.planPosition) return Infinity;
  const ppm = allFloors(env).find((f) => f.id === scene.floorId)?.plan?.pixelsPerMetre ?? 1;
  const d = Math.min(
    ...route.segments
      .filter((s) => s.floorId === scene.floorId)
      .map((s) => distanceToPolyline(scene.planPosition!, s.points)),
  );
  return d / ppm;
}

export interface RouteChoice {
  /** The nearest primary route (or the nearest route of any kind if no primary reaches). */
  primary: Route | null;
  /** The nearest other route, one tap away. */
  secondary: Route | null;
}

/**
 * Routes for a scene: those passing through it first, then the nearest on its floor.
 * Among routes that pass through, the shorter wins. Unconfirmed routes are left out
 * unless `includeUnconfirmed` (Studio's preview).
 */
export function routesForScene(
  env: Environment,
  sceneId: string,
  audience: string | null,
  options: { includeUnconfirmed?: boolean } = {},
): RouteChoice {
  const scene = env.scenes.find((s) => s.id === sceneId);
  if (!scene) return { primary: null, secondary: null };
  const ranked = visibleRoutes(env, audience)
    .filter((r) => options.includeUnconfirmed || r.confirmed)
    .map((r) => ({ r, d: sceneDistance(env, r, scene), len: routeLength(env, r) }))
    .filter((x) => Number.isFinite(x.d))
    .sort((a, b) => a.d - b.d || a.len - b.len);
  const primary =
    ranked.find((x) => x.r.priority === 'primary' && x.d === ranked[0]!.d)?.r ??
    ranked.find((x) => x.r.priority === 'primary')?.r ??
    ranked[0]?.r ??
    null;
  const secondary =
    ranked.find((x) => x.r !== primary && x.r.priority === 'secondary')?.r ??
    ranked.find((x) => x.r !== primary)?.r ??
    null;
  return { primary, secondary };
}

/** The direction to walk in a scene on this route, if the route covers it. */
export function routeHeading(route: Route, sceneId: string): { yaw: number; pitch: number } | null {
  return route.starts.find((s) => s.sceneId === sceneId)?.heading ?? null;
}

/** Bearing (degrees clockwise from the top of the plan) from `a` to `b`. */
export function planBearing(a: PlanPoint, b: PlanPoint): number {
  return ((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI + 360) % 360;
}

/** Confirmed items only: what printed plans and registers may show. */
export function isConfirmed(item: { confirmed?: { by: string; at: string } | undefined }) {
  return !!item.confirmed;
}
