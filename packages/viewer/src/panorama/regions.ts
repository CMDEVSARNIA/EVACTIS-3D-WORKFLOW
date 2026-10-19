import {
  BufferAttribute,
  BufferGeometry,
  LinearFilter,
  Mesh,
  SRGBColorSpace,
  ShapeUtils,
  Texture,
  Vector2,
  VideoTexture,
  type Object3D,
} from 'three';
import { direction } from '../math.ts';
import type { Grading } from './grading.ts';

export interface RegionSource {
  id: string;
  polygon: { yaw: number; pitch: number }[];
  /** A looping video, or an image for still regions. */
  element: HTMLVideoElement | HTMLImageElement;
}

/** Yaws made continuous around the first point, so a polygon may cross ±180°. */
function unwrap(points: { yaw: number; pitch: number }[]) {
  const first = points[0]!.yaw;
  return points.map((p) => {
    let y = p.yaw;
    while (y - first > 180) y -= 360;
    while (y - first < -180) y += 360;
    return { yaw: y, pitch: p.pitch };
  });
}

/**
 * The polygon's area on the panorama sphere: triangulated in yaw/pitch, each triangle
 * subdivided so the surface follows the sphere, with the source stretched over the
 * polygon's yaw/pitch bounds.
 */
export function regionGeometry(polygon: { yaw: number; pitch: number }[], radius = 4.8, seg = 6) {
  const pts = unwrap(polygon);
  const minY = Math.min(...pts.map((p) => p.yaw));
  const maxY = Math.max(...pts.map((p) => p.yaw));
  const minP = Math.min(...pts.map((p) => p.pitch));
  const maxP = Math.max(...pts.map((p) => p.pitch));
  const tris = ShapeUtils.triangulateShape(
    pts.map((p) => new Vector2(p.yaw, p.pitch)),
    [],
  );
  const pos: number[] = [];
  const uv: number[] = [];
  const vertex = (yaw: number, pitch: number) => {
    const d = direction(yaw, pitch);
    pos.push(d[0] * radius, d[1] * radius, d[2] * radius);
    uv.push((yaw - minY) / (maxY - minY || 1), (pitch - minP) / (maxP - minP || 1));
  };
  for (const tri of tris) {
    const [a, b, c] = tri.map((i) => pts[i]!) as [
      (typeof pts)[0],
      (typeof pts)[0],
      (typeof pts)[0],
    ];
    const at = (i: number, j: number) => {
      const s = i / seg;
      const t = j / seg;
      return {
        yaw: a.yaw + (b.yaw - a.yaw) * s + (c.yaw - a.yaw) * t,
        pitch: a.pitch + (b.pitch - a.pitch) * s + (c.pitch - a.pitch) * t,
      };
    };
    for (let i = 0; i < seg; i++)
      for (let j = 0; j < seg - i; j++) {
        for (const p of [at(i, j), at(i + 1, j), at(i, j + 1)]) vertex(p.yaw, p.pitch);
        if (j < seg - i - 1)
          for (const p of [at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]) vertex(p.yaw, p.pitch);
      }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  return g;
}

/** Animated regions of the current scene, drawn over the panorama. */
export class RegionLayer {
  private meshes = new Map<string, { mesh: Mesh; tex: Texture; el: RegionSource['element'] }>();

  constructor(
    private parent: Object3D,
    private grading: Grading,
  ) {}

  set(sources: RegionSource[]): void {
    this.clear();
    for (const s of sources) {
      const tex =
        s.element instanceof HTMLVideoElement
          ? new VideoTexture(s.element)
          : new Texture(s.element);
      tex.colorSpace = SRGBColorSpace;
      tex.minFilter = LinearFilter;
      tex.generateMipmaps = false;
      // Videos upload each frame as it arrives; images once they have loaded.
      if (s.element instanceof HTMLImageElement) {
        const img = s.element;
        if (img.complete) tex.needsUpdate = true;
        else img.addEventListener('load', () => (tex.needsUpdate = true), { once: true });
      }
      const mesh = new Mesh(regionGeometry(s.polygon), this.grading.material(tex));
      mesh.renderOrder = 100;
      mesh.name = `region:${s.id}`;
      this.parent.add(mesh);
      this.meshes.set(s.id, { mesh, tex, el: s.element });
    }
  }

  /** Videos that are playing (the renderer keeps drawing while any is). */
  get playing(): boolean {
    for (const { el } of this.meshes.values())
      if (el instanceof HTMLVideoElement && !el.paused && !el.ended) return true;
    return false;
  }

  get ids(): string[] {
    return [...this.meshes.keys()];
  }

  clear(): void {
    for (const { mesh, tex, el } of this.meshes.values()) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as { dispose(): void }).dispose();
      tex.dispose();
      if (el instanceof HTMLVideoElement) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
    }
    this.meshes.clear();
  }
}
