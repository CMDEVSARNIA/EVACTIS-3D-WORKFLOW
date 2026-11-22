import type { Hotspot, WorldPoint } from '@evactis-3dworkflow/schema';
import { localize } from '@evactis-3dworkflow/schema';
import { createButton, createMarker, createSign } from '@evactis-3dworkflow/brand';
import type { PanoramaRenderer } from './panorama/renderer.ts';
import { createSymbol, type SymbolAppearance } from './safety.ts';

const SVG = 'http://www.w3.org/2000/svg';
const DEG = Math.PI / 180;

/** Eye height above the floor in panoramas (metres), as for links and route chevrons. */
const EYE = 1.6;
/** One chevron in metres on the floor: u across, v along the way (tip at +v). */
const CHEVRON: [number, number][] = [
  [-0.5, -0.22],
  [0, 0.28],
  [0.5, -0.22],
  [0.5, -0.5],
  [0, 0],
  [-0.5, -0.5],
];
/** Where the three chevrons sit along the way, around the hotspot's floor point. */
const CHEVRON_STEPS = [-0.65, 0, 0.65];
/** The area that takes clicks: the three chevrons with a margin. */
const HIT: [number, number][] = [
  [-0.7, -1.3],
  [0.7, -1.3],
  [0.7, 1.05],
  [-0.7, 1.05],
];

/**
 * Directions (yaw/pitch) of points on the floor around a hotspot pointing at the floor:
 * the shape is laid flat at that spot, facing away from the reader, so the renderer
 * projects it in true perspective. Directions at or above the horizon are taken as a
 * spot 8 m away; very near ones as 1.2 m (the arrow stays whole and clickable).
 */
export function floorShape(
  yaw: number,
  pitch: number,
  shape: [number, number][],
  along = 0,
  size = 1,
): { yaw: number; pitch: number }[] {
  const d = Math.min(8, Math.max(1.2, pitch < -1 ? EYE / Math.tan(-pitch * DEG) : 8));
  // Far arrows are drawn larger so they stay readable and easy to hit: seen along the
  // floor, their depth shrinks much faster than their width.
  // The arrow's near end (the hit area reaches 1.3 units back) stays 0.6 m in front of the
  // reader, so a large arrow close by shrinks to fit instead of disappearing.
  const s = Math.min(Math.min(2.4, Math.max(0.8, d / 2.4)) * size, (d - 0.6) / 1.3);
  const f = [Math.sin(yaw * DEG), Math.cos(yaw * DEG)];
  const r = [f[1]!, -f[0]!];
  return shape.map(([u, v]) => {
    const x = f[0]! * (d + (v + along) * s) + r[0]! * u * s;
    const z = f[1]! * (d + (v + along) * s) + r[1]! * u * s;
    return { yaw: Math.atan2(x, z) / DEG, pitch: -Math.atan2(EYE, Math.hypot(x, z)) / DEG };
  });
}

/**
 * DOM layer of hotspots over the panorama, built from the Evactis kit (buttons, round
 * markers, safety signs) so they stay keyboard-focusable and screen-reader labelled.
 */
export class HotspotLayer {
  readonly el: HTMLDivElement;
  private areas: SVGSVGElement;
  private items: { hotspot: Hotspot; el: HTMLElement | SVGElement }[] = [];
  /** Hotspot being dragged in editing mode, and where it is on screen. */
  private drag: { id: string; x: number; y: number } | null = null;

  constructor(
    host: HTMLElement,
    private renderer: PanoramaRenderer,
    private activate: (h: Hotspot) => void,
    /** Keyboard focus on a hotspot outside the view turns the view towards it. */
    private reveal: (h: Hotspot) => void,
    /**
     * Editing mode only: a point hotspot was dragged to a new direction (and, in GLB and
     * splat scenes, onto the surface found there).
     */
    private move:
      | ((h: Hotspot, yaw: number, pitch: number, point: WorldPoint | null) => void)
      | null = null,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'evx-viewer__hotspots';
    this.areas = document.createElementNS(SVG, 'svg');
    this.areas.setAttribute('class', 'evx-viewer__areas');
    this.el.append(this.areas);
    host.append(this.el);
  }

  /** Each hotspot's size (1 = normal), set by the Viewer from the tour's settings. */
  sizeOf: (h: Hotspot) => number = () => 1;

  /** Reduced motion: floor arrows keep their highlight still. */
  set still(on: boolean) {
    this.el.classList.toggle('evx-viewer__hotspots--still', on);
  }

  /** Replaces the hotspots shown (already filtered for scene, audience and conditions). */
  set(hotspots: Hotspot[], lang: string): void {
    for (const i of this.items) i.el.remove();
    this.items = hotspots.map((h) => ({ hotspot: h, el: this.build(h, lang) }));
    this.update();
  }

  /** The hotspots shown and their elements (VR draws the same kit artwork). */
  get shown(): readonly { hotspot: Hotspot; el: HTMLElement | SVGElement }[] {
    return this.items;
  }

  /** Editing: marks one hotspot as selected (or none). */
  select(id: string | null): void {
    for (const { hotspot, el } of this.items)
      el.classList.toggle('evx-viewer__hotspot--selected', hotspot.id === id);
  }

  /** Editing: press, drag and release a point hotspot to move it; a press alone clicks. */
  private draggable(h: Hotspot, el: HTMLElement) {
    let start: { x: number; y: number } | null = null;
    let moved = false;
    el.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary) return;
      e.stopPropagation(); // the panorama must not pan while a hotspot is dragged
      start = { x: e.clientX, y: e.clientY };
      moved = false;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!start) return;
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
      moved = true;
      const r = this.el.getBoundingClientRect();
      this.drag = { id: h.id, x: e.clientX - r.left, y: e.clientY - r.top };
      el.classList.add('evx-viewer__hotspot--dragging');
      this.update();
    });
    const end = (e: PointerEvent, commit: boolean) => {
      if (!start) return;
      start = null;
      el.classList.remove('evx-viewer__hotspot--dragging');
      const d = this.drag;
      this.drag = null;
      if (moved && d && commit) {
        const dir = this.renderer.unproject(d.x, d.y);
        this.move!(h, dir.yaw, dir.pitch, this.renderer.pick(d.x, d.y));
      }
      if (moved) {
        // The browser still fires a click after the drag; swallow it.
        el.addEventListener('click', (c) => c.stopImmediatePropagation(), {
          capture: true,
          once: true,
        });
      }
      this.update();
      e.stopPropagation();
    };
    el.addEventListener('pointerup', (e) => end(e, true));
    el.addEventListener('pointercancel', (e) => end(e, false));
  }

  private build(h: Hotspot, lang: string): HTMLElement | SVGElement {
    const label = localize(h.title, lang);
    const a = h.appearance;
    let el: HTMLElement | SVGElement;
    if (a.kind === 'floor-arrow') {
      el = this.floorArrow(h, label);
    } else if (a.kind === 'area') {
      const poly = document.createElementNS(SVG, 'polygon');
      poly.setAttribute('class', 'evx-viewer__area');
      poly.setAttribute('tabindex', '0');
      poly.setAttribute('role', 'button');
      poly.setAttribute('aria-label', label);
      poly.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.activate(h);
        }
      });
      this.areas.append(poly);
      el = poly;
    } else {
      let b: HTMLElement;
      if (a.kind === 'button') b = createButton({ icon: a.icon, label });
      else if (a.kind === 'marker') b = createMarker({ marker: a.marker, label });
      else if (a.kind === 'safety-sign') b = createSign(a.sign, a.style, label);
      else if ((a as unknown as SymbolAppearance).kind === 'symbol')
        b = createSymbol(a as unknown as SymbolAppearance, label);
      else {
        b = document.createElement('button');
        b.setAttribute('type', 'button');
        b.className = 'evx-viewer__label';
        b.textContent = localize(a.text, lang);
        b.setAttribute('aria-label', label);
      }
      b.classList.add('evx-viewer__hotspot');
      b.style.setProperty('--evx-hotspot-scale', String(this.sizeOf(h)));
      // Kit parts that set their own size (signs: their artwork's width) scale from it.
      for (const v of ['--evx-sign-size', '--evx-marker-size', '--evx-btn-size']) {
        const own = b.style.getPropertyValue(v);
        if (own) b.style.setProperty(v, `calc(${own} * var(--evx-hotspot-scale, 1))`);
      }
      b.title = label;
      this.el.append(b);
      el = b;
    }
    el.dataset.hotspotId = h.id;
    if (this.move && h.position.kind !== 'polygon') this.draggable(h, el as HTMLElement);
    el.addEventListener('click', () => this.activate(h));
    el.addEventListener('focus', () => {
      if (el.classList.contains('evx-viewer__hotspot--offscreen')) this.reveal(h);
    });
    return el;
  }

  /**
   * A link drawn on the floor: three chevrons (white, navy edge) over a wider invisible
   * hit area, one focusable button for keyboards and screen readers.
   */
  private floorArrow(h: Hotspot, label: string): SVGGElement {
    const g = document.createElementNS(SVG, 'g');
    g.setAttribute('class', 'evx-viewer__hotspot evx-viewer__floor-arrow');
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', label);
    const title = document.createElementNS(SVG, 'title');
    title.textContent = label;
    const hit = document.createElementNS(SVG, 'polygon');
    hit.setAttribute('class', 'evx-viewer__floor-arrow-hit');
    g.append(title, hit);
    CHEVRON_STEPS.forEach((_, i) => {
      const c = document.createElementNS(SVG, 'polygon');
      c.setAttribute('class', 'evx-viewer__floor-chevron');
      c.style.setProperty('--i', String(i));
      g.append(c);
    });
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.activate(h);
      }
    });
    this.areas.append(g);
    return g;
  }

  /** Lays a floor arrow out for the current camera; false when it cannot be seen whole. */
  private placeFloorArrow(g: SVGElement, yaw: number, pitch: number, size: number): boolean {
    const toScreen = (pts: { yaw: number; pitch: number }[]) => {
      const out = pts.map((q) => this.renderer.project(q.yaw, q.pitch));
      return out.some((q) => !q)
        ? null
        : out.map((q) => `${q!.x.toFixed(1)},${q!.y.toFixed(1)}`).join(' ');
    };
    const hit = toScreen(floorShape(yaw, pitch, HIT, 0, size));
    if (!hit) return false;
    const polys = g.querySelectorAll('polygon');
    polys[0]!.setAttribute('points', hit);
    for (let i = 0; i < CHEVRON_STEPS.length; i++) {
      const pts = toScreen(floorShape(yaw, pitch, CHEVRON, CHEVRON_STEPS[i], size));
      if (!pts) return false;
      polys[i + 1]!.setAttribute('points', pts);
    }
    return true;
  }

  /** Repositions every hotspot for the current camera. Called after each rendered frame. */
  update(): void {
    for (const { hotspot: h, el } of this.items) {
      const p = h.position;
      if (h.appearance.kind === 'floor-arrow' && p.kind !== 'polygon') {
        const dir =
          this.drag?.id === h.id
            ? this.renderer.unproject(this.drag.x, this.drag.y)
            : p.kind === 'world'
              ? this.renderer.toView(p)
              : p;
        const shown = this.placeFloorArrow(el as SVGElement, dir.yaw, dir.pitch, this.sizeOf(h));
        const box = shown ? (el as SVGGraphicsElement).getBBox?.() : null;
        const w = this.el.clientWidth;
        const hgt = this.el.clientHeight;
        const off =
          !shown ||
          (!!box && (box.x + box.width < 0 || box.y + box.height < 0 || box.x > w || box.y > hgt));
        el.classList.toggle('evx-viewer__hotspot--offscreen', off);
        continue;
      }
      if (p.kind === 'spherical' || p.kind === 'world') {
        // World points (GLB and splat scenes) are seen from the viewpoint, like directions.
        const dir = p.kind === 'world' ? this.renderer.toView(p) : p;
        const s = this.drag?.id === h.id ? this.drag : this.renderer.project(dir.yaw, dir.pitch);
        const html = el as HTMLElement;
        const w = this.el.clientWidth;
        const hgt = this.el.clientHeight;
        // Off-screen hotspots stay in the tab order (keyboard and screen-reader users can
        // reach every hotspot) but are invisible and not clickable until in view.
        const off = !s || s.x < -40 || s.y < -40 || s.x > w + 40 || s.y > hgt + 40;
        html.classList.toggle('evx-viewer__hotspot--offscreen', off);
        if (!s) continue;
        html.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`;
      } else if (p.kind === 'polygon') {
        const pts = p.points.map((q) => this.renderer.project(q.yaw, q.pitch));
        el.classList.toggle(
          'evx-viewer__hotspot--offscreen',
          pts.some((q) => !q),
        );
        if (pts.some((q) => !q)) continue;
        el.setAttribute(
          'points',
          pts.map((q) => `${q!.x.toFixed(1)},${q!.y.toFixed(1)}`).join(' '),
        );
      }
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
