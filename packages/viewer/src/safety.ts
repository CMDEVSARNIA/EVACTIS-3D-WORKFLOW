/**
 * The safety layer in the Viewer: equipment shown as safety signs in the panorama,
 * evacuation routes as animated chevrons with a route banner, and the floor plan with
 * "You are here". Everything shown was placed or confirmed by a person in Studio; the
 * Viewer only chooses which confirmed route applies to the current scene.
 */
import {
  allFloors,
  equipmentSymbol,
  equipmentTypeInfo,
  localize,
  routeHeading,
  visibleEquipment,
  type Environment,
  type Equipment,
  type EquipmentCategory,
  type Floor,
  type Hotspot,
  type Route,
  type Scene,
} from '@evactis-3dworkflow/schema';
import { escapeXml, iconSvg, signSvg } from '@evactis-3dworkflow/brand';
import type { UiStrings } from './i18n.ts';
import type { PanoramaRenderer } from './panorama/renderer.ts';

export const EQUIPMENT_PREFIX = 'equipment:';

/** Internal hotspot appearance for equipment types without a sign (e.g. "FDC"). */
export interface SymbolAppearance {
  kind: 'symbol';
  text: string;
  category: EquipmentCategory;
}

function equipmentTitle(env: Environment, e: Equipment, lang: string): string {
  return localize(e.label ?? equipmentTypeInfo(env, e.typeId).name, lang);
}

/** What the equipment dialog says: type, tag, inspections, description. */
export function equipmentDetails(
  env: Environment,
  e: Equipment,
  lang: string,
  t: UiStrings,
): string {
  const info = equipmentTypeInfo(env, e.typeId);
  const lines: string[] = [];
  if (e.label) lines.push(localize(info.name, lang));
  if (e.tag) lines.push(`${t.tag} ${e.tag}`);
  if (e.lastInspection) lines.push(`${t.lastInspection} ${e.lastInspection}`);
  if (e.nextInspection) lines.push(`${t.nextInspection} ${e.nextInspection}`);
  const head = lines.join('\n');
  const body = e.description ? localize(e.description, lang) : '';
  return [head, body].filter(Boolean).join('\n\n');
}

/**
 * Equipment placed in a scene, as hotspots (id `equipment:<id>`): a sign, or a symbol
 * marker for types without one. Clicking opens the item's details.
 */
export function equipmentHotspots(
  env: Environment,
  sceneId: string,
  audience: string | null,
  lang: string,
  t: UiStrings,
): Hotspot[] {
  const out: Hotspot[] = [];
  for (const e of visibleEquipment(env, audience)) {
    const info = equipmentTypeInfo(env, e.typeId);
    const title = equipmentTitle(env, e, lang);
    for (const p of e.placements) {
      if (p.sceneId !== sceneId || p.position.kind !== 'spherical') continue;
      const appearance = info.sign
        ? { kind: 'safety-sign' as const, sign: info.sign, style: p.style }
        : ({
            kind: 'symbol',
            text: equipmentSymbol(info),
            category: info.category,
          } satisfies SymbolAppearance);
      out.push({
        id: `${EQUIPMENT_PREFIX}${e.id}`,
        sceneId,
        title: { [lang]: title },
        position: p.position,
        appearance: appearance as Hotspot['appearance'],
        actions: [
          {
            type: 'openPopup',
            title: { [lang]: title },
            content: { kind: 'text', body: { [lang]: equipmentDetails(env, e, lang, t) } },
          },
        ],
        audienceIds: [],
        hidden: false,
      });
    }
  }
  return out;
}

/** A square marker with a short code, coloured by category (fire red, others navy). */
export function createSymbol(a: SymbolAppearance, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `evx-symbol evx-symbol--${a.category}`;
  b.setAttribute('aria-label', label);
  b.textContent = a.text;
  return b;
}

// ------------------------------------------------------------------- routes in scenes

const CHEVRONS = 6;
// A white outline under the green stroke keeps the arrows readable on any floor.
const CHEVRON_SVG =
  '<svg viewBox="0 0 40 40" aria-hidden="true"><path class="evx-viewer__chevron-edge" d="M6 27 20 13l14 14"/><path class="evx-viewer__chevron-fill" d="M6 27 20 13l14 14"/></svg>';

export interface RouteView {
  route: Route;
  /** The other route offered one tap away. */
  alternative: Route | null;
}

/**
 * Chevrons on the floor leading the way out of the current scene, and the route banner
 * (route name, where it ends, the alternative route, the floor plan, close).
 */
export class RouteLayer {
  readonly el: HTMLDivElement;
  readonly banner: HTMLDivElement;
  private chevrons: HTMLElement[] = [];
  private heading: { yaw: number; pitch: number } | null = null;

  constructor(
    host: HTMLElement,
    private renderer: PanoramaRenderer,
    private actions: { alternative: () => void; plan: () => void; close: () => void },
  ) {
    this.el = document.createElement('div');
    this.el.className = 'evx-viewer__route-arrows';
    this.el.setAttribute('aria-hidden', 'true');
    this.banner = document.createElement('div');
    this.banner.className = 'evx-viewer__route';
    this.banner.setAttribute('role', 'region');
    this.banner.hidden = true;
    // Under the hotspots, so signs and buttons stay on top of the arrows.
    const hotspots = host.querySelector('.evx-viewer__hotspots');
    host.insertBefore(this.el, hotspots);
    host.append(this.banner);
  }

  /** Shows a route for a scene (or nothing). */
  set(
    view: RouteView | null,
    env: Environment,
    scene: Scene | null,
    lang: string,
    t: UiStrings,
    reducedMotion: boolean,
  ): void {
    this.el.classList.toggle('evx-viewer__route-arrows--still', reducedMotion);
    this.el.replaceChildren();
    this.chevrons = [];
    this.heading = view && scene ? routeHeading(view.route, scene.id) : null;
    this.banner.hidden = !view;
    if (!view) {
      this.banner.replaceChildren();
      return;
    }
    const r = view.route;
    this.el.dataset.routeId = r.id;
    this.el.dataset.priority = r.priority;
    if (this.heading)
      for (let i = 0; i < CHEVRONS; i++) {
        const c = document.createElement('span');
        c.className = 'evx-viewer__chevron';
        c.style.setProperty('--i', String(i));
        c.innerHTML = CHEVRON_SVG;
        this.el.append(c);
        this.chevrons.push(c);
      }

    const end = env.equipment.find((e) => e.id === r.assemblyPointId);
    const endName = end ? equipmentTitle(env, end, lang) : t.assemblyPoint;
    const atEnd = !!scene && !!end?.placements.some((p) => p.sceneId === scene.id);
    const name = localize(r.name, lang);
    this.banner.setAttribute('aria-label', t.evacuationRoute);
    this.banner.dataset.priority = r.priority;
    const title = document.createElement('p');
    title.className = 'evx-viewer__route-title';
    title.innerHTML = iconSvg('evac-route', { title: '' });
    const label = document.createElement('span');
    label.textContent = `${r.priority === 'primary' ? t.primaryRoute : t.secondaryRoute}: ${name}`;
    title.append(label);
    const hint = document.createElement('p');
    hint.className = 'evx-viewer__route-hint';
    hint.setAttribute('aria-live', 'polite');
    hint.textContent = atEnd ? t.reached(endName) : this.heading ? t.follow(endName) : t.offRoute;
    const buttons = document.createElement('div');
    buttons.className = 'evx-viewer__route-actions';
    const button = (text: string, fn: () => void, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `evx-viewer__route-button ${cls}`.trim();
      b.textContent = text;
      b.addEventListener('click', fn);
      buttons.append(b);
      return b;
    };
    if (view.alternative)
      button(
        view.alternative.priority === 'secondary' ? t.alternativeRoute : t.mainRoute,
        this.actions.alternative,
      ).dataset.routeId = view.alternative.id;
    button(t.floorPlan, this.actions.plan);
    button(t.closeRoute, this.actions.close, 'evx-viewer__route-close');
    this.banner.replaceChildren(title, hint, buttons);
    this.update();
  }

  /** Repositions the chevrons for the current camera (after each rendered frame). */
  update(): void {
    const h = this.heading;
    if (!h || !this.chevrons.length) return;
    // From near the reader's feet towards the heading, receding along the floor.
    const pts = this.chevrons.map((_, i) => {
      const pitch = -40 + ((h.pitch + 4 + 40) * i) / (CHEVRONS - 1);
      return this.renderer.project(h.yaw, pitch);
    });
    pts.forEach((p, i) => {
      const el = this.chevrons[i]!;
      if (!p) {
        el.style.visibility = 'hidden';
        return;
      }
      const next = pts[i + 1] ?? null;
      const prev = pts[i - 1] ?? null;
      const a = next ?? p;
      const b = next ? p : (prev ?? p);
      const angle = (Math.atan2(a.x - b.x, -(a.y - b.y)) * 180) / Math.PI;
      const scale = 1.25 - (0.6 * i) / (CHEVRONS - 1);
      el.style.visibility = '';
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) rotate(${angle.toFixed(1)}deg) scale(${scale.toFixed(2)})`;
    });
  }
}

// ------------------------------------------------------------------- floor plan view

export interface PlanViewOptions {
  env: Environment;
  floorId: string;
  lang: string;
  audience: string | null;
  t: UiStrings;
  scene: Scene | null;
  /** Current view yaw in the scene (for the "You are here" direction). */
  viewYaw: number;
  route: Route | null;
  resolve: (path: string) => string | null;
}

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;

/** Floors that have a plan, lowest first. */
export function planFloors(env: Environment): Floor[] {
  return allFloors(env)
    .filter((f) => f.plan)
    .sort((a, b) => a.level - b.level);
}

/** The floor plan dialog content, with its own floor switcher. */
export function planView(opts: PlanViewOptions): HTMLElement {
  const root = document.createElement('div');
  root.className = 'evx-viewer__plan-view';
  const render = (floorId: string) =>
    root.replaceChildren(...planContent({ ...opts, floorId }, render));
  render(opts.floorId);
  return root;
}

function planContent(o: PlanViewOptions, select: (floorId: string) => void): Node[] {
  const { env, lang, t } = o;
  const floors = planFloors(env);
  const floor = floors.find((f) => f.id === o.floorId) ?? floors[0];
  const nodes: Node[] = [];
  if (floors.length > 1) {
    const tabs = document.createElement('div');
    tabs.className = 'evx-viewer__plan-floors';
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', t.floors);
    for (const f of floors) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = localize(f.name, lang);
      b.setAttribute('aria-pressed', String(f.id === floor?.id));
      b.addEventListener('click', () => select(f.id));
      tabs.append(b);
    }
    nodes.push(tabs);
  }
  if (!floor?.plan) {
    const p = document.createElement('p');
    p.textContent = t.noPlan;
    return [...nodes, p];
  }
  const plan = floor.plan;
  const W = plan.widthPx;
  const H = plan.heightPx;
  const fig = document.createElement('figure');
  fig.className = 'evx-viewer__plan';
  fig.dataset.floorId = floor.id;
  fig.style.aspectRatio = `${W} / ${H}`;
  fig.style.setProperty('--evx-plan-ratio', String(W / H));
  const src = o.resolve(plan.image);
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    fig.append(img);
  }

  // Room names, route lines and the assembly point, in plan pixels.
  const svgParts: string[] = [];
  for (const z of env.zones.filter((z) => z.floorId === floor.id)) {
    const cx = z.polygon.reduce((s, p) => s + p.x, 0) / z.polygon.length;
    const cy = z.polygon.reduce((s, p) => s + p.y, 0) / z.polygon.length;
    svgParts.push(
      `<text class="evx-viewer__plan-zone" x="${cx}" y="${cy}" font-size="${W / 24}">${escapeXml(localize(z.name, lang))}</text>`,
    );
  }
  const routes = o.route ? [o.route] : [];
  for (const r of routes)
    for (const s of r.segments.filter((s) => s.floorId === floor.id))
      svgParts.push(
        `<polyline class="evx-viewer__plan-route evx-viewer__plan-route--${r.priority}" data-route-id="${escapeXml(r.id)}" points="${s.points.map((p) => `${p.x},${p.y}`).join(' ')}" stroke-width="${W / 110}"/>`,
      );
  fig.insertAdjacentHTML(
    'beforeend',
    `<svg class="evx-viewer__plan-svg" viewBox="0 0 ${W} ${H}" aria-hidden="true">${svgParts.join('')}</svg>`,
  );

  // Equipment: the same signs and symbols as in the panorama, with a legend.
  const legend = new Map<string, HTMLElement>();
  for (const e of visibleEquipment(env, o.audience)) {
    if (e.floorId !== floor.id || !e.planPosition) continue;
    const info = equipmentTypeInfo(env, e.typeId);
    const mark = document.createElement('span');
    mark.className = 'evx-viewer__plan-item';
    mark.dataset.equipmentId = e.id;
    mark.style.left = pct(e.planPosition.x, W);
    mark.style.top = pct(e.planPosition.y, H);
    mark.innerHTML = info.sign
      ? signSvg(info.sign, 'A', { title: equipmentTitle(env, e, lang) })
      : `<span class="evx-symbol evx-symbol--${info.category}" role="img" aria-label="${escapeXml(equipmentTitle(env, e, lang))}">${escapeXml(equipmentSymbol(info))}</span>`;
    fig.append(mark);
    if (!legend.has(info.id)) {
      const li = document.createElement('li');
      li.innerHTML = mark.innerHTML;
      const name = document.createElement('span');
      name.textContent = localize(info.name, lang);
      li.append(name);
      legend.set(info.id, li);
    }
  }

  // You are here: the current scene on this floor, facing where the reader looks.
  const s = o.scene;
  if (s?.floorId === floor.id && s.planPosition) {
    const here = document.createElement('span');
    here.className = 'evx-viewer__you-are-here';
    here.style.left = pct(s.planPosition.x, W);
    here.style.top = pct(s.planPosition.y, H);
    const facing = o.viewYaw - s.northOffsetDeg + plan.northDeg;
    here.style.setProperty('--facing', `${facing.toFixed(1)}deg`);
    here.innerHTML = `<span class="evx-viewer__you-are-here-cone"></span><span class="evx-viewer__you-are-here-dot"></span><span class="evx-viewer__you-are-here-label">${escapeXml(t.youAreHere)}</span>`;
    fig.append(here);
  }
  nodes.push(fig);

  const list = document.createElement('ul');
  list.className = 'evx-viewer__plan-legend';
  list.setAttribute('aria-label', t.legend);
  for (const r of routes) {
    const li = document.createElement('li');
    li.innerHTML = `<svg viewBox="0 0 40 12" aria-hidden="true"><line class="evx-viewer__plan-route evx-viewer__plan-route--${r.priority}" x1="2" y1="6" x2="38" y2="6" stroke-width="4"/></svg>`;
    const name = document.createElement('span');
    name.textContent = `${r.priority === 'primary' ? t.primaryRoute : t.secondaryRoute}: ${localize(r.name, lang)}`;
    li.append(name);
    list.append(li);
  }
  list.append(...legend.values());
  if (list.childElementCount) nodes.push(list);
  return nodes;
}
