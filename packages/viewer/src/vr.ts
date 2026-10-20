import { iconSvg, type IconName } from '@evactis-3dworkflow/brand';
import {
  CanvasTexture,
  Group,
  Line,
  BufferGeometry,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
  type PerspectiveCamera,
  type XRTargetRaySpace,
} from 'three';
import { DEG, direction } from './math.ts';
import type { PanoramaRenderer } from './panorama/renderer.ts';

/**
 * Immersive VR for the 3DWORKFLOW Viewer (WebXR), loaded on demand when the reader enters
 * VR. The headset shows the same content as the screen, drawn from the same kit artwork:
 * hotspots and equipment signs, route chevrons on the floor, the open dialog as a panel,
 * and a small toolbar (home, previous, next, evacuation route, exit). Everything is
 * selected by pointing a controller and pulling the trigger or, without controllers, by
 * looking at it until the ring fills (gaze dwell). ADR 0017.
 */

/** The VR-friendly subset of the toolbar. */
export type VrCommand = 'home' | 'previous' | 'next' | 'evac-route' | 'exit';
const COMMANDS: { command: VrCommand; icon: IconName }[] = [
  { command: 'home', icon: 'home' },
  { command: 'previous', icon: 'previous' },
  { command: 'next', icon: 'next' },
  { command: 'evac-route', icon: 'evac-route' },
  { command: 'exit', icon: 'vr' },
];

/** Kit artwork for a VR card: an SVG (a sign, a marker; `plate` = a kit button) or text. */
export type VrArt = { svg: string; plate?: boolean; pressed?: boolean } | { text: string };

/** A hotspot as seen from the reader: direction (degrees) and distance (metres). */
export interface VrTarget {
  id: string;
  label: string;
  yaw: number;
  pitch: number;
  distance: number;
  /** The hotspot's element on screen; the headset draws the same kit artwork. */
  element: Element;
  activate(): void;
}

export interface VrHost {
  readonly renderer: PanoramaRenderer;
  /** The dialog element the Viewer shows popups in (mirrored as a panel while open). */
  readonly dialog: HTMLDialogElement;
  /** Body font (the bundled Inter). */
  readonly font: string;
  lang(): 'en' | 'fr';
  label(c: VrCommand): string;
  targets(): VrTarget[];
  route(): { yaw: number; pitch: number; distance: number }[];
  routeActive(): boolean;
  /** Whether the scene is a GLB or splat scene (the reader may move around). */
  is3d(): boolean;
  command(c: VrCommand): void;
}

/** Something the reader can select: a card in the headset. */
interface Selectable {
  id: string;
  kind: 'hotspot' | 'toolbar' | 'panel';
  label: string;
  mesh: Mesh;
  run(): void;
}

const PAPER = '#FAFAFA';
const NAVY = '#0A2F5B';
const GREEN = '#71B043';
const GREEN_STRONG = '#5D9518';

/** Self-contained SVG (no CSS variables or currentColor), with a drawing size. */
export function standaloneSvg(svg: string, width: number): { markup: string; height: number } {
  let s = svg.replace(/var\(--[\w-]+,\s*([^)]+)\)/g, '$1').replaceAll('currentColor', PAPER);
  if (!/xmlns=/.test(s)) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(s);
  const aspect = vb ? Number(vb[2]) / Number(vb[1]) : 1;
  const height = Math.round(width * aspect);
  s = s
    .replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1')
    .replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1')
    .replace('<svg', `<svg width="${width}" height="${height}"`);
  return { markup: s, height };
}

/** The kit artwork of a hotspot element (the DOM hotspot the screen shows). */
export function artOf(el: Element): VrArt {
  if (el.classList.contains('evx-btn')) {
    const icon = (el as HTMLElement).dataset.icon as IconName;
    return { svg: iconSvg(icon, { color: PAPER, accent: GREEN }), plate: true };
  }
  const svg = el.querySelector('svg');
  if (svg) return { svg: svg.outerHTML };
  return { text: (el.textContent ?? '').trim() };
}

/** Lines of text wrapped to a width. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function loadSvg(markup: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('VR artwork failed to load'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

/**
 * Cards are the interface, not part of the scene: like the screen's hotspots they draw
 * over the model (a sign on a wall or behind a crate stays whole), in `renderOrder`.
 */
function overlay(map: CanvasTexture): MeshBasicMaterial {
  return new MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export class VrUi {
  private hotspots = new Group();
  private chevrons = new Group();
  private toolbar = new Group();
  private panel = new Group();
  private reticle: Mesh;
  private progress: Mesh;
  private selectables: Selectable[] = [];
  private controllers: { group: XRTargetRaySpace; ray: Line; mode: string | null }[] = [];
  private gaze: { target: Selectable | null; since: number; done: boolean } = {
    target: null,
    since: 0,
    done: false,
  };
  private stale = true;
  private panelStale = true;
  private head = new Vector3();
  private yaw = 0;
  private observer: MutationObserver;
  private raycaster = new Raycaster();
  private disposed = false;

  constructor(
    private host: VrHost,
    private session: XRSession,
    /** Gaze selection time; 0 turns gaze selection off. */
    private dwellMs: number,
  ) {
    const root = host.renderer.vrRoot;
    root.add(this.hotspots, this.chevrons, this.toolbar, this.panel);
    // The gaze reticle: a thin ring that fills while the reader keeps looking.
    this.reticle = new Mesh(
      new RingGeometry(0.012, 0.018, 32),
      new MeshBasicMaterial({ color: PAPER, depthTest: false, transparent: true, opacity: 0.85 }),
    );
    this.progress = new Mesh(
      new RingGeometry(0.018, 0.028, 32, 1),
      new MeshBasicMaterial({ color: GREEN, depthTest: false }),
    );
    this.reticle.renderOrder = this.progress.renderOrder = 10;
    root.add(this.reticle, this.progress);
    for (let i = 0; i < 2; i++) {
      const group = host.renderer.controller(i);
      const ray = new Line(
        new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]),
        new LineBasicMaterial({ color: GREEN }),
      );
      ray.visible = false;
      group.add(ray);
      const c = { group, ray, mode: null as string | null };
      group.addEventListener('connected', (e) => {
        c.mode = e.data.targetRayMode;
      });
      group.addEventListener('disconnected', () => {
        c.mode = null;
        ray.visible = false;
      });
      group.addEventListener('select', () => this.hitFrom(group)?.target.run());
      root.add(group);
      this.controllers.push(c);
    }
    this.observer = new MutationObserver(() => (this.panelStale = true));
    this.observer.observe(host.dialog, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  /** Rebuilds the cards after a scene, language, route or hotspot change. */
  refresh(): void {
    this.stale = true;
    this.panelStale = true;
  }

  /** Everything selectable, with positions in reference-space metres (tests, tools). */
  get items(): { id: string; kind: Selectable['kind']; label: string; position: Vector3 }[] {
    this.host.renderer.vrRoot.updateMatrixWorld(true);
    return this.active().map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      position: s.mesh.getWorldPosition(new Vector3()),
    }));
  }

  /** Runs before each headset frame. */
  frame(camera: PerspectiveCamera, time: number): void {
    if (this.disposed) return;
    this.head.copy(camera.position);
    const f = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const yaw = Math.atan2(f.x, -f.z) / DEG;
    if (this.stale) {
      this.stale = false;
      this.yaw = yaw;
      this.build();
    }
    if (this.panelStale) {
      this.panelStale = false;
      if (!this.panel.children.length) this.yaw = yaw;
      void this.buildPanel();
    }
    // Panoramas are infinitely far: their cards stay centred on the head.
    const follow = this.host.is3d() ? new Vector3() : this.head;
    this.hotspots.position.copy(follow);
    this.chevrons.position.copy(follow);
    this.host.renderer.vrRoot.updateMatrixWorld(true);

    const hover = new Set<Selectable>();
    const pointers = this.controllers.filter((c) => c.mode === 'tracked-pointer');
    for (const c of this.controllers) {
      c.ray.visible = c.mode === 'tracked-pointer';
      if (!c.ray.visible) continue;
      const hit = this.hitFrom(c.group);
      if (hit) hover.add(hit.target);
      c.ray.scale.z = hit?.distance ?? 3;
    }
    const gazing = this.dwellMs > 0 && pointers.length === 0;
    this.reticle.visible = this.progress.visible = gazing;
    if (gazing) {
      this.raycaster.set(camera.position, f);
      const hit = this.nearest();
      const d = hit?.distance ?? 1.5;
      for (const m of [this.reticle, this.progress]) {
        m.position.copy(camera.position).addScaledVector(f, Math.min(d - 0.02, 3));
        m.quaternion.copy(camera.quaternion);
        m.scale.setScalar(Math.min(d, 3));
      }
      const target = hit?.target ?? null;
      if (target !== this.gaze.target) this.gaze = { target, since: time, done: false };
      if (target) hover.add(target);
      const p =
        target && !this.gaze.done ? Math.min(1, (time - this.gaze.since) / this.dwellMs) : 0;
      this.progress.geometry.setDrawRange(0, 6 * Math.round(32 * p));
      if (target && p >= 1) {
        this.gaze.done = true;
        target.run();
      }
    }
    for (const s of this.selectables) s.mesh.scale.setScalar(hover.has(s) ? 1.12 : 1);
  }

  private active(): Selectable[] {
    // A dialog is modal on screen; in the headset only its buttons answer while open.
    const panel = this.selectables.filter((s) => s.kind === 'panel');
    return panel.length ? panel : this.selectables;
  }

  private hitFrom(group: XRTargetRaySpace) {
    group.updateMatrixWorld(true);
    const origin = new Vector3().setFromMatrixPosition(group.matrixWorld);
    const dir = new Vector3(0, 0, -1).transformDirection(group.matrixWorld);
    this.raycaster.set(origin, dir);
    return this.nearest();
  }

  private nearest(): { target: Selectable; distance: number } | null {
    const list = this.active();
    const hits = this.raycaster.intersectObjects(
      list.map((s) => s.mesh),
      false,
    );
    const first = hits[0];
    if (!first) return null;
    return { target: list.find((s) => s.mesh === first.object)!, distance: first.distance };
  }

  // ------------------------------------------------------------------ cards

  /** A flat card: artwork above an optional label, sized in metres. */
  private card(art: VrArt | null, label: string | null, widthM: number, onDraw?: () => void): Mesh {
    const W = 256;
    const LABEL = label ? 72 : 0;
    const canvas = document.createElement('canvas');
    let artH = W;
    let markup: string | null = null;
    if (art && 'svg' in art) {
      const s = standaloneSvg(art.svg, art.plate ? Math.round(W * 0.6) : W);
      markup = s.markup;
      artH = art.plate ? W : s.height;
    } else if (art) artH = 112;
    canvas.width = W;
    canvas.height = artH + LABEL;
    const ctx = canvas.getContext('2d')!;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const draw = (img: HTMLImageElement | null) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (art && 'svg' in art && art.plate) {
        // The kit button: navy face (green when pressed), green bar at the bottom.
        ctx.fillStyle = art.pressed ? GREEN_STRONG : NAVY;
        roundRect(ctx, 8, 8, W - 16, W - 16, 28);
        ctx.fill();
        ctx.fillStyle = art.pressed ? NAVY : GREEN;
        ctx.fillRect(W * 0.3, W - 40, W * 0.4, 10);
        if (img) ctx.drawImage(img, W * 0.2, W * 0.16, W * 0.6, W * 0.6);
      } else if (art && 'svg' in art) {
        if (img) ctx.drawImage(img, 0, 0, W, artH);
      } else if (art) {
        ctx.fillStyle = NAVY;
        roundRect(ctx, 4, 4, W - 8, artH - 8, 20);
        ctx.fill();
        ctx.fillStyle = PAPER;
        ctx.font = `800 52px ${this.host.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(art.text, W / 2, artH / 2, W - 24);
      }
      if (label) {
        ctx.font = `600 30px ${this.host.font}`;
        const lines = wrap(ctx, label, W - 20).slice(0, 2);
        ctx.fillStyle = 'rgba(10,10,10,0.82)';
        roundRect(ctx, 0, artH + 4, W, LABEL - 4, 12);
        ctx.fill();
        ctx.fillStyle = PAPER;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lh = lines.length > 1 ? 30 : 0;
        lines.forEach((l, i) =>
          ctx.fillText(l, W / 2, artH + 4 + LABEL / 2 - lh / 2 + i * lh, W - 16),
        );
      }
      texture.needsUpdate = true;
      onDraw?.();
    };
    draw(null);
    if (markup)
      void loadSvg(markup)
        .then(draw)
        .catch(() => undefined);
    const h = (widthM * canvas.height) / W;
    return new Mesh(new PlaneGeometry(widthM, h), overlay(texture));
  }

  /** A text panel or a row button (wide), drawn once. */
  private textCard(
    lines: { text: string; weight: number; size: number }[],
    widthM: number,
    opts: { fill: string; button?: boolean },
  ): Mesh {
    const W = 1024;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const pad = opts.button ? 24 : 48;
    const laid: { text: string; font: string; size: number }[] = [];
    for (const l of lines) {
      const font = `${l.weight} ${l.size}px ${this.host.font}`;
      ctx.font = font;
      for (const t of wrap(ctx, l.text, W - 2 * pad)) laid.push({ text: t, font, size: l.size });
    }
    const height = Math.max(
      opts.button ? 96 : 160,
      laid.reduce((s, l) => s + l.size * 1.35, 0) + 2 * pad,
    );
    canvas.width = W;
    canvas.height = Math.min(Math.ceil(height), 2048);
    ctx.fillStyle = opts.fill;
    roundRect(ctx, 0, 0, W, canvas.height, opts.button ? 20 : 28);
    ctx.fill();
    if (opts.button) {
      ctx.fillStyle = GREEN;
      ctx.fillRect(0, canvas.height - 10, W, 10);
    }
    ctx.fillStyle = PAPER;
    ctx.textBaseline = 'top';
    ctx.textAlign = opts.button ? 'center' : 'left';
    let y = pad;
    for (const l of laid) {
      ctx.font = l.font;
      ctx.fillText(l.text, opts.button ? W / 2 : pad, y);
      y += l.size * 1.35;
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return new Mesh(new PlaneGeometry(widthM, (widthM * canvas.height) / W), overlay(texture));
  }

  private clear(group: Group) {
    for (const m of [...group.children] as Mesh[]) {
      group.remove(m);
      m.geometry?.dispose();
      const mat = m.material as MeshBasicMaterial | undefined;
      mat?.map?.dispose();
      mat?.dispose();
    }
  }

  private build() {
    const h = this.host;
    this.clear(this.hotspots);
    this.clear(this.chevrons);
    this.clear(this.toolbar);
    this.selectables = this.selectables.filter((s) => s.kind === 'panel');

    for (const t of h.targets()) {
      // Constant angular size (about 8°), whatever the distance.
      const mesh = this.card(artOf(t.element), t.label, Math.max(0.12, t.distance * 0.14));
      const d = direction(t.yaw, t.pitch);
      mesh.position.set(d[0], d[1], d[2]).multiplyScalar(t.distance);
      mesh.lookAt(0, 0, 0);
      mesh.renderOrder = 2;
      this.hotspots.add(mesh);
      this.selectables.push({
        id: t.id,
        kind: 'hotspot',
        label: t.label,
        mesh,
        run: () => t.activate(),
      });
    }

    // Route chevrons lie on the floor, pointing the way out.
    const pts = h.route().map((p) => {
      const d = direction(p.yaw, p.pitch);
      return new Vector3(d[0], d[1], d[2]).multiplyScalar(p.distance);
    });
    pts.forEach((p, i) => {
      const a = pts[i + 1] ? p : (pts[i - 1] ?? p);
      const b = pts[i + 1] ?? p;
      const yaw = Math.atan2(b.x - a.x, -(b.z - a.z));
      const size = 0.45 - (0.15 * i) / Math.max(1, pts.length - 1);
      const mesh = this.card(
        {
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M6 27 20 13l14 14" fill="none" stroke="#FAFAFA" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 27 20 13l14 14" fill="none" stroke="#00843D" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        },
        null,
        size,
      );
      mesh.rotation.order = 'YXZ';
      mesh.rotation.set(-Math.PI / 2, -yaw, 0);
      mesh.position.copy(p).setY(p.y + 0.02);
      mesh.renderOrder = 1;
      this.chevrons.add(mesh);
    });

    // The toolbar floats below the line of sight, where the reader looked on arrival.
    const facing = new Group();
    facing.position.copy(this.head);
    facing.rotation.y = -this.yaw * DEG;
    COMMANDS.forEach(({ command, icon }, i) => {
      const pressed = command === 'evac-route' && h.routeActive();
      const label = h.label(command);
      const mesh = this.card(
        {
          svg: iconSvg(icon, { color: PAPER, accent: pressed ? NAVY : GREEN }),
          plate: true,
          pressed,
        },
        label,
        0.12,
      );
      mesh.position.set((i - (COMMANDS.length - 1) / 2) * 0.15, -0.5, -0.85);
      mesh.rotation.x = -Math.atan2(0.5, 0.85);
      mesh.renderOrder = 3;
      facing.add(mesh);
      this.selectables.push({
        id: `toolbar:${command}`,
        kind: 'toolbar',
        label,
        mesh,
        run: () => (command === 'exit' ? void this.session.end() : h.command(command)),
      });
    });
    this.toolbar.add(facing);
  }

  /** Mirrors the open dialog: its title and text, and each of its buttons. */
  private async buildPanel() {
    this.clear(this.panel);
    this.panel.children.length = 0;
    this.selectables = this.selectables.filter((s) => s.kind !== 'panel');
    const dlg = this.host.dialog;
    if (!dlg.open) return;
    const title = dlg.querySelector('h2')?.textContent?.trim() ?? '';
    const body = dlg
      .querySelector('.evx-viewer__dialog-body')
      ?.cloneNode(true) as HTMLElement | null;
    const paras: string[] = [];
    if (body) {
      body
        .querySelectorAll('button, input, select, textarea, video, audio, canvas, svg, img')
        .forEach((e) => e.remove());
      const blocks = body.querySelectorAll('p, li, h3, dt, dd, figcaption, [role="status"]');
      if (blocks.length)
        blocks.forEach((b) => {
          const t = b.textContent?.replace(/\s+/g, ' ').trim();
          if (t) paras.push(t);
        });
      else {
        const t = body.textContent?.replace(/\s+/g, ' ').trim();
        if (t) paras.push(t);
      }
    }
    const buttons = [...dlg.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => !b.disabled && !b.hidden && b.offsetParent !== null,
    );
    const facing = new Group();
    facing.position.copy(this.head);
    facing.rotation.y = -this.yaw * DEG;
    const W = 0.9;
    const text = this.textCard(
      [
        ...(title ? [{ text: title, weight: 800, size: 52 }] : []),
        ...paras.slice(0, 12).map((p) => ({ text: p, weight: 400, size: 38 })),
      ],
      W,
      { fill: 'rgba(16,24,9,0.94)' },
    );
    const textH = (text.geometry as PlaneGeometry).parameters.height;
    let y = 0.1 + textH / 2;
    text.position.set(0, y, -1.3);
    text.renderOrder = 4;
    facing.add(text);
    y -= textH / 2 + 0.02;
    buttons.forEach((b, i) => {
      const label = (b.getAttribute('aria-label') || b.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      const mesh = this.textCard([{ text: label, weight: 700, size: 40 }], W * 0.8, {
        fill: b.getAttribute('aria-pressed') === 'true' ? GREEN_STRONG : NAVY,
        button: true,
      });
      const bh = (mesh.geometry as PlaneGeometry).parameters.height;
      y -= bh / 2;
      mesh.position.set(0, y, -1.28);
      mesh.renderOrder = 5;
      y -= bh / 2 + 0.015;
      facing.add(mesh);
      this.selectables.push({
        id: `panel:${i}`,
        kind: 'panel',
        label,
        mesh,
        run: () => b.click(),
      });
    });
    this.panel.add(facing);
    this.gaze = { target: null, since: 0, done: false };
  }

  dispose(): void {
    this.disposed = true;
    this.observer.disconnect();
    for (const g of [this.hotspots, this.chevrons, this.toolbar, this.panel]) {
      for (const c of g.children) if (c instanceof Group) this.clear(c);
      this.clear(g);
      g.removeFromParent();
    }
    for (const c of this.controllers) c.group.removeFromParent();
    this.reticle.removeFromParent();
    this.progress.removeFromParent();
  }
}
