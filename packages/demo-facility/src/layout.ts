/**
 * Where each demo room sits in the building, so floor plans, equipment positions,
 * routes and headings all come from the same geometry as the panoramas.
 *
 * Building coordinates: metres, x east, z south (as in the rooms: -Z = north = yaw 0).
 * Each room's camera sits at its `origin`; room bounds in scenes.ts are relative to it.
 */
import { sceneSpec, type RoomSpec, type Wall } from './scenes.ts';

export const PX_PER_M = 40;
/** The plan frame (both floors share it, so plans line up when printed). */
export const FRAME = { xMin: -12, xMax: 20, zMin: -30, zMax: 26 };
export const PLAN_W = (FRAME.xMax - FRAME.xMin) * PX_PER_M;
export const PLAN_H = (FRAME.zMax - FRAME.zMin) * PX_PER_M;

export interface Placed {
  floor: 'f1' | 'f2';
  origin: [number, number];
}

export const ROOMS: Record<string, Placed> = {
  lobby: { floor: 'f1', origin: [0, 0] },
  corridor: { floor: 'f1', origin: [2, -8] },
  stairwell: { floor: 'f1', origin: [8, -1] },
  office: { floor: 'f2', origin: [8, -13] },
  electrical: { floor: 'f2', origin: [-2, -15] },
  // Outdoors, south of the main entrance; drawn on the ground-floor (site) plan.
  assembly: { floor: 'f1', origin: [0, 20] },
};

/** Plan pixels for a building point. */
export function plan(x: number, z: number): { x: number; y: number } {
  return { x: (x - FRAME.xMin) * PX_PER_M, y: (z - FRAME.zMin) * PX_PER_M };
}

export function roomOrigin(id: string): [number, number] {
  return ROOMS[id]!.origin;
}

/** Building point of a feature on a room wall (`at` along the wall, as in scenes.ts). */
export function wallPoint(id: string, wall: Wall, at: number): [number, number] {
  const r = sceneSpec(id) as RoomSpec;
  const [ox, oz] = roomOrigin(id);
  const { xMin, xMax, zMin, zMax } = r.bounds;
  switch (wall) {
    case 'n':
      return [ox + at, oz + zMin];
    case 's':
      return [ox + at, oz + zMax];
    case 'w':
      return [ox + xMin, oz + at];
    case 'e':
      return [ox + xMax, oz + at];
  }
}

/** Room rectangle in building coordinates. */
export function roomRect(id: string) {
  const r = sceneSpec(id) as RoomSpec;
  const [ox, oz] = roomOrigin(id);
  return {
    xMin: ox + r.bounds.xMin,
    xMax: ox + r.bounds.xMax,
    zMin: oz + r.bounds.zMin,
    zMax: oz + r.bounds.zMax,
  };
}

/** Yaw (degrees, 0 = north, clockwise) from a room's camera to a building point. */
export function yawTo(id: string, x: number, z: number): number {
  const [ox, oz] = roomOrigin(id);
  return Math.round(((Math.atan2(x - ox, -(z - oz)) * 180) / Math.PI) * 100) / 100;
}

/** Extra rooms drawn on the plans (no panorama): the second-floor stair landing. */
export const EXTRA_ROOMS: { floor: 'f1' | 'f2'; rect: ReturnType<typeof roomRect> }[] = [
  { floor: 'f2', rect: { xMin: 6.5, xMax: 9.5, zMin: -7, zMax: -4 } },
  { floor: 'f2', rect: { xMin: 6, xMax: 10.2, zMin: -4, zMax: 2 } },
];
