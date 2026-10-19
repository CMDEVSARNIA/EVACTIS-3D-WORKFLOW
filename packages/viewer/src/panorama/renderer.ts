import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Frustum,
  LinearFilter,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Texture,
  Vector3,
  VideoTexture,
  WebGLRenderer,
} from 'three';
import type { SceneMedia } from '@evactis-3dworkflow/schema';
import { loadImage, type AssetResolver } from '../assets.ts';
import { DEG, direction } from '../math.ts';
import { adaptation, type LuminanceMap } from './adaptive.ts';
import { FACES, facePoint, tilePath, type Face } from './cube.ts';
import { Grading, NEUTRAL, type Grade } from './grading.ts';
import { RegionLayer, type RegionSource } from './regions.ts';

type Equirect = Extract<SceneMedia, { type: 'equirect' }>;
type Video360 = Extract<SceneMedia, { type: 'video360' }>;

export interface View {
  yaw: number;
  pitch: number;
  fov: number;
}

/** Equirectangular sphere with UVs computed from the shared yaw/pitch convention. */
function sphereGeometry(radius: number, cols = 64, rows = 32): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const yaw = -180 + (360 * i) / cols;
      const pitch = 90 - (180 * j) / rows;
      const d = direction(yaw, pitch);
      pos.push(d[0] * radius, d[1] * radius, d[2] * radius);
      uv.push(i / cols, 1 - j / rows);
    }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + cols + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(index);
  return g;
}

/**
 * A tile as a subdivided grid on its cube face. Subdividing keeps every triangle small,
 * so tiles that straddle the camera plane clip and interpolate cleanly.
 */
function quadGeometry(
  face: Face,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  seg = 8,
): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= seg; j++)
    for (let i = 0; i <= seg; i++) {
      const s = i / seg;
      const t = j / seg;
      pos.push(...facePoint(face, u0 + (u1 - u0) * s, v0 + (v1 - v0) * t));
      uv.push(s, 1 - t);
    }
  for (let j = 0; j < seg; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + seg + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(index);
  return g;
}

function textureFrom(img: HTMLImageElement | HTMLVideoElement): Texture {
  const t = img instanceof HTMLVideoElement ? new VideoTexture(img) : new Texture(img);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

interface Content {
  readonly group: Scene;
  readonly pending: number;
  readonly video: HTMLVideoElement | null;
  load(): Promise<void>;
  update(camera: PerspectiveCamera, viewportHeightPx: number): void;
  dispose(): void;
}

interface Tile {
  url: string;
  level: number;
  face: Face;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  box: Box3;
  mesh?: Mesh;
  state: 'idle' | 'loading' | 'ready' | 'error';
}

/**
 * One panorama loaded into the renderer: an equirectangular image, or multi-resolution
 * cube tiles over an optional low-resolution equirectangular preview.
 */
class PanoramaContent implements Content {
  readonly group = new Scene();
  readonly video = null;
  private tiles: Tile[] = [];
  private levelSizes: number[] = [];
  private active = 0;
  private abort = new AbortController();
  private disposables: { dispose(): void }[] = [];
  private queue: Tile[] = [];

  constructor(
    private media: Equirect,
    private resolve: AssetResolver,
    private onChange: () => void,
    private grading: Grading,
  ) {}

  get pending(): number {
    return this.active + this.queue.length;
  }

  /** Loads what is needed to show the scene at all (preview or lowest tile level). */
  async load(): Promise<void> {
    const m = this.media;
    if (m.tiles) {
      const t = m.tiles;
      this.levelSizes = t.levels.map((l) => l.size);
      t.levels.forEach((level, li) => {
        const n = Math.ceil(level.size / t.tileSize);
        for (const face of FACES)
          for (let row = 0; row < n; row++)
            for (let col = 0; col < n; col++) {
              const u0 = -1 + (2 * col * t.tileSize) / level.size;
              const u1 = Math.min(1, -1 + (2 * (col + 1) * t.tileSize) / level.size);
              const v0 = 1 - (2 * row * t.tileSize) / level.size;
              const v1 = Math.max(-1, 1 - (2 * (row + 1) * t.tileSize) / level.size);
              const pts = [
                facePoint(face, u0, v0),
                facePoint(face, u1, v1),
                facePoint(face, u0, v1),
                facePoint(face, u1, v0),
              ];
              const box = new Box3().setFromPoints(pts.map((p) => new Vector3(...p)));
              this.tiles.push({
                url: this.resolve(tilePath(t.basePath, face, li, row, col, t.format)),
                level: li,
                face,
                u0,
                u1,
                v0,
                v1,
                box,
                state: 'idle',
              });
            }
      });
    }
    const preview = m.tiles ? m.preview : (m.preview ?? m.source);
    if (preview) {
      const img = await loadImage(this.resolve(preview), this.abort.signal);
      this.addSphere(img, 0);
    }
    if (m.tiles) {
      // Lowest level everywhere, so the panorama is complete before any detail arrives.
      await Promise.all(this.tiles.filter((t) => t.level === 0).map((t) => this.loadTile(t)));
    } else if (m.preview) {
      // Preview shown first, full image replaces it.
      void loadImage(this.resolve(m.source), this.abort.signal)
        .then((img) => {
          this.addSphere(img, 1);
          this.onChange();
        })
        .catch(() => undefined);
    }
  }

  private addSphere(img: HTMLImageElement, order: number) {
    const tex = textureFrom(img);
    const geo = sphereGeometry(5);
    const mat = this.grading.material(tex);
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = order;
    this.group.add(mesh);
    this.disposables.push(tex, geo, mat);
  }

  private loadTile(tile: Tile): Promise<void> {
    if (tile.state !== 'idle') return Promise.resolve();
    tile.state = 'loading';
    this.active++;
    return loadImage(tile.url, this.abort.signal)
      .then((img) => {
        const tex = textureFrom(img);
        const geo = quadGeometry(tile.face, tile.u0, tile.u1, tile.v0, tile.v1);
        const mat = this.grading.material(tex);
        tile.mesh = new Mesh(geo, mat);
        tile.mesh.renderOrder = 10 + tile.level;
        this.group.add(tile.mesh);
        this.disposables.push(tex, geo, mat);
        tile.state = 'ready';
      })
      .catch(() => {
        tile.state = 'error';
      })
      .finally(() => {
        this.active--;
        this.onChange();
        this.pump();
      });
  }

  private pump() {
    while (this.active < 6 && this.queue.length) void this.loadTile(this.queue.shift()!);
  }

  /** Picks the tile level for the current view and queues the visible tiles. */
  update(camera: PerspectiveCamera, viewportHeightPx: number): void {
    if (!this.tiles.length) return;
    const needed = viewportHeightPx / 2 / Math.tan((camera.fov * DEG) / 2);
    let level = this.levelSizes.findIndex((s) => s / 2 >= needed * 0.9);
    if (level < 0) level = this.levelSizes.length - 1;
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const wanted = this.tiles.filter(
      (t) => t.level <= level && t.level > 0 && t.state === 'idle' && frustum.intersectsBox(t.box),
    );
    // Coarse levels first so detail fills in progressively.
    wanted.sort((a, b) => a.level - b.level);
    this.queue = wanted;
    this.pump();
  }

  dispose(): void {
    this.abort.abort();
    this.queue = [];
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.group.clear();
  }
}

/**
 * A 360° video on the panorama sphere. The video starts muted and paused on its first
 * frame (or poster); the Viewer's controls play it. Stereo videos show the left eye.
 */
class VideoContent implements Content {
  readonly group = new Scene();
  readonly video: HTMLVideoElement;
  readonly pending = 0;
  private disposables: { dispose(): void }[] = [];

  constructor(
    private media: Video360,
    resolve: AssetResolver,
    private grading: Grading,
  ) {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.loop = media.loop;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.src = resolve(media.source);
    if (media.poster) v.poster = resolve(media.poster);
    this.video = v;
  }

  load(): Promise<void> {
    const v = this.video;
    return new Promise((ok, fail) => {
      const done = () => {
        v.removeEventListener('loadeddata', done);
        v.removeEventListener('error', bad);
        const tex = textureFrom(v);
        const geo = sphereGeometry(5);
        // Stereo: keep the left eye (top half, or left half).
        if (this.media.stereo !== 'mono') {
          const uv = geo.getAttribute('uv') as BufferAttribute;
          for (let i = 0; i < uv.count; i++)
            if (this.media.stereo === 'top-bottom') uv.setY(i, 0.5 + uv.getY(i) / 2);
            else uv.setX(i, uv.getX(i) / 2);
        }
        const mat = this.grading.material(tex);
        this.group.add(new Mesh(geo, mat));
        this.disposables.push(tex, geo, mat);
        ok();
      };
      const bad = () => fail(new Error(`The video could not be played: ${this.media.source}`));
      v.addEventListener('loadeddata', done);
      v.addEventListener('error', bad);
      v.load();
    });
  }

  update(): void {}

  dispose(): void {
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }
}

/** WebGL panorama renderer. Renders on demand only (nothing runs while the view is still). */
export class PanoramaRenderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer;
  private camera = new PerspectiveCamera(90, 1, 0.01, 20);
  private content: Content | null = null;
  private root = new Scene();
  private grading = new Grading();
  private grade: Grade = NEUTRAL;
  private regions: RegionLayer;
  private overlay = new Scene();
  private luminance: LuminanceMap | null = null;
  /** Current adaptive-HDR shift (stops) and when it was last stepped. */
  private adapt = { value: 0, at: 0 };
  /** Snap adaptation instead of easing it (reduced motion). */
  instantAdaptation = false;
  private dirty = true;
  private raf = 0;
  private resize: ResizeObserver;
  private idleWaiters: (() => void)[] = [];
  view: View = { yaw: 0, pitch: 0, fov: 90 };

  constructor(
    private host: HTMLElement,
    private onFrame: () => void,
  ) {
    this.renderer = new WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x0a0a0a, 1);
    this.camera.rotation.order = 'YXZ';
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'evx-viewer__canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    host.append(this.canvas);
    this.resize = new ResizeObserver(() => this.invalidate());
    this.resize.observe(host);
    this.regions = new RegionLayer(this.overlay, this.grading);
    this.root.add(this.overlay);
  }

  /** Replaces the panorama. Resolves once it can be shown. */
  async show(media: SceneMedia, resolve: AssetResolver): Promise<void> {
    let next: Content;
    if (media.type === 'equirect')
      next = new PanoramaContent(media, resolve, () => this.invalidate(), this.grading);
    else if (media.type === 'video360') next = new VideoContent(media, resolve, this.grading);
    else throw new Error(`Scene media "${media.type}" is not supported by the Viewer core yet`);
    await next.load();
    if (this.content) {
      this.root.remove(this.content.group);
      this.content.dispose();
    }
    this.regions.clear();
    this.content = next;
    this.root.add(next.group);
    // Video frames arrive on their own clock: draw each one while playing.
    const v = next.video;
    if (v)
      for (const e of ['play', 'seeked', 'timeupdate'])
        v.addEventListener(e, () => this.invalidate());
    this.invalidate();
  }

  /** The current scene's video, if it is a 360° video scene. */
  get video(): HTMLVideoElement | null {
    return this.content?.video ?? null;
  }

  /** Exposure and haze for every panorama surface (live layers). */
  setGrade(grade: Grade): void {
    this.grade = grade;
    this.applyGrade();
    this.invalidate();
  }

  /** HDR luminance map of the current scene; null turns adaptive exposure off. */
  setLuminance(map: LuminanceMap | null): void {
    this.luminance = map;
    if (!map) this.adapt.value = 0;
    this.adapt.at = 0;
    this.applyGrade();
    this.invalidate();
  }

  /** Current adaptive-HDR exposure shift in stops (0 without a luminance map). */
  get adaptation(): number {
    return this.adapt.value;
  }

  /** Animated regions of the current scene (replaces any shown). */
  setRegions(sources: RegionSource[]): void {
    this.regions.set(sources);
    for (const s of sources)
      if (s.element instanceof HTMLVideoElement)
        s.element.addEventListener('play', () => this.invalidate());
    this.invalidate();
  }

  get regionIds(): string[] {
    return this.regions.ids;
  }

  private applyGrade() {
    this.grading.set(this.grade, this.adapt.value);
  }

  /** Steps adaptive exposure towards the view's target; true while still moving. */
  private stepAdaptation(): boolean {
    if (!this.luminance) return false;
    const target = adaptation(
      this.luminance.viewStops(this.view.yaw, this.view.pitch, this.view.fov),
    );
    const now = performance.now();
    const dt = this.adapt.at ? (now - this.adapt.at) / 1000 : Infinity;
    this.adapt.at = now;
    const k = this.instantAdaptation ? 1 : 1 - Math.exp(-dt / 0.35);
    this.adapt.value += (target - this.adapt.value) * k;
    if (Math.abs(target - this.adapt.value) < 0.01) this.adapt.value = target;
    this.applyGrade();
    return this.adapt.value !== target;
  }

  /** Something keeps changing without input: a video playing, or eyes adapting. */
  private animating(): boolean {
    const v = this.content?.video;
    return (!!v && !v.paused && !v.ended) || this.regions.playing;
  }

  setView(view: View): void {
    this.view = view;
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  /** Renders now and returns a copy of the frame (for transitions). */
  snapshot(): HTMLCanvasElement {
    this.draw();
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    c.getContext('2d')?.drawImage(this.canvas, 0, 0);
    return c;
  }

  /** Resolves when no tiles are loading and nothing is waiting to render. */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private isIdle() {
    // Playing video never settles; it counts as idle once everything else has.
    return (
      ((!this.dirty && !this.raf) || this.animating()) &&
      (this.content?.pending ?? 0) === 0 &&
      !this.adapting
    );
  }
  private adapting = false;

  /** Projects a direction to CSS pixels in the host; null when behind the camera. */
  project(yaw: number, pitch: number): { x: number; y: number } | null {
    const d = direction(yaw, pitch);
    const v = new Vector3(d[0], d[1], d[2]).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  /** Yaw/pitch under a point of the host (CSS pixels). */
  unproject(x: number, y: number): { yaw: number; pitch: number } {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    const v = new Vector3((x / w) * 2 - 1, 1 - (y / h) * 2, 0.5).unproject(this.camera);
    const yaw = Math.atan2(v.x, -v.z) / DEG;
    const pitch = Math.atan2(v.y, Math.hypot(v.x, v.z)) / DEG;
    return { yaw, pitch };
  }

  /** Horizontal field of view in degrees for the current aspect. */
  get hfov(): number {
    return (2 * Math.atan(Math.tan((this.view.fov * DEG) / 2) * this.camera.aspect)) / DEG;
  }

  private draw() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    if (this.canvas.clientWidth !== w || this.canvas.clientHeight !== h)
      this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = this.view.fov;
    this.camera.rotation.set(this.view.pitch * DEG, -this.view.yaw * DEG, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.content?.update(this.camera, h * this.renderer.getPixelRatio());
    this.adapting = this.stepAdaptation();
    if (this.content) this.renderer.render(this.root, this.camera);
    else this.renderer.clear();
  }

  private frame() {
    this.raf = 0;
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
    this.onFrame();
    if (this.adapting || this.animating()) this.invalidate();
    if (this.isIdle()) for (const w of this.idleWaiters.splice(0)) w();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.regions.clear();
    this.content?.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
