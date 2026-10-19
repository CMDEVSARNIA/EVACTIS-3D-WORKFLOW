import { localize, type Environment, type Scene } from '@evactis-3dworkflow/schema';
import type { UiStrings } from './i18n.ts';

/**
 * Floor-plan radar: a small plan in a corner, centred on the current scene, with the
 * direction the reader is looking as a cone. Other scenes on the floor are dots; pressing
 * one goes there. Hidden for scenes not placed on a plan.
 */
export class Radar {
  readonly element = document.createElement('nav');
  private img = document.createElement('img');
  private svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private cone = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  private dots = document.createElement('div');
  private floorId: string | null = null;
  private scene: Scene | null = null;
  private northDeg = 0;

  constructor(
    host: HTMLElement,
    private t: () => UiStrings,
    private go: (sceneId: string) => void,
  ) {
    this.element.className = 'evx-viewer__radar';
    this.element.hidden = true;
    const map = document.createElement('div');
    map.className = 'evx-viewer__radar-map';
    this.img.alt = '';
    this.img.draggable = false;
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.setAttribute('viewBox', '-50 -50 100 100');
    this.cone.setAttribute('class', 'evx-viewer__radar-cone');
    const me = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    me.setAttribute('r', '5');
    me.setAttribute('class', 'evx-viewer__radar-me');
    this.svg.append(this.cone, me);
    this.dots.className = 'evx-viewer__radar-dots';
    map.append(this.img, this.dots);
    this.element.append(map, this.svg);
    host.append(this.element);
  }

  /** Shows the scene's floor around its position (or hides the radar). */
  set(
    env: Environment,
    scene: Scene | null,
    scenes: Scene[],
    lang: string,
    resolve: (p: string) => string | null,
  ): void {
    this.scene = scene;
    const floor = env.buildings.flatMap((b) => b.floors).find((f) => f.id === scene?.floorId);
    const plan = floor?.plan;
    const src = plan && resolve(plan.image);
    if (!scene?.planPosition || !plan || !src) {
      this.element.hidden = true;
      this.floorId = null;
      return;
    }
    this.element.hidden = false;
    this.element.setAttribute('aria-label', this.t().radar);
    this.floorId = floor.id;
    this.northDeg = plan.northDeg;
    // The plan is drawn at a fixed scale around the scene: 1 radar unit = 1 % of its width.
    const W = plan.widthPx;
    const H = plan.heightPx;
    const size = Math.max(W, H) * 0.35;
    const map = this.element.firstElementChild as HTMLElement;
    map.style.setProperty('--w', `${(W / size) * 100}%`);
    map.style.setProperty('--h', `${(H / size) * 100}%`);
    map.style.setProperty('--x', `${50 - (scene.planPosition.x / size) * 100}%`);
    map.style.setProperty('--y', `${50 - (scene.planPosition.y / size) * 100}%`);
    if (this.img.getAttribute('src') !== src) this.img.src = src;
    this.dots.replaceChildren();
    for (const s of scenes) {
      if (s.floorId !== floor.id || !s.planPosition || s.id === scene.id) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'evx-viewer__radar-dot';
      b.dataset.sceneId = s.id;
      b.setAttribute('aria-label', this.t().goTo(localize(s.name, lang)));
      b.title = localize(s.name, lang);
      b.style.left = `${(s.planPosition.x / W) * 100}%`;
      b.style.top = `${(s.planPosition.y / H) * 100}%`;
      b.addEventListener('click', () => this.go(s.id));
      this.dots.append(b);
    }
  }

  /** Points the cone where the reader looks (view yaw through the scene's north). */
  setView(yaw: number, hfov: number): void {
    if (!this.scene || this.element.hidden) return;
    // Bearing on the plan (clockwise from the plan's top) of the view direction.
    const bearing = yaw - this.scene.northOffsetDeg + this.northDeg;
    const half = Math.min(60, hfov / 2);
    const r = 40;
    const pt = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return `${(Math.sin(a) * r).toFixed(1)} ${(-Math.cos(a) * r).toFixed(1)}`;
    };
    this.cone.setAttribute(
      'd',
      `M0 0 L${pt(bearing - half)} A${r} ${r} 0 0 1 ${pt(bearing + half)} Z`,
    );
    this.element.dataset.bearing = String(Math.round(((bearing % 360) + 360) % 360));
  }

  get floor(): string | null {
    return this.floorId;
  }
}
