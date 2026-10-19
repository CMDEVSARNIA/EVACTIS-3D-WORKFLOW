/**
 * Suggested links from one scene to its neighbours. Suggestions only: nothing is
 * linked until the author accepts one, and the hotspot lands where the author can
 * see and drag it.
 *
 * Where the neighbour is, best source first:
 * 1. plan: both scenes placed on the same floor plan (direction from the plan and its
 *    north; distance when the plan is calibrated);
 * 2. gps: both scenes carry GPS from the camera (outdoors, or large sites; indoor GPS
 *    is often off by 5–20 m, hence a generous radius);
 * 3. capture order: the scene shot just before or after (direction unknown).
 *
 * Bearings are true-north based; a scene's `northOffsetDeg` turns them into the yaw
 * where the neighbour appears, so links point the right way once north is set.
 */
import type { Environment, Scene } from '@evactis-3dworkflow/schema';
import { linkedScenes, wrapDeg } from './ops.ts';

export type LinkReason = 'plan' | 'gps' | 'sequence';

export interface LinkSuggestion {
  targetId: string;
  reason: LinkReason;
  /** Metres, when known. */
  distanceM?: number;
  /** Where the neighbour is in this scene's panorama; absent when unknown. */
  yaw?: number;
  pitch: number;
}

export interface SuggestOptions {
  /** Scene IDs in capture order (from the library's capture times). Default: document order. */
  order?: string[];
  /** Neighbours further than this are not suggested (plan and GPS). */
  maxDistanceM?: number;
  /** Most suggestions from plan and GPS (capture-order neighbours come on top). */
  limit?: number;
}

/** Camera height used to aim link hotspots at the floor where the neighbour stands. */
const EYE_HEIGHT_M = 1.6;
const DEFAULT_PITCH = -15;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance (m) and initial bearing (degrees clockwise from true north). */
export function geoVector(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): { distanceM: number; bearingDeg: number } {
  const R = 6_371_008.8;
  const [φ1, φ2] = [rad(a.lat), rad(b.lat)];
  const Δφ = φ2 - φ1;
  const Δλ = rad(b.lon - a.lon);
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const distanceM = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return { distanceM, bearingDeg: (deg(Math.atan2(y, x)) + 360) % 360 };
}

/** Pitch that looks at the floor `distanceM` away (camera at eye height). */
export function floorPitch(distanceM: number | undefined): number {
  if (distanceM === undefined || !(distanceM > 0)) return DEFAULT_PITCH;
  return (
    Math.round(Math.max(-45, Math.min(-5, -deg(Math.atan2(EYE_HEIGHT_M, distanceM)))) * 10) / 10
  );
}

function planVector(env: Environment, a: Scene, b: Scene) {
  if (!a.floorId || a.floorId !== b.floorId || !a.planPosition || !b.planPosition) return null;
  const plan = env.buildings.flatMap((x) => x.floors).find((f) => f.id === a.floorId)?.plan;
  if (!plan) return null;
  const dx = b.planPosition.x - a.planPosition.x;
  const dy = b.planPosition.y - a.planPosition.y;
  // Plan y grows downwards; angle clockwise from the plan's "up", then to true north.
  const fromUp = deg(Math.atan2(dx, -dy));
  const px = Math.hypot(dx, dy);
  return {
    bearingDeg: fromUp - plan.northDeg,
    distanceM: plan.pixelsPerMetre ? px / plan.pixelsPerMetre : undefined,
    px,
  };
}

export function suggestLinks(
  env: Environment,
  sceneId: string,
  options: SuggestOptions = {},
): LinkSuggestion[] {
  const { maxDistanceM = 30, limit = 4 } = options;
  const from = env.scenes.find((s) => s.id === sceneId);
  if (!from) return [];
  const linked = linkedScenes(env, sceneId);
  const candidates = env.scenes.filter((s) => s.id !== sceneId && !linked.has(s.id));
  // "+ 0" turns -0 into 0.
  const yawFor = (bearing: number) =>
    Math.round(wrapDeg(from.northOffsetDeg + bearing) * 10) / 10 + 0;

  const located: { rank: number; suggestion: LinkSuggestion }[] = [];
  for (const s of candidates) {
    const p = planVector(env, from, s);
    if (p) {
      if (p.distanceM !== undefined && p.distanceM > maxDistanceM) continue;
      located.push({
        // Uncalibrated plans rank by pixels, after calibrated ones.
        rank: p.distanceM ?? 1e6 + p.px,
        suggestion: {
          targetId: s.id,
          reason: 'plan',
          ...(p.distanceM !== undefined && { distanceM: Math.round(p.distanceM * 10) / 10 }),
          yaw: yawFor(p.bearingDeg),
          pitch: floorPitch(p.distanceM),
        },
      });
      continue;
    }
    if (from.gps && s.gps) {
      const g = geoVector(from.gps, s.gps);
      if (g.distanceM > maxDistanceM) continue;
      located.push({
        rank: g.distanceM + 0.5, // the plan wins a tie
        suggestion: {
          targetId: s.id,
          reason: 'gps',
          distanceM: Math.round(g.distanceM * 10) / 10,
          yaw: yawFor(g.bearingDeg),
          pitch: floorPitch(g.distanceM),
        },
      });
    }
  }
  located.sort((x, y) => x.rank - y.rank);
  const out = located.slice(0, limit).map((x) => x.suggestion);

  const order = options.order ?? env.scenes.map((s) => s.id);
  const i = order.indexOf(sceneId);
  if (i >= 0)
    for (const id of [order[i - 1], order[i + 1]])
      if (id && candidates.some((c) => c.id === id) && !out.some((o) => o.targetId === id))
        out.push({ targetId: id, reason: 'sequence', pitch: DEFAULT_PITCH });
  return out;
}
