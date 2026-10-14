/**
 * Procedural demo facility ("Evactis Demo Centre"): each scene is a simple box room (or
 * an outdoor area) ray-cast per pixel, so panoramas are deterministic, need no image
 * files in the repository, and every feature's direction is known exactly for placing
 * hotspots. Coordinates: metres, camera at the origin 1.6 m above the floor, -Z = north
 * = yaw 0, +X = east = yaw 90.
 */
export type Wall = 'n' | 'e' | 's' | 'w';
export type RGB = [number, number, number];

export interface Feature {
  kind:
    | 'door'
    | 'opening'
    | 'window'
    | 'extinguisher'
    | 'aed'
    | 'first-aid'
    | 'alarm'
    | 'panel'
    | 'hazard';
  wall: Wall;
  /** Position along the wall (x for n/s walls, z for e/w walls), metres. */
  at: number;
  /** Door/opening: show a green running-exit sign above it. */
  exit?: boolean;
}

export interface RoomSpec {
  id: string;
  outdoor?: false;
  bounds: { xMin: number; xMax: number; zMin: number; zMax: number };
  height: number;
  wall: RGB;
  floor: [RGB, RGB];
  features: Feature[];
}

export interface OutdoorSpec {
  id: string;
  outdoor: true;
  /** Yaw (degrees) of the assembly-point sign post. */
  signYaw: number;
}

export type SceneSpec = RoomSpec | OutdoorSpec;

const EYE = 1.6;

export const SCENES: SceneSpec[] = [
  {
    id: 'lobby',
    bounds: { xMin: -6, xMax: 6, zMin: -5, zMax: 4 },
    height: 3.2,
    wall: [214, 208, 196],
    floor: [
      [180, 176, 168],
      [150, 146, 140],
    ],
    features: [
      { kind: 'door', wall: 'n', at: 2, exit: false },
      { kind: 'door', wall: 'e', at: -1 },
      { kind: 'door', wall: 's', at: 0, exit: true },
      { kind: 'window', wall: 's', at: -3.5 },
      { kind: 'window', wall: 's', at: 3.5 },
      { kind: 'extinguisher', wall: 'w', at: -1.5 },
      { kind: 'aed', wall: 'w', at: 1 },
      { kind: 'alarm', wall: 'n', at: 3.2 },
    ],
  },
  {
    id: 'corridor',
    bounds: { xMin: -1.3, xMax: 1.3, zMin: -16, zMax: 3 },
    height: 2.8,
    wall: [196, 210, 220],
    floor: [
      [120, 128, 136],
      [104, 112, 120],
    ],
    features: [
      { kind: 'door', wall: 's', at: 0 },
      { kind: 'door', wall: 'n', at: 0, exit: true },
      { kind: 'extinguisher', wall: 'e', at: -6 },
      { kind: 'alarm', wall: 'w', at: -6.5 },
      { kind: 'door', wall: 'w', at: -10 },
    ],
  },
  {
    id: 'stairwell',
    bounds: { xMin: -2, xMax: 2.2, zMin: -3, zMax: 3 },
    height: 3.4,
    wall: [222, 222, 214],
    floor: [
      [96, 96, 96],
      [84, 84, 84],
    ],
    features: [
      { kind: 'door', wall: 'w', at: 0 },
      { kind: 'opening', wall: 'n', at: 0 },
      { kind: 'hazard', wall: 'e', at: 1 },
      { kind: 'extinguisher', wall: 's', at: 1.2 },
    ],
  },
  {
    id: 'office',
    bounds: { xMin: -8, xMax: 8, zMin: -6, zMax: 6 },
    height: 3,
    wall: [232, 230, 224],
    floor: [
      [92, 110, 128],
      [84, 100, 118],
    ],
    features: [
      { kind: 'window', wall: 'e', at: -3 },
      { kind: 'window', wall: 'e', at: 0 },
      { kind: 'window', wall: 'e', at: 3 },
      { kind: 'door', wall: 's', at: 0, exit: true },
      { kind: 'door', wall: 'w', at: -2 },
      { kind: 'first-aid', wall: 'n', at: -2 },
      { kind: 'extinguisher', wall: 'n', at: 2 },
      { kind: 'alarm', wall: 'w', at: 2 },
    ],
  },
  {
    id: 'electrical',
    bounds: { xMin: -2, xMax: 2, zMin: -2.2, zMax: 2 },
    height: 2.8,
    wall: [170, 172, 168],
    floor: [
      [110, 110, 104],
      [100, 100, 96],
    ],
    features: [
      { kind: 'panel', wall: 'n', at: 0 },
      { kind: 'hazard', wall: 'n', at: 1.4 },
      { kind: 'door', wall: 'e', at: 0 },
      { kind: 'extinguisher', wall: 'w', at: 0.5 },
    ],
  },
  { id: 'assembly', outdoor: true, signYaw: 20 },
];

// ----------------------------------------------------------------------------- geometry

type V3 = [number, number, number];

/** World position of a feature's centre (used for hotspots). */
export function featurePoint(room: RoomSpec, f: Feature): V3 {
  const { xMin, xMax, zMin, zMax } = room.bounds;
  const y = featureCentreY(f.kind);
  switch (f.wall) {
    case 'n':
      return [f.at, y, zMin];
    case 's':
      return [f.at, y, zMax];
    case 'w':
      return [xMin, y, f.at];
    case 'e':
      return [xMax, y, f.at];
  }
}

/** Height (relative to the eye) of each feature's centre. */
function featureCentreY(kind: Feature['kind']): number {
  switch (kind) {
    case 'door':
    case 'opening':
      return -EYE + 1.05;
    case 'window':
      return -EYE + 1.6;
    case 'extinguisher':
      return -EYE + 0.75;
    case 'aed':
    case 'first-aid':
      return -EYE + 1.4;
    case 'alarm':
      return -EYE + 1.25;
    case 'panel':
      return -EYE + 1.3;
    case 'hazard':
      return -EYE + 1.75;
  }
}

/** Half extents (along, up) of each feature on its wall. */
function featureSize(kind: Feature['kind']): [number, number] {
  switch (kind) {
    case 'door':
    case 'opening':
      return [0.5, 1.05];
    case 'window':
      return [1.1, 0.6];
    case 'extinguisher':
      return [0.11, 0.27];
    case 'aed':
    case 'first-aid':
      return [0.22, 0.2];
    case 'alarm':
      return [0.08, 0.1];
    case 'panel':
      return [0.6, 0.8];
    case 'hazard':
      return [0.18, 0.16];
  }
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

const GREEN: RGB = [0, 132, 61];
const RED: RGB = [200, 16, 46];
const YELLOW: RGB = [242, 194, 48];
const WHITE: RGB = [250, 250, 250];

/** Colour of a feature at local wall coordinates (du, dv from the feature centre). */
function featureColor(f: Feature, du: number, dv: number, wall: RGB): RGB | null {
  const [hu, hv] = featureSize(f.kind);
  const inside = Math.abs(du) <= hu && Math.abs(dv) <= hv;
  // Exit sign above doors and openings.
  if ((f.kind === 'door' || f.kind === 'opening') && f.exit) {
    const sv = dv - (hv + 0.32);
    if (Math.abs(du) < 0.28 && Math.abs(sv) < 0.12) {
      const glyph = Math.abs(du + 0.04) < 0.13 && Math.abs(sv) < 0.05;
      return glyph ? WHITE : GREEN;
    }
  }
  if (!inside) return null;
  switch (f.kind) {
    case 'door': {
      const frame = hu - Math.abs(du) < 0.06 || hv - dv < 0.06;
      if (frame) return [70, 72, 76];
      const handle = Math.abs(du - (hu - 0.15)) < 0.04 && Math.abs(dv) < 0.03;
      return handle ? [200, 200, 205] : [118, 86, 58];
    }
    case 'opening':
      return [26, 28, 30];
    case 'window': {
      const mullion = Math.abs(du) < 0.03 || hu - Math.abs(du) < 0.05 || hv - Math.abs(dv) < 0.05;
      return mullion
        ? [210, 214, 218]
        : mix([200, 225, 245], [250, 252, 255], (dv + hv) / (2 * hv));
    }
    case 'extinguisher':
      return Math.abs(du) < 0.05 && dv > hv - 0.06 ? [30, 30, 30] : RED;
    case 'aed':
      return Math.hypot(du, dv) < 0.09 ? WHITE : GREEN;
    case 'first-aid': {
      const cross =
        (Math.abs(du) < 0.03 && Math.abs(dv) < 0.1) || (Math.abs(dv) < 0.03 && Math.abs(du) < 0.1);
      return cross ? WHITE : GREEN;
    }
    case 'alarm':
      return Math.hypot(du, dv) < 0.04 ? WHITE : RED;
    case 'panel': {
      const line = Math.abs((du + hu) % 0.3) < 0.01 || hv - Math.abs(dv) < 0.03;
      return line ? [90, 92, 96] : mix([150, 154, 158], [126, 130, 134], (dv + hv) / (2 * hv));
    }
    case 'hazard': {
      const tri = dv > -hv && Math.abs(du) < (hv - dv) * 0.6;
      if (!tri) return wall;
      const edge = Math.abs(du) > (hv - dv) * 0.6 - 0.025 || dv < -hv + 0.025;
      return edge ? [26, 26, 26] : Math.abs(du) < 0.015 && dv > -0.08 ? [26, 26, 26] : YELLOW;
    }
  }
}

function shadeRoom(room: RoomSpec, d: V3): RGB {
  const { xMin, xMax, zMin, zMax } = room.bounds;
  const floorY = -EYE;
  const ceilY = room.height - EYE;
  let t = Infinity;
  let surface: 'floor' | 'ceil' | Wall = 'floor';
  const test = (tt: number, s: typeof surface) => {
    if (tt > 0 && tt < t) {
      t = tt;
      surface = s;
    }
  };
  if (d[1] < 0) test(floorY / d[1], 'floor');
  if (d[1] > 0) test(ceilY / d[1], 'ceil');
  if (d[2] < 0) test(zMin / d[2], 'n');
  if (d[2] > 0) test(zMax / d[2], 's');
  if (d[0] < 0) test(xMin / d[0], 'w');
  if (d[0] > 0) test(xMax / d[0], 'e');
  const p: V3 = [d[0] * t, d[1] * t, d[2] * t];
  let c: RGB;
  let edge: number;
  if (surface === 'floor') {
    const tile = (Math.floor(p[0] / 0.6) + Math.floor(p[2] / 0.6)) & 1;
    c = room.floor[tile]!;
    const grout = Math.min(
      Math.abs(p[0] / 0.6 - Math.round(p[0] / 0.6)),
      Math.abs(p[2] / 0.6 - Math.round(p[2] / 0.6)),
    );
    if (grout < 0.02) c = scale(c, 0.85);
    edge = Math.min(p[0] - xMin, xMax - p[0], p[2] - zMin, zMax - p[2]);
  } else if (surface === 'ceil') {
    const lx = ((p[0] % 2.4) + 2.4) % 2.4;
    const lz = ((p[2] % 2.4) + 2.4) % 2.4;
    const light = lx > 0.6 && lx < 1.8 && lz > 0.9 && lz < 1.5;
    c = light ? [255, 253, 244] : [236, 236, 232];
    edge = Math.min(p[0] - xMin, xMax - p[0], p[2] - zMin, zMax - p[2]);
    if (light) return c;
  } else {
    const along = surface === 'n' || surface === 's' ? p[0] : p[2];
    const height = p[1] - floorY;
    c = height < 0.12 ? scale(room.wall, 0.55) : room.wall;
    for (const f of room.features) {
      if (f.wall !== surface) continue;
      const centre = featurePoint(room, f);
      const fa = surface === 'n' || surface === 's' ? centre[0] : centre[2];
      const fc = featureColor(f, along - fa, p[1] - centre[1], c);
      if (fc) {
        c = fc;
        break;
      }
    }
    const [a0, a1] = surface === 'n' || surface === 's' ? [xMin, xMax] : [zMin, zMax];
    edge = Math.min(along - a0, a1 - along, height, ceilY - p[1]);
  }
  const ao = 0.72 + 0.28 * smooth(0, 0.6, edge);
  const fall = 1 / (1 + 0.004 * t * t);
  return scale(c, ao * (0.55 + 0.45 * fall));
}

function shadeOutdoor(d: V3): RGB {
  if (d[1] >= 0) {
    const sky = mix([196, 220, 240], [88, 140, 200], Math.min(1, d[1] * 1.6));
    return sky;
  }
  const t = -EYE / d[1];
  const p: V3 = [d[0] * t, d[1] * t, d[2] * t];
  const asphalt = Math.abs(p[0] - p[2] * 0.2) < 3;
  const base: RGB = asphalt
    ? [92, 94, 98]
    : (Math.floor(p[0] * 2) + Math.floor(p[2] * 2)) & 1
      ? [92, 140, 70]
      : [86, 132, 64];
  const fade = Math.min(1, t / 80);
  return mix(base, [190, 210, 228], fade * 0.7);
}

/** Sign post drawn as a billboard over the outdoor scene. */
function outdoorOverlay(spec: OutdoorSpec, d: V3): RGB | null {
  const yaw = (Math.atan2(d[0], -d[2]) * 180) / Math.PI;
  const pitch = (Math.asin(d[1]) * 180) / Math.PI;
  const dy = ((yaw - spec.signYaw + 540) % 360) - 180;
  if (Math.abs(dy) < 0.35 && pitch < 2 && pitch > -7.5) return [120, 124, 130];
  if (Math.abs(dy) < 3.2 && pitch >= 2 && pitch < 8.5) {
    const glyph = Math.hypot(dy, pitch - 5.25) < 0.8;
    const arrows =
      Math.abs(Math.abs(dy) - Math.abs(pitch - 5.25)) < 0.25 && Math.hypot(dy, pitch - 5.25) < 2.6;
    return glyph || arrows ? WHITE : GREEN;
  }
  return null;
}

/** Colour seen in direction `d` (unit vector) for a scene. */
export function shade(spec: SceneSpec, d: V3): RGB {
  if (spec.outdoor) return outdoorOverlay(spec, d) ?? shadeOutdoor(d);
  return shadeRoom(spec, d);
}

/** Yaw/pitch of a world point seen from the camera. */
export function anglesOf(p: V3): { yaw: number; pitch: number } {
  const yaw = (Math.atan2(p[0], -p[2]) * 180) / Math.PI;
  const pitch = (Math.asin(p[1] / Math.hypot(...p)) * 180) / Math.PI;
  return { yaw: Math.round(yaw * 100) / 100, pitch: Math.round(pitch * 100) / 100 };
}

export function sceneSpec(id: string): SceneSpec {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`No scene spec ${id}`);
  return s;
}

/** Direction (yaw/pitch) of the n-th feature of a kind on a wall, for hotspot placement. */
export function featureAngles(sceneId: string, kind: Feature['kind'], wall: Wall, at?: number) {
  const s = sceneSpec(sceneId);
  if (s.outdoor) throw new Error('Outdoor scenes have no wall features');
  const f = s.features.find(
    (x) => x.kind === kind && x.wall === wall && (at === undefined || x.at === at),
  );
  if (!f) throw new Error(`No ${kind} on wall ${wall} in ${sceneId}`);
  return anglesOf(featurePoint(s, f));
}
