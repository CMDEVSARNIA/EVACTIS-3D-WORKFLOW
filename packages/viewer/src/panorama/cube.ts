import type { Vec3 } from '../math.ts';

/**
 * Cube-face layout for multi-resolution tiles. Each face sits at distance 1 from the
 * viewer; a point on a face is `forward + u·right + v·up` with u, v ∈ [-1, 1].
 * Image row 0 is the top of the face (v = +1). Shared by the renderer and every tile
 * generator (demo facility, Studio) so they can never disagree.
 *
 * Tile path: `${basePath}/${face}/${level}/${row}_${col}.${format}`.
 */
export type Face = 'f' | 'r' | 'b' | 'l' | 'u' | 'd';
export const FACES: Face[] = ['f', 'r', 'b', 'l', 'u', 'd'];

export interface FaceBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export const FACE_BASIS: Record<Face, FaceBasis> = {
  f: { forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0] },
  r: { forward: [1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  b: { forward: [0, 0, 1], right: [-1, 0, 0], up: [0, 1, 0] },
  l: { forward: [-1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  u: { forward: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  d: { forward: [0, -1, 0], right: [1, 0, 0], up: [0, 0, -1] },
};

/** Point on a face for face coordinates u (right) and v (up), both in [-1, 1]. */
export function facePoint(face: Face, u: number, v: number): Vec3 {
  const { forward: f, right: r, up: p } = FACE_BASIS[face];
  return [f[0] + u * r[0] + v * p[0], f[1] + u * r[1] + v * p[1], f[2] + u * r[2] + v * p[2]];
}

/** Direction through the centre of pixel (px, py) of a face rendered at `size` px. */
export function facePixelDirection(face: Face, size: number, px: number, py: number): Vec3 {
  return facePoint(face, (2 * (px + 0.5)) / size - 1, 1 - (2 * (py + 0.5)) / size);
}

export function tilePath(
  basePath: string,
  face: Face,
  level: number,
  row: number,
  col: number,
  format: string,
) {
  return `${basePath}/${face}/${level}/${row}_${col}.${format}`;
}
