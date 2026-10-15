import type { Vec3 } from '../math.ts';
import layout from './cube-basis.json' with { type: 'json' };

/**
 * Cube-face layout for multi-resolution tiles. Each face sits at distance 1 from the
 * viewer; a point on a face is `forward + u·right + v·up` with u, v ∈ [-1, 1].
 * Image row 0 is the top of the face (v = +1). The layout lives in cube-basis.json so
 * the renderer and every tile generator (demo facility, Studio's Rust tiler) share it.
 *
 * Tile path: `${basePath}/${face}/${level}/${row}_${col}.${format}`.
 */
export type Face = 'f' | 'r' | 'b' | 'l' | 'u' | 'd';
export const FACES = layout.faces as Face[];

export interface FaceBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

/** Loaded from cube-basis.json, which the Rust tiler (evx-media) reads too. */
export const FACE_BASIS = layout.basis as Record<Face, FaceBasis>;

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
