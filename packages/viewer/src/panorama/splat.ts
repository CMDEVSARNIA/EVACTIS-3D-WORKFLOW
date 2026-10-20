/**
 * Gaussian splat scenes (Phase 9), loaded on demand. Our own small renderer rather than
 * a library: the maintained three.js splat libraries sort on a worker started from a
 * blob/data URL and use WebAssembly, which the Viewer's strict CSP (script-src 'self',
 * no wasm-unsafe-eval) forbids (ADR 0016). Here the sort runs on the main thread, only
 * when the view turns: a counting sort on 16-bit depth keys, O(n).
 *
 * Splats are drawn as camera-facing quads sized from each splat's projected 3D
 * covariance (the standard EWA approach), alpha-blended back to front. Formats: the
 * common 32-byte `.splat` and binary 3DGS `.ply` (degree-0 colour). Model units are
 * metres, Y up (`upAxis: '-y'` flips captures trained Y-down).
 */
import type { Raycaster } from 'three';
import {
  BufferAttribute,
  DataTexture,
  DoubleSide,
  FloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NearestFilter,
  NormalBlending,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  type PerspectiveCamera,
} from 'three';
import type { SceneMedia } from '@evactis-3dworkflow/schema';
import type { AssetResolver } from '../assets.ts';
import type { Content } from './renderer.ts';

type Splat = Extract<SceneMedia, { type: 'splat' }>;

/** Splats as flat arrays: centre (3), covariance upper triangle (6), colour RGBA (0–1). */
export interface SplatData {
  count: number;
  centers: Float32Array;
  covariances: Float32Array;
  colors: Float32Array;
}

/** Σ = R S Sᵀ Rᵀ from scale (sx, sy, sz) and a unit quaternion (w, x, y, z). */
function covariance(out: Float32Array, o: number, s: number[], q: number[]) {
  let [w, x, y, z] = q as [number, number, number, number];
  const n = Math.hypot(w, x, y, z) || 1;
  w /= n;
  x /= n;
  y /= n;
  z /= n;
  const R = [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
  // M = R S; Σ = M Mᵀ.
  const M = R.map((r, i) => r * s[i % 3]!);
  const row = (i: number) => [M[i * 3]!, M[i * 3 + 1]!, M[i * 3 + 2]!];
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const [r0, r1, r2] = [row(0), row(1), row(2)];
  out[o] = dot(r0, r0);
  out[o + 1] = dot(r0, r1);
  out[o + 2] = dot(r0, r2);
  out[o + 3] = dot(r1, r1);
  out[o + 4] = dot(r1, r2);
  out[o + 5] = dot(r2, r2);
}

function alloc(count: number): SplatData {
  return {
    count,
    centers: new Float32Array(count * 3),
    covariances: new Float32Array(count * 6),
    colors: new Float32Array(count * 4),
  };
}

/** The 32-byte `.splat` layout: position f32×3, scale f32×3, RGBA u8×4, rotation u8×4 (w x y z). */
export function parseSplat(buf: ArrayBuffer): SplatData {
  const count = Math.floor(buf.byteLength / 32);
  const f = new Float32Array(buf, 0, count * 8);
  const u = new Uint8Array(buf);
  const d = alloc(count);
  for (let i = 0; i < count; i++) {
    d.centers.set([f[i * 8]!, f[i * 8 + 1]!, f[i * 8 + 2]!], i * 3);
    const q = [0, 1, 2, 3].map((k) => (u[i * 32 + 28 + k]! - 128) / 128);
    covariance(d.covariances, i * 6, [f[i * 8 + 3]!, f[i * 8 + 4]!, f[i * 8 + 5]!], q);
    for (let k = 0; k < 4; k++) d.colors[i * 4 + k] = u[i * 32 + 24 + k]! / 255;
  }
  return d;
}

const SH_C0 = 0.28209479177387814;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Binary little-endian 3DGS `.ply` (x y z, f_dc_0..2, opacity, scale_0..2, rot_0..3). */
export function parsePly(buf: ArrayBuffer): SplatData {
  const bytes = new Uint8Array(buf);
  const headEnd = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const end = headEnd.indexOf('end_header\n');
  if (!headEnd.startsWith('ply') || end < 0) throw new Error('Not a PLY file');
  const header = headEnd.slice(0, end);
  if (!/format binary_little_endian 1\.0/.test(header))
    throw new Error('Only binary little-endian PLY splats are supported');
  const count = Number(/element vertex (\d+)/.exec(header)?.[1] ?? 0);
  const SIZES: Record<string, number> = {
    float: 4,
    double: 8,
    uchar: 1,
    char: 1,
    int: 4,
    uint: 4,
    short: 2,
    ushort: 2,
  };
  const props: { name: string; type: string; offset: number }[] = [];
  let stride = 0;
  const vertexBlock = header.slice(header.indexOf('element vertex')).split('\n');
  for (const line of vertexBlock.slice(1)) {
    if (line.startsWith('element')) break;
    const m = /^property (\w+) (\w+)/.exec(line);
    if (!m) continue;
    props.push({ type: m[1]!, name: m[2]!, offset: stride });
    stride += SIZES[m[1]!] ?? 4;
  }
  const at = (name: string) => props.find((p) => p.name === name);
  for (const need of ['x', 'y', 'z', 'scale_0', 'rot_0', 'opacity', 'f_dc_0'])
    if (!at(need)) throw new Error(`This PLY has no "${need}": not a Gaussian splat file`);
  const dv = new DataView(buf, end + 'end_header\n'.length);
  const read = (i: number, name: string) => {
    const p = at(name)!;
    const o = i * stride + p.offset;
    return p.type === 'double' ? dv.getFloat64(o, true) : dv.getFloat32(o, true);
  };
  const d = alloc(count);
  for (let i = 0; i < count; i++) {
    d.centers.set([read(i, 'x'), read(i, 'y'), read(i, 'z')], i * 3);
    const s = [0, 1, 2].map((k) => Math.exp(read(i, `scale_${k}`)));
    const q = [0, 1, 2, 3].map((k) => read(i, `rot_${k}`));
    covariance(d.covariances, i * 6, s, q);
    for (let k = 0; k < 3; k++)
      d.colors[i * 4 + k] = Math.min(1, Math.max(0, 0.5 + SH_C0 * read(i, `f_dc_${k}`)));
    d.colors[i * 4 + 3] = sigmoid(read(i, 'opacity'));
  }
  return d;
}

const VERTEX = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D data;
uniform int texWidth;
uniform vec2 viewport;
uniform vec2 focal;
attribute float splatIndex;
varying vec4 vColor;
varying vec2 vPos;

vec4 texel(int i) {
  return texelFetch(data, ivec2(i % texWidth, i / texWidth), 0);
}

void main() {
  int base = int(splatIndex) * 4;
  vec4 t0 = texel(base);      // centre, alpha
  vec4 t1 = texel(base + 1);  // cov xx xy xz, r
  vec4 t2 = texel(base + 2);  // cov yy yz zz, g
  vec4 t3 = texel(base + 3);  // b
  vec4 cam = modelViewMatrix * vec4(t0.xyz, 1.0);
  vec4 clip = projectionMatrix * cam;
  float clipBound = 1.2 * clip.w;
  if (clip.w <= 0.0 || clip.z < -clip.w || abs(clip.x) > clipBound || abs(clip.y) > clipBound) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  mat3 Vrk = mat3(t1.x, t1.y, t1.z, t1.y, t2.x, t2.y, t1.z, t2.y, t2.z);
  float z = cam.z;
  mat3 J = mat3(
    focal.x / z, 0.0, -(focal.x * cam.x) / (z * z),
    0.0, focal.y / z, -(focal.y * cam.y) / (z * z),
    0.0, 0.0, 0.0
  );
  mat3 W = transpose(mat3(modelViewMatrix));
  mat3 T = W * J;
  mat3 cov2d = transpose(T) * Vrk * T;
  float a = cov2d[0][0] + 0.3;
  float b = cov2d[0][1];
  float c = cov2d[1][1] + 0.3;
  float mid = 0.5 * (a + c);
  float radius = length(vec2(0.5 * (a - c), b));
  float l1 = mid + radius;
  float l2 = max(mid - radius, 0.1);
  vec2 dir = normalize(vec2(b, l1 - a));
  if (abs(b) < 1e-6) dir = a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 major = min(sqrt(2.0 * l1), 1024.0) * dir;
  vec2 minor = min(sqrt(2.0 * l2), 1024.0) * vec2(dir.y, -dir.x);
  vColor = vec4(t1.w, t2.w, t3.x, t0.w);
  vPos = position.xy;
  vec2 ndc = clip.xy / clip.w;
  gl_Position = vec4(
    ndc + position.x * major / viewport * 2.0 + position.y * minor / viewport * 2.0,
    clip.z / clip.w,
    1.0
  );
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec4 vColor;
varying vec2 vPos;
void main() {
  float A = -dot(vPos, vPos);
  if (A < -4.0) discard;
  float alpha = exp(A) * vColor.a;
  if (alpha < 1.0 / 255.0) discard;
  gl_FragColor = vec4(vColor.rgb, alpha);
}
`;

const TEX_WIDTH = 4096;

export class SplatContent implements Content {
  readonly group = new Scene();
  readonly video = null;
  readonly depth = { near: 0.05, far: 500 };
  private data: SplatData | null = null;
  private mesh: Mesh | null = null;
  private material: ShaderMaterial | null = null;
  private texture: DataTexture | null = null;
  private order: Float32Array | null = null;
  private lastForward = new Vector3(0, 0, 0);
  private abort = new AbortController();
  private loading = 1;

  constructor(
    private media: Splat,
    private resolve: AssetResolver,
    private onChange: () => void,
  ) {}

  get pending(): number {
    return this.loading;
  }

  /** Splats in this scene (for tests). */
  get count(): number {
    return this.data?.count ?? 0;
  }

  async load(): Promise<void> {
    const url = this.resolve(this.media.source);
    const res = await fetch(url, { signal: this.abort.signal });
    if (!res.ok) throw new Error(`The splat scene could not be loaded: ${this.media.source}`);
    const buf = await res.arrayBuffer();
    const f = this.media.format;
    if (f !== 'splat' && f !== 'ply')
      throw new Error(`Splat format ".${f}" is not supported yet: convert to .ply or .splat`);
    const d = f === 'ply' ? parsePly(buf) : parseSplat(buf);
    this.data = d;
    // Four RGBA float texels per splat: centre+alpha, cov xx xy xz+r, cov yy yz zz+g, b.
    const height = Math.max(1, Math.ceil((d.count * 4) / TEX_WIDTH));
    const tex = new Float32Array(TEX_WIDTH * height * 4);
    for (let i = 0; i < d.count; i++) {
      const o = i * 16;
      tex.set(
        [d.centers[i * 3]!, d.centers[i * 3 + 1]!, d.centers[i * 3 + 2]!, d.colors[i * 4 + 3]!],
        o,
      );
      tex.set(
        [
          d.covariances[i * 6]!,
          d.covariances[i * 6 + 1]!,
          d.covariances[i * 6 + 2]!,
          d.colors[i * 4]!,
        ],
        o + 4,
      );
      tex.set(
        [
          d.covariances[i * 6 + 3]!,
          d.covariances[i * 6 + 4]!,
          d.covariances[i * 6 + 5]!,
          d.colors[i * 4 + 1]!,
        ],
        o + 8,
      );
      tex[o + 12] = d.colors[i * 4 + 2]!;
    }
    this.texture = new DataTexture(tex, TEX_WIDTH, height, RGBAFormat, FloatType);
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.needsUpdate = true;

    const geo = new InstancedBufferGeometry();
    geo.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0]), 3),
    );
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.order = new Float32Array(d.count);
    for (let i = 0; i < d.count; i++) this.order[i] = i;
    geo.setAttribute('splatIndex', new InstancedBufferAttribute(this.order, 1));
    geo.instanceCount = d.count;
    this.material = new ShaderMaterial({
      uniforms: {
        data: { value: this.texture },
        texWidth: { value: TEX_WIDTH },
        viewport: { value: new Vector2(1, 1) },
        focal: { value: new Vector2(1, 1) },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      blending: NormalBlending,
      // The (major, minor) axes can mirror a quad: never cull either winding.
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    // Sizes come from the camera actually drawing (each eye in VR has its own).
    const vp = new Vector4();
    const material = this.material;
    this.mesh.onBeforeRender = (renderer, _scene, cam) => {
      renderer.getCurrentViewport(vp);
      const m = cam.projectionMatrix.elements;
      material.uniforms.viewport!.value.set(vp.z, vp.w);
      material.uniforms.focal!.value.set((m[0]! * vp.z) / 2, (m[5]! * vp.w) / 2);
    };
    if (this.media.upAxis === '-y') this.mesh.rotation.x = Math.PI;
    this.group.add(this.mesh);
    this.loading = 0;
  }

  /** Re-sorts back to front when the view direction has turned (≈ 1.5°). */
  update(camera: PerspectiveCamera): void {
    const d = this.data;
    const mesh = this.mesh;
    if (!d || !mesh || !this.order) return;
    const forward = new Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
    if (forward.dot(this.lastForward) > 0.99966) return;
    this.lastForward.copy(forward);
    // Depth along the view direction in the model's frame (the camera sits at the
    // viewpoint, which is the model-space origin offset of the group).
    mesh.updateMatrixWorld();
    const inv = mesh.matrixWorld.clone().invert();
    const eye = new Vector3().applyMatrix4(inv);
    const dir = forward.clone().transformDirection(inv);
    const n = d.count;
    const keys = new Float32Array(n);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const k =
        (d.centers[i * 3]! - eye.x) * dir.x +
        (d.centers[i * 3 + 1]! - eye.y) * dir.y +
        (d.centers[i * 3 + 2]! - eye.z) * dir.z;
      keys[i] = k;
      if (k < min) min = k;
      if (k > max) max = k;
    }
    // Counting sort on 16-bit keys, farthest first.
    const BUCKETS = 65536;
    const scale = (BUCKETS - 1) / (max - min || 1);
    const counts = new Uint32Array(BUCKETS);
    const bucket = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const b = BUCKETS - 1 - Math.floor((keys[i]! - min) * scale);
      bucket[i] = b;
      counts[b]!++;
    }
    for (let b = 1; b < BUCKETS; b++) counts[b]! += counts[b - 1]!;
    for (let i = n - 1; i >= 0; i--) this.order[--counts[bucket[i]!]!] = i;
    (mesh.geometry.getAttribute('splatIndex') as BufferAttribute).needsUpdate = true;
    this.onChange();
  }

  /** The splat nearest the ray among those close to it (authoring clicks). */
  pick(ray: Raycaster): Vector3 | null {
    const d = this.data;
    if (!d || !this.mesh) return null;
    this.mesh.updateMatrixWorld();
    const p = new Vector3();
    let best: Vector3 | null = null;
    let bestT = Infinity;
    for (let i = 0; i < d.count; i++) {
      if (d.colors[i * 4 + 3]! < 0.2) continue;
      p.set(d.centers[i * 3]!, d.centers[i * 3 + 1]!, d.centers[i * 3 + 2]!).applyMatrix4(
        this.mesh.matrixWorld,
      );
      const t = p.clone().sub(ray.ray.origin).dot(ray.ray.direction);
      if (t <= 0 || t >= bestT) continue;
      const off = ray.ray.distanceToPoint(p);
      if (off < Math.max(0.03, t * 0.01)) {
        bestT = t;
        best = p.clone();
      }
    }
    return best;
  }

  dispose(): void {
    this.abort.abort();
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.texture?.dispose();
    this.group.clear();
  }
}
