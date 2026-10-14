import type { Hotspot } from '@evactis-3dworkflow/schema';
import { localize } from '@evactis-3dworkflow/schema';
import { createButton, createMarker, createSign } from '@evactis-3dworkflow/brand';
import type { PanoramaRenderer } from './panorama/renderer.ts';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * DOM layer of hotspots over the panorama, built from the Evactis kit (buttons, round
 * markers, safety signs) so they stay keyboard-focusable and screen-reader labelled.
 */
export class HotspotLayer {
  readonly el: HTMLDivElement;
  private areas: SVGSVGElement;
  private items: { hotspot: Hotspot; el: HTMLElement | SVGElement }[] = [];

  constructor(
    host: HTMLElement,
    private renderer: PanoramaRenderer,
    private activate: (h: Hotspot) => void,
    /** Keyboard focus on a hotspot outside the view turns the view towards it. */
    private reveal: (h: Hotspot) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'evx-viewer__hotspots';
    this.areas = document.createElementNS(SVG, 'svg');
    this.areas.setAttribute('class', 'evx-viewer__areas');
    this.el.append(this.areas);
    host.append(this.el);
  }

  /** Replaces the hotspots shown (already filtered for scene, audience and conditions). */
  set(hotspots: Hotspot[], lang: string): void {
    for (const i of this.items) i.el.remove();
    this.items = hotspots.map((h) => ({ hotspot: h, el: this.build(h, lang) }));
    this.update();
  }

  private build(h: Hotspot, lang: string): HTMLElement | SVGElement {
    const label = localize(h.title, lang);
    const a = h.appearance;
    let el: HTMLElement | SVGElement;
    if (a.kind === 'area') {
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
      else {
        b = document.createElement('button');
        b.setAttribute('type', 'button');
        b.className = 'evx-viewer__label';
        b.textContent = localize(a.text, lang);
        b.setAttribute('aria-label', label);
      }
      b.classList.add('evx-viewer__hotspot');
      b.title = label;
      this.el.append(b);
      el = b;
    }
    el.dataset.hotspotId = h.id;
    el.addEventListener('click', () => this.activate(h));
    el.addEventListener('focus', () => {
      if (el.classList.contains('evx-viewer__hotspot--offscreen')) this.reveal(h);
    });
    return el;
  }

  /** Repositions every hotspot for the current camera. Called after each rendered frame. */
  update(): void {
    for (const { hotspot: h, el } of this.items) {
      const p = h.position;
      if (p.kind === 'spherical') {
        const s = this.renderer.project(p.yaw, p.pitch);
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
      } else {
        // World-space (GLB/splat) hotspots arrive with Phase 9.
        (el as HTMLElement).style.visibility = 'hidden';
      }
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
