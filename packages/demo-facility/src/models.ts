/**
 * Phase 9 demo content, generated like the panoramas (no binary assets in the repo):
 * a GLB model of a loading dock (coloured boxes, glTF 2.0 binary) and a Gaussian splat
 * capture of a mechanical room (surfaces sampled into flat splats, `.splat` format).
 * Coordinates: metres, Y up, −Z north. Equipment positions are exported for hotspots.
 */
type V3 = [number, number, number];
type RGB = [number, number, number];

interface Box {
  min: V3;
  max: V3;
}

/** Deterministic pseudo-random numbers (the demo renders the same every build). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ----------------------------------------------------------------------------- GLB

/** Six faces of a box with outward normals (24 vertices, 36 indices). */
function boxMesh(b: Box, base: number) {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const faces: [V3, V3[]][] = [
    [
      [1, 0, 0],
      [
        [x1, y0, z1],
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
      ],
    ],
    [
      [0, 1, 0],
      [
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
        [x0, y1, z0],
      ],
    ],
    [
      [0, -1, 0],
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
      ],
    ],
    [
      [0, 0, 1],
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
    ],
    [
      [0, 0, -1],
      [
        [x1, y0, z0],
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
      ],
    ],
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  faces.forEach(([n, quad], f) => {
    for (const v of quad) {
      pos.push(...v);
      nor.push(...n);
    }
    const o = base + f * 4;
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  return { pos, nor, idx };
}

/** A glTF 2.0 binary with one mesh per colour (boxes merged), unlit-friendly PBR. */
export function glb(groups: { name: string; color: RGB; boxes: Box[] }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const meshes: object[] = [];
  const materials: object[] = [];
  const nodes: object[] = [];
  const view = (data: Float32Array | Uint32Array, target: number) => {
    const bytes = new Uint8Array(data.buffer.slice(0));
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    chunks.push(bytes);
    offset += bytes.length;
    return bufferViews.length - 1;
  };
  for (const g of groups) {
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    for (const b of g.boxes) {
      const m = boxMesh(b, pos.length / 3);
      pos.push(...m.pos);
      nor.push(...m.nor);
      idx.push(...m.idx);
    }
    const min = [0, 1, 2].map((k) => Math.min(...pos.filter((_, i) => i % 3 === k)));
    const max = [0, 1, 2].map((k) => Math.max(...pos.filter((_, i) => i % 3 === k)));
    accessors.push(
      {
        bufferView: view(new Float32Array(pos), 34962),
        componentType: 5126,
        count: pos.length / 3,
        type: 'VEC3',
        min,
        max,
      },
      {
        bufferView: view(new Float32Array(nor), 34962),
        componentType: 5126,
        count: nor.length / 3,
        type: 'VEC3',
      },
      {
        bufferView: view(new Uint32Array(idx), 34963),
        componentType: 5125,
        count: idx.length,
        type: 'SCALAR',
      },
    );
    const a = accessors.length - 3;
    // Colours are sRGB; glTF base colour factors are linear.
    const lin = g.color.map((c) => (c / 255) ** 2.2);
    materials.push({
      name: g.name,
      pbrMetallicRoughness: {
        baseColorFactor: [...lin, 1],
        metallicFactor: 0,
        roughnessFactor: 0.85,
      },
    });
    meshes.push({
      name: g.name,
      primitives: [
        {
          attributes: { POSITION: a, NORMAL: a + 1 },
          indices: a + 2,
          material: materials.length - 1,
        },
      ],
    });
    nodes.push({ name: g.name, mesh: meshes.length - 1 });
  }
  const bin = new Uint8Array(Math.ceil(offset / 4) * 4);
  let at = 0;
  for (const c of chunks) {
    bin.set(c, at);
    at += c.length;
  }
  const json = {
    asset: { version: '2.0', generator: 'EVACTIS 3DWORKFLOW demo facility' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  let text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (text.length % 4)) % 4;
  text = new Uint8Array([...text, ...new Array(pad).fill(0x20)]);
  const total = 12 + 8 + text.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, text.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(text, 20);
  dv.setUint32(20 + text.length, bin.length, true);
  dv.setUint32(24 + text.length, 0x004e4942, true); // "BIN\0"
  out.set(bin, 28 + text.length);
  return out;
}

/** Loading dock: 10 m wide, 12 m deep, 4.5 m high; the viewer stands near the south wall. */
export const DOCK = {
  viewpoint: { x: 0, y: 1.6, z: 4 },
  /** Centre of each equipment item, model metres. */
  extinguisher: { x: -4.88, y: 0.75, z: -1 },
  exitSign: { x: 4.88, y: 2.55, z: -3 },
  firstAid: { x: -2, y: 1.45, z: -5.88 },
  /** Doorway to the corridor (east wall), and the walk to it. */
  door: { x: 4.95, y: 1.05, z: -3 },
  route: [
    { x: 0, y: 0.02, z: 3 },
    { x: 2.5, y: 0.02, z: 0 },
    { x: 4.6, y: 0.02, z: -3 },
  ],
} as const;

export function dockModel(): Uint8Array {
  const W = 5;
  const D = 6;
  const H = 4.5;
  const t = 0.1;
  const r = rng(7);
  const pallets: Box[] = [];
  for (const [x, z] of [
    [-3, -3.5],
    [-1.6, -3.5],
    [-3, -2.1],
    [1.5, 1.2],
  ] as const) {
    pallets.push({ min: [x - 0.6, 0, z - 0.5], max: [x + 0.6, 0.15, z + 0.5] });
    const hgt = 0.6 + r() * 0.8;
    pallets.push({ min: [x - 0.55, 0.15, z - 0.45], max: [x + 0.55, 0.15 + hgt, z + 0.45] });
  }
  return glb([
    { name: 'Floor', color: [150, 150, 146], boxes: [{ min: [-W, -t, -D], max: [W, 0, D] }] },
    {
      name: 'Walls',
      color: [214, 210, 200],
      boxes: [
        { min: [-W - t, 0, -D], max: [-W, H, D] }, // west
        { min: [-W, 0, D], max: [W, H, D + t] }, // south
        { min: [W, 0, -D], max: [W + t, H, -3.6] }, // east, either side of the door
        { min: [W, 0, -2.4], max: [W + t, H, D] },
        { min: [W, 2.2, -3.6], max: [W + t, H, -2.4] },
        // North wall either side of the roll-up door.
        { min: [-W, 0, -D - t], max: [-1.5, H, -D] },
        { min: [1.5, 0, -D - t], max: [W, H, -D] },
        { min: [-1.5, 3.4, -D - t], max: [1.5, H, -D] },
      ],
    },
    { name: 'Ceiling', color: [232, 232, 228], boxes: [{ min: [-W, H, -D], max: [W, H + t, D] }] },
    {
      name: 'Roll-up door',
      color: [96, 104, 112],
      boxes: [{ min: [-1.5, 0, -D - 0.05], max: [1.5, 3.4, -D] }],
    },
    {
      name: 'Door',
      color: [118, 86, 58],
      boxes: [{ min: [W + 0.02, 0, -3.5], max: [W + 0.06, 2.1, -2.5] }],
    },
    { name: 'Pallets and boxes', color: [176, 134, 88], boxes: pallets },
    {
      name: 'Racking',
      color: [226, 120, 30],
      boxes: [
        { min: [2.5, 0, 3.8], max: [4.6, 0.08, 5.6] },
        { min: [2.5, 1.2, 3.8], max: [4.6, 1.28, 5.6] },
        { min: [2.5, 2.4, 3.8], max: [4.6, 2.48, 5.6] },
        { min: [2.5, 0, 3.8], max: [2.6, 2.6, 3.9] },
        { min: [4.5, 0, 3.8], max: [4.6, 2.6, 3.9] },
      ],
    },
    {
      name: 'Fire extinguisher',
      color: [200, 16, 46],
      boxes: [{ min: [-W + 0.02, 0.48, -1.1], max: [-W + 0.24, 1.02, -0.9] }],
    },
    {
      name: 'Exit sign',
      color: [0, 132, 61],
      boxes: [{ min: [W - 0.06, 2.45, -3.3], max: [W, 2.65, -2.7] }],
    },
    {
      name: 'First aid kit',
      color: [0, 132, 61],
      boxes: [{ min: [-2.25, 1.25, -D + 0.02], max: [-1.75, 1.65, -D + 0.14] }],
    },
  ]);
}

// ----------------------------------------------------------------------------- splats

/** Mechanical room: 7 m × 7 m × 3.2 m, a boiler, pipes and a fire extinguisher. */
export const MECHANICAL = {
  viewpoint: { x: 0, y: 1.6, z: 2 },
  extinguisher: { x: 3.4, y: 0.75, z: -1.5 },
  boiler: { x: -1.5, y: 1.1, z: -2 },
  door: { x: -3.45, y: 1.05, z: 2 },
} as const;

/** One splat: centre, scale (metres), colour, opacity; axis-aligned (no rotation). */
type S = { p: V3; s: V3; c: RGB; a?: number };

function splatFile(splats: S[]): Uint8Array {
  const out = new Uint8Array(splats.length * 32);
  const dv = new DataView(out.buffer);
  splats.forEach((x, i) => {
    const o = i * 32;
    for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, x.p[k]!, true);
    for (let k = 0; k < 3; k++) dv.setFloat32(o + 12 + k * 4, x.s[k]!, true);
    out.set(
      [...x.c.map((v) => Math.max(0, Math.min(255, Math.round(v)))), Math.round((x.a ?? 1) * 255)],
      o + 24,
    );
    out.set([255, 128, 128, 128], o + 28); // identity rotation (w = 1)
  });
  return out;
}

export function mechanicalSplats(): Uint8Array {
  const r = rng(11);
  const W = 3.5;
  const H = 3.2;
  const step = 0.06;
  const s: S[] = [];
  const jitter = (c: RGB, k = 12): RGB => c.map((v) => v + (r() - 0.5) * k) as RGB;
  // A plane sampled on a grid; `flat` is the thin axis.
  const plane = (
    at: (u: number, v: number) => V3,
    u: [number, number],
    v: [number, number],
    flat: 0 | 1 | 2,
    color: (p: V3) => RGB,
  ) => {
    for (let a = u[0]; a <= u[1]; a += step)
      for (let b = v[0]; b <= v[1]; b += step) {
        const p = at(a + (r() - 0.5) * step * 0.6, b + (r() - 0.5) * step * 0.6);
        const sc: V3 = [step * 0.62, step * 0.62, step * 0.62];
        sc[flat] = 0.006;
        s.push({ p, s: sc, c: jitter(color(p)) });
      }
  };
  const concrete = (p: V3): RGB =>
    (Math.floor(p[0] / 1.2) + Math.floor(p[2] / 1.2)) & 1 ? [122, 124, 120] : [112, 114, 110];
  const wall = (p: V3): RGB => (p[1] < 0.15 ? [90, 92, 90] : [196, 198, 190]);
  plane((a, b) => [a, 0, b], [-W, W], [-W, W], 1, concrete);
  plane(
    (a, b) => [a, H, b],
    [-W, W],
    [-W, W],
    1,
    () => [226, 226, 222],
  );
  plane((a, b) => [a, b, -W], [-W, W], [0, H], 2, wall);
  plane((a, b) => [a, b, W], [-W, W], [0, H], 2, wall);
  plane((a, b) => [W, b, a], [-W, W], [0, H], 0, wall);
  plane(
    (a, b) => [-W, b, a],
    [-W, W],
    [0, H],
    0,
    (p) =>
      // A door in the west wall (to the corridor).
      Math.abs(p[2] - MECHANICAL.door.z) < 0.5 && p[1] < 2.1 ? [118, 86, 58] : wall(p),
  );
  // Boiler: a grey cylinder; pipes: blue runs along the ceiling.
  const cyl = (cx: number, cz: number, rad: number, y0: number, y1: number, c: RGB) => {
    for (let y = y0; y <= y1; y += step)
      for (let t = 0; t < Math.PI * 2; t += step / rad) {
        const p: V3 = [cx + Math.cos(t) * rad, y, cz + Math.sin(t) * rad];
        s.push({ p, s: [step * 0.6, step * 0.6, step * 0.6], c: jitter(c, 8) });
      }
  };
  cyl(MECHANICAL.boiler.x, MECHANICAL.boiler.z, 0.8, 0, 2.2, [150, 154, 158]);
  for (let x = -W; x <= W; x += step / 2)
    for (const [y, z] of [
      [2.8, -3.2],
      [2.6, -3.0],
    ] as const)
      s.push({ p: [x, y, z], s: [step * 0.5, 0.05, 0.05], c: jitter([40, 90, 170], 10) });
  // Fire extinguisher on the east wall: a red cylinder with a black top.
  const e = MECHANICAL.extinguisher;
  cyl(e.x - 0.1, e.z, 0.09, e.y - 0.27, e.y + 0.2, [200, 16, 46]);
  cyl(e.x - 0.1, e.z, 0.05, e.y + 0.2, e.y + 0.27, [30, 30, 30]);
  return splatFile(s);
}
