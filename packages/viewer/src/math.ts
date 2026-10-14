/**
 * Angle conventions shared by the Viewer, the tile generator and Studio:
 * yaw 0 = scene forward (centre of the equirectangular image), positive to the right;
 * pitch 0 = horizon, positive up. Camera looks down -Z, Y up, X right.
 */
export const DEG = Math.PI / 180;

export type Vec3 = [number, number, number];

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Wraps an angle to (-180, 180]. */
export function wrapYaw(yaw: number): number {
  let y = ((((yaw + 180) % 360) + 360) % 360) - 180;
  if (y === -180) y = 180;
  return y;
}

/** Unit direction for a yaw/pitch in degrees. */
export function direction(yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw * DEG);
  const sy = Math.sin(yaw * DEG);
  const cp = Math.cos(pitch * DEG);
  return [sy * cp, Math.sin(pitch * DEG), -cy * cp];
}

/** Yaw/pitch in degrees for a (not necessarily unit) direction. */
export function angles([x, y, z]: Vec3): { yaw: number; pitch: number } {
  const len = Math.hypot(x, y, z) || 1;
  return { yaw: Math.atan2(x, -z) / DEG, pitch: Math.asin(clamp(y / len, -1, 1)) / DEG };
}

/** Shortest signed difference b - a between two yaws, in (-180, 180]. */
export function yawDelta(a: number, b: number): number {
  return wrapYaw(b - a);
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
