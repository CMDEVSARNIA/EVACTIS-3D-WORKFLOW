/**
 * Draws the demo floor plans (PNG pixels) from the room geometry: rooms, walls with
 * door openings, stair treads and the lawn around the assembly point. Text (room
 * names) is not baked in: the Viewer and printed plans label rooms from the zones, in
 * the reader's language.
 */
import {
  EXTRA_ROOMS,
  FRAME,
  PLAN_H,
  PLAN_W,
  PX_PER_M,
  ROOMS,
  plan,
  roomRect,
  wallPoint,
} from './layout.ts';
import { SCENES, type RoomSpec } from './scenes.ts';

type RGB = [number, number, number];
const PAPER: RGB = [255, 255, 255];
const FLOOR: RGB = [241, 243, 246];
const WALL: RGB = [10, 47, 91];
const TREAD: RGB = [150, 160, 172];
const LAWN: RGB = [226, 238, 214];
const PATH: RGB = [214, 214, 208];
const WALL_M = 0.2;
const DOOR_HALF_M = 0.5;

export function drawPlan(floor: 'f1' | 'f2'): { width: number; height: number; rgba: Uint8Array } {
  const px = new Uint8Array(PLAN_W * PLAN_H * 4);
  const set = (x: number, y: number, c: RGB) => {
    if (x < 0 || y < 0 || x >= PLAN_W || y >= PLAN_H) return;
    const i = (y * PLAN_W + x) * 4;
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = 255;
  };
  /** Fills a building-coordinate rectangle. */
  const fill = (xMin: number, zMin: number, xMax: number, zMax: number, c: RGB) => {
    const a = plan(xMin, zMin);
    const b = plan(xMax, zMax);
    for (let y = Math.round(a.y); y < Math.round(b.y); y++)
      for (let x = Math.round(a.x); x < Math.round(b.x); x++) set(x, y, c);
  };
  fill(FRAME.xMin, FRAME.zMin, FRAME.xMax, FRAME.zMax, PAPER);

  if (floor === 'f1') {
    // Front lawn with the assembly point, and the walk from the main entrance.
    const [ax, az] = ROOMS.assembly!.origin;
    fill(ax - 9, az - 6, ax + 9, az + 5, LAWN);
    fill(-0.9, 4, 0.9, az - 1, PATH);
    // Path around the west side for the north exit.
    fill(-10.6, -27.6, 2.6, -26.4, PATH);
    fill(-10.6, -27.6, -9.4, az, PATH);
    fill(1.4, -27, 2.6, -24, PATH);
  }

  const rooms = SCENES.filter((s): s is RoomSpec => !s.outdoor && ROOMS[s.id]?.floor === floor).map(
    (s) => ({ id: s.id, rect: roomRect(s.id), spec: s as RoomSpec | null }),
  );
  const extra = EXTRA_ROOMS.filter((r) => r.floor === floor).map((r) => ({
    id: '',
    rect: r.rect,
    spec: null,
  }));
  // The stair shaft exists on both floors.
  if (floor === 'f2') extra.push({ id: '', rect: roomRect('stairwell'), spec: null });

  for (const { rect } of [...rooms, ...extra])
    fill(rect.xMin, rect.zMin, rect.xMax, rect.zMax, FLOOR);

  // Stair treads in the north half of stairwell A.
  const st = roomRect('stairwell');
  for (let z = st.zMin + 0.3; z < st.zMin + 3; z += 0.3)
    fill(st.xMin + 0.6, z, st.xMax - 0.6, z + 0.05, TREAD);

  for (const { rect } of [...rooms, ...extra]) {
    const w = WALL_M / 2;
    fill(rect.xMin - w, rect.zMin - w, rect.xMax + w, rect.zMin + w, WALL);
    fill(rect.xMin - w, rect.zMax - w, rect.xMax + w, rect.zMax + w, WALL);
    fill(rect.xMin - w, rect.zMin - w, rect.xMin + w, rect.zMax + w, WALL);
    fill(rect.xMax - w, rect.zMin - w, rect.xMax + w, rect.zMax + w, WALL);
  }
  // Door openings: clear the wall, then draw the jambs.
  for (const { id, spec } of rooms) {
    for (const f of spec!.features) {
      if (f.kind !== 'door' && f.kind !== 'opening') continue;
      const [x, z] = wallPoint(id, f.wall, f.at);
      const along = f.wall === 'n' || f.wall === 's';
      const w = WALL_M;
      if (along) fill(x - DOOR_HALF_M, z - w, x + DOOR_HALF_M, z + w, FLOOR);
      else fill(x - w, z - DOOR_HALF_M, x + w, z + DOOR_HALF_M, FLOOR);
    }
  }
  // Openings between the second-floor landing, the stair and the office.
  if (floor === 'f2') {
    fill(7.5, -7.2, 8.5, -6.8, FLOOR);
    fill(7.2, -4.2, 8.8, -3.8, FLOOR);
  }
  return { width: PLAN_W, height: PLAN_H, rgba: px };
}

export const PLAN_PX_PER_M = PX_PER_M;
