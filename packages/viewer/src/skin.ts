import {
  buttonHtml,
  productLockupSvg,
  setButtonIcon,
  setButtonPressed,
  type IconName,
} from '@evactis-3dworkflow/brand';
import {
  ANCHORS,
  breakpointFor,
  localize,
  placementFor,
  SKIN_COMMANDS,
  type Anchor,
  type Breakpoint,
  type Environment,
  type Scene,
  type Skin,
  type SkinCommand,
  type SkinElement,
} from '@evactis-3dworkflow/schema';
import type { UiStrings } from './i18n.ts';
import { planFloors } from './safety.ts';

/** What the skin needs from the Viewer (kept narrow so the skin stays a layer on top). */
/** A delivery package's stamp (Phase 10). */
export interface PackageInfo {
  kind: string;
  createdAt: string;
  producer: string;
  /** Hex SHA-256 of the package manifest. */
  digest: string;
  /** A URL for the package's quick-start PDF. */
  quickStart?: () => Promise<string>;
}

export interface SkinHost {
  readonly element: HTMLElement;
  readonly environment: Environment;
  readonly sceneId: string | null;
  readonly language: string;
  readonly audience: string | null;
  readonly scenes: Scene[];
  readonly muted: boolean;
  readonly radarElement: HTMLElement | null;
  readonly activeRouteId: string | null;
  readonly liveLayers: { layerId: string; stateId: string }[];
  t(): UiStrings;
  goToScene(id: string): Promise<void>;
  showFloorPlan(): Promise<void>;
  toggleRoute(): void;
  zoom(factor: number): void;
  setMuted(muted: boolean): void;
  setLanguage(lang: string): void;
  setAudience(id: string | null): void;
  setLiveLayer(layerId: string, stateId: string): Promise<void>;
  showDialog(title: string, content: Node[], modifier?: string): Promise<void>;
  closeDialog(): void;
  resolve(path: string): Promise<string | null>;
  readonly trainingActive: boolean;
  showModules(): Promise<void>;
  showChecklist(): Promise<void>;
  /** Whether a VR headset session is possible here. */
  readonly vrAvailable: boolean;
  /** The delivery package this environment came in (stamp for the info panel). */
  readonly packageInfo: PackageInfo | null;
  enterVr(): Promise<void>;
}

const ICON: Record<SkinCommand, IconName> = {
  home: 'home',
  previous: 'previous',
  next: 'next',
  'floor-plan': 'floor-plan',
  'evac-route': 'evac-route',
  menu: 'menu',
  info: 'info',
  help: 'help',
  sound: 'sound-on',
  'zoom-in': 'zoom-in',
  'zoom-out': 'zoom-out',
  fullscreen: 'fullscreen',
  vr: 'vr',
  'start-module': 'start-module',
  checklist: 'checklist',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
};

/**
 * The Viewer's interface, laid out by a skin. Nine anchor slots cover the viewer;
 * elements stack in their slot in skin order. The breakpoint follows the viewer's own
 * width (not the window), so a skin previewed in a frame behaves as it will deployed.
 * Measured chrome edges are published as --evx-inset-* so the route banner, video bar
 * and captions keep clear of it.
 */
export class SkinChrome {
  readonly root = el('div', 'evx-skin');
  private slots = {} as Record<Anchor, HTMLDivElement>;
  private parts = new Map<string, HTMLElement>();
  private buttons = new Map<SkinCommand, HTMLButtonElement>();
  private bp: Breakpoint | null = null;
  private resize: ResizeObserver;
  private fullscreenHandler = () => this.refresh();

  constructor(
    private host: SkinHost,
    readonly skin: Skin,
    private kiosk: boolean,
  ) {
    this.root.dataset.skinId = skin.id;
    // Three rows (top, middle, bottom), each left / centre / right.
    for (let r = 0; r < 3; r++) {
      const row = el('div', `evx-skin__row-${['top', 'middle', 'bottom'][r]}`);
      for (const a of ANCHORS.slice(r * 3, r * 3 + 3)) {
        const slot = el('div', `evx-skin__slot evx-skin__slot--${a}`);
        slot.dataset.anchor = a;
        this.slots[a] = slot;
        row.append(slot);
      }
      this.root.append(row);
    }
    // Safety colours (ISO 7010 families) and the published insets are not themeable.
    for (const [k, v] of Object.entries(skin.tokens))
      if (!/^--evx-(safe|fire|warning|inset)-/.test(k)) this.host.element.style.setProperty(k, v);
    host.element.append(this.root);
    host.element.dataset.kiosk = String(kiosk);
    this.resize = new ResizeObserver(() => this.layout());
    this.resize.observe(host.element);
    document.addEventListener('fullscreenchange', this.fullscreenHandler);
    this.layout(true);
  }

  get breakpoint(): Breakpoint {
    return this.bp ?? 'desktop';
  }

  /** Re-lays out for the current width (only when the breakpoint changes, unless forced). */
  layout(force = false): void {
    const width = this.host.element.clientWidth || window.innerWidth;
    const bp = breakpointFor(this.skin, width, this.kiosk);
    if (bp !== this.bp || force) {
      this.bp = bp;
      this.root.dataset.breakpoint = bp;
      this.host.element.dataset.breakpoint = bp;
      for (const slot of Object.values(this.slots)) slot.replaceChildren();
      for (const e of this.skin.elements) this.place(e, bp);
      this.refresh();
    }
    this.measure();
  }

  private place(e: SkinElement, bp: Breakpoint) {
    const p = placementFor(e, bp);
    const node = this.part(e, p.buttons, p.orientation ?? 'horizontal');
    if (!node) return;
    node.hidden = p.hidden;
    node.dataset.skinElement = e.id;
    node.style.setProperty('--k', String(p.scale));
    // Insets from the anchor's edges.
    const [v, h] = p.anchor.includes('-') ? p.anchor.split('-') : [p.anchor, p.anchor];
    node.style.margin = '0';
    if (v === 'top') node.style.marginBlockStart = `${p.y}px`;
    if (v === 'bottom') node.style.marginBlockEnd = `${p.y}px`;
    if (h === 'left') node.style.marginInlineStart = `${p.x}px`;
    if (h === 'right') node.style.marginInlineEnd = `${p.x}px`;
    if (p.anchor === 'top' || p.anchor === 'bottom' || p.anchor === 'center')
      node.style.marginInline = `${p.x}px`;
    if (p.anchor === 'left' || p.anchor === 'right' || p.anchor === 'center')
      node.style.marginBlock = `${p.y}px`;
    this.slots[p.anchor].append(node);
  }

  /** Builds (or reuses) an element's DOM. */
  private part(
    e: SkinElement,
    buttons: SkinCommand[] | undefined,
    orientation: 'horizontal' | 'vertical',
  ) {
    switch (e.type) {
      case 'toolbar': {
        const bar = el('nav', 'evx-skin__toolbar');
        bar.dataset.orientation = orientation;
        bar.setAttribute('aria-label', this.host.t().toolbarLabel);
        this.buttons.clear();
        for (const c of (buttons ?? [...SKIN_COMMANDS]).filter((x) => this.available(x)))
          bar.append(this.button(c));
        this.parts.set(e.id, bar);
        return bar;
      }
      case 'logo':
        return this.reuse(e.id, () => this.logo());
      case 'title':
        return this.reuse(e.id, () => {
          const box = el('div', 'evx-skin__title');
          box.append(el('p', 'evx-skin__eyebrow'), el('h1', 'evx-skin__heading'));
          return box;
        });
      case 'language':
        return this.reuse(e.id, () => {
          const b = el('button', 'evx-skin__language');
          b.type = 'button';
          b.addEventListener('click', () => {
            const langs = this.host.environment.settings.languages;
            const next = langs[(langs.indexOf(this.host.language) + 1) % langs.length]!;
            this.host.setLanguage(next);
          });
          return b;
        });
      case 'radar':
        return this.reuse(e.id, () => {
          // The radar hides itself where a scene is not on a plan; the wrapper carries
          // the skin's placement.
          const wrap = el('div', 'evx-skin__radar');
          const r = this.host.radarElement;
          if (r) wrap.append(r);
          return wrap;
        });
    }
  }

  private reuse(id: string, make: () => HTMLElement) {
    let p = this.parts.get(id);
    if (!p) {
      p = make();
      this.parts.set(id, p);
    }
    return p;
  }

  /** Plate with the Evactis product lockup, and the client's logo when co-branded. */
  private logo() {
    const plate = el('div', 'evx-skin__logo');
    const b = this.host.environment.settings.branding;
    if (b.coBrand) {
      if (b.clientLogo) {
        const img = el('img', 'evx-skin__client');
        img.alt = b.clientName ? localize(b.clientName, this.host.language) : '';
        plate.append(img);
        void this.host.resolve(b.clientLogo).then((src) => (src ? (img.src = src) : img.remove()));
      } else if (b.clientName) {
        const name = el('span', 'evx-skin__client-name');
        name.textContent = localize(b.clientName, this.host.language);
        plate.append(name);
      }
      if (plate.childElementCount) plate.append(el('span', 'evx-skin__divider'));
    }
    const lockup = el('span', 'evx-skin__lockup');
    lockup.innerHTML = productLockupSvg({ title: 'EVACTIS 3DWORKFLOW' });
    plate.append(lockup);
    plate.dataset.cobrand = String(plate.childElementCount > 1);
    return plate;
  }

  private available(c: SkinCommand): boolean {
    switch (c) {
      case 'fullscreen':
        return !this.kiosk && !!document.fullscreenEnabled;
      // Shown only where the browser can start a headset session.
      case 'vr':
        return this.host.vrAvailable;
      case 'floor-plan':
        return planFloors(this.host.environment).length > 0;
      case 'evac-route':
        return this.host.environment.routes.length > 0;
      case 'start-module':
      case 'checklist':
        return this.host.environment.modules.length > 0;
      default:
        return true;
    }
  }

  private button(c: SkinCommand): HTMLButtonElement {
    const tpl = document.createElement('template');
    tpl.innerHTML = buttonHtml({ icon: ICON[c], lang: this.lang() });
    const b = tpl.content.firstElementChild as HTMLButtonElement;
    b.dataset.command = c;
    b.addEventListener('click', () => void this.run(c));
    this.buttons.set(c, b);
    return b;
  }

  private lang(): 'en' | 'fr' {
    return this.host.language.startsWith('fr') ? 'fr' : 'en';
  }

  /** Scene order for previous/next: the autopilot order if set, else the scene list. */
  private order(): string[] {
    const visible = new Set(this.host.scenes.map((s) => s.id));
    const ap = this.host.environment.autopilot?.sceneOrder ?? [];
    const ids = ap.length ? ap : this.host.scenes.map((s) => s.id);
    return ids.filter((id) => visible.has(id));
  }

  async run(c: SkinCommand): Promise<void> {
    const h = this.host;
    const order = this.order();
    const i = h.sceneId ? order.indexOf(h.sceneId) : -1;
    switch (c) {
      case 'home': {
        const first = h.environment.initialSceneId ?? order[0];
        if (first) await h.goToScene(first);
        return;
      }
      case 'previous':
        if (i > 0) await h.goToScene(order[i - 1]!);
        return;
      case 'next':
        if (i >= 0 && i < order.length - 1) await h.goToScene(order[i + 1]!);
        return;
      case 'floor-plan':
        await h.showFloorPlan();
        return;
      case 'evac-route':
        h.toggleRoute();
        return;
      case 'sound':
        h.setMuted(!h.muted);
        this.refresh();
        return;
      case 'zoom-in':
        h.zoom(1.25);
        return;
      case 'zoom-out':
        h.zoom(0.8);
        return;
      case 'fullscreen':
        if (document.fullscreenElement) await document.exitFullscreen();
        else await h.element.requestFullscreen?.().catch(() => undefined);
        return;
      case 'menu':
        await this.menu();
        return;
      case 'info':
        await this.info();
        return;
      case 'help':
        await this.help();
        return;
      case 'start-module':
        await h.showModules();
        return;
      case 'checklist':
        await h.showChecklist();
        return;
      case 'vr':
        await h.enterVr();
        return;
    }
  }

  /** Updates labels, pressed states and the title (scene, language, route changes). */
  refresh(): void {
    const h = this.host;
    const t = h.t();
    const lang = this.lang();
    for (const [c, b] of this.buttons) {
      if (c === 'sound') setButtonIcon(b, h.muted ? 'sound-off' : 'sound-on', lang);
      else if (c === 'fullscreen')
        setButtonIcon(b, document.fullscreenElement ? 'fullscreen-exit' : 'fullscreen', lang);
      else setButtonIcon(b, ICON[c], lang);
      if (c === 'evac-route') setButtonPressed(b, h.activeRouteId !== null);
      if (c === 'start-module') setButtonPressed(b, h.trainingActive);
      const order = this.order();
      const i = h.sceneId ? order.indexOf(h.sceneId) : -1;
      if (c === 'previous') b.disabled = i <= 0;
      if (c === 'next') b.disabled = i < 0 || i >= order.length - 1;
    }
    for (const [, p] of this.parts) {
      if (p.classList.contains('evx-skin__toolbar')) p.setAttribute('aria-label', t.toolbarLabel);
      if (p.classList.contains('evx-skin__language')) {
        const other = h.environment.settings.languages.find((l) => l !== h.language);
        if (!other) p.hidden = true;
        p.textContent = other ? other.toUpperCase() : '';
        p.setAttribute('aria-label', other?.startsWith('fr') ? 'Français' : 'English');
        p.lang = other ?? '';
      }
      if (p.classList.contains('evx-skin__title')) {
        const scene = h.environment.scenes.find((s) => s.id === h.sceneId);
        const floor = h.environment.buildings
          .flatMap((b) => b.floors)
          .find((f) => f.id === scene?.floorId);
        const eyebrow = p.firstElementChild as HTMLElement;
        eyebrow.textContent = floor
          ? localize(floor.name, h.language)
          : localize(h.environment.facility.name, h.language);
        (p.lastElementChild as HTMLElement).textContent = scene
          ? localize(scene.name, h.language)
          : '';
      }
    }
    this.measure();
  }

  /** Publishes how much of each edge the chrome covers. */
  private measure(): void {
    const box = this.host.element.getBoundingClientRect();
    if (!box.width) return;
    // CSS px of the viewer itself, also when it is shown scaled (Studio's device frames).
    const k = box.width / (this.host.element.offsetWidth || box.width);
    const edge = (anchors: Anchor[], side: 'top' | 'bottom' | 'left' | 'right') => {
      let v = 0;
      for (const a of anchors)
        for (const c of this.slots[a].children) {
          const r = (c as HTMLElement).getBoundingClientRect();
          if ((c as HTMLElement).hidden || !r.width) continue;
          const d =
            side === 'top'
              ? r.bottom - box.top
              : side === 'bottom'
                ? box.bottom - r.top
                : side === 'left'
                  ? r.right - box.left
                  : box.right - r.left;
          v = Math.max(v, d);
        }
      return Math.round(v / k);
    };
    const s = this.host.element.style;
    s.setProperty('--evx-inset-top', `${edge(['top-left', 'top', 'top-right'], 'top')}px`);
    s.setProperty(
      '--evx-inset-bottom',
      `${edge(['bottom-left', 'bottom', 'bottom-right'], 'bottom')}px`,
    );
    s.setProperty('--evx-inset-left', `${edge(['left'], 'left')}px`);
    s.setProperty('--evx-inset-right', `${edge(['right'], 'right')}px`);
  }

  // ---------------------------------------------------------------- panels

  private section(title: string, ...content: Node[]) {
    const s = el('section', 'evx-skin__section');
    const h = el('h3', 'evx-skin__section-title');
    h.textContent = title;
    s.append(h, ...content);
    return s;
  }

  /** Menu: places to go, settings, and the buttons the toolbar has no room for here. */
  private async menu() {
    const h = this.host;
    const t = h.t();
    const L = (x: Record<string, string>) => localize(x, h.language);
    const sections: Node[] = [];

    const floors = h.environment.buildings.flatMap((b) => b.floors);
    const groups = [
      ...floors.map((f) => ({
        name: L(f.name),
        scenes: h.scenes.filter((s) => s.floorId === f.id),
      })),
      {
        name: t.floorless,
        scenes: h.scenes.filter((s) => !floors.some((f) => f.id === s.floorId)),
      },
    ].filter((g) => g.scenes.length);
    const places = el('div', 'evx-skin__places');
    for (const g of groups) {
      const label = el('p', 'evx-skin__group');
      label.textContent = g.name;
      const list = el('ul', 'evx-skin__list');
      for (const s of g.scenes) {
        const li = el('li');
        const b = el('button', 'evx-skin__row');
        b.type = 'button';
        b.textContent = L(s.name);
        if (s.id === h.sceneId) {
          b.setAttribute('aria-current', 'true');
          const cur = el('span', 'evx-skin__current');
          cur.textContent = ` ${t.current}`;
          b.append(cur);
        }
        b.addEventListener('click', () => {
          h.closeDialog();
          void h.goToScene(s.id);
        });
        li.append(b);
        list.append(li);
      }
      places.append(label, list);
    }
    sections.push(this.section(t.goTo2, places));

    const settings: Node[] = [];
    const select = (
      label: string,
      options: [string, string][],
      value: string,
      onChange: (v: string) => void,
    ) => {
      const wrap = el('label', 'evx-skin__field');
      const span = el('span');
      span.textContent = label;
      const sel = el('select', 'evx-skin__select');
      for (const [v, l] of options) {
        const o = el('option');
        o.value = v;
        o.textContent = l;
        sel.append(o);
      }
      sel.value = value;
      sel.addEventListener('change', () => onChange(sel.value));
      wrap.append(span, sel);
      return wrap;
    };
    const langs = h.environment.settings.languages;
    if (langs.length > 1)
      settings.push(
        select(
          t.language,
          langs.map((l) => [
            l,
            l.startsWith('fr') ? 'Français' : l.startsWith('en') ? 'English' : l,
          ]),
          h.language,
          (v) => {
            h.setLanguage(v);
            h.closeDialog();
          },
        ),
      );
    if (!h.environment.settings.lockAudience && h.environment.audiences.length)
      settings.push(
        select(
          t.audience,
          h.environment.audiences.map((a) => [a.id, L(a.name)]),
          h.audience ?? '',
          (v) => h.setAudience(v || null),
        ),
      );
    for (const layer of h.environment.liveLayers)
      settings.push(
        select(
          L(layer.name),
          layer.states.map((s) => [s.id, L(s.name)]),
          h.liveLayers.find((x) => x.layerId === layer.id)?.stateId ?? layer.defaultStateId,
          (v) => void h.setLiveLayer(layer.id, v),
        ),
      );
    if (settings.length) sections.push(this.section(t.settings, ...settings));

    const shown = new Set(this.buttons.keys());
    const overflow = SKIN_COMMANDS.filter(
      (c) => c !== 'menu' && !shown.has(c) && this.available(c),
    );
    if (overflow.length) {
      const list = el('div', 'evx-skin__more');
      for (const c of overflow) {
        const b = el('button', 'evx-skin__row evx-skin__row--command');
        b.type = 'button';
        b.dataset.command = c;
        const tpl = document.createElement('template');
        tpl.innerHTML = buttonHtml({ icon: ICON[c], lang: this.lang() });
        const icon = tpl.content.firstElementChild as HTMLElement;
        const label = icon.getAttribute('aria-label') ?? c;
        icon.removeAttribute('aria-label');
        icon.setAttribute('aria-hidden', 'true');
        icon.tabIndex = -1;
        const text = el('span');
        text.textContent = label;
        b.append(icon, text);
        b.addEventListener('click', () => {
          h.closeDialog();
          void this.run(c);
        });
        list.append(b);
      }
      sections.push(this.section(t.more, list));
    }
    await h.showDialog(t.menu, sections, 'evx-viewer__dialog--menu');
  }

  private async info() {
    const h = this.host;
    const t = h.t();
    const L = (x: Record<string, string>) => localize(x, h.language);
    const nodes: Node[] = [];
    const facility = el('p', 'evx-skin__lead');
    facility.textContent = L(h.environment.facility.name);
    nodes.push(facility);
    const b = h.environment.settings.branding;
    const client = b.clientName ? L(b.clientName) : h.environment.facility.client;
    if (client) {
      const p = el('p');
      p.textContent = `${t.client}: ${client}`;
      nodes.push(p);
    }
    const offline = el('p', 'evx-skin__note');
    offline.setAttribute('role', 'note');
    offline.textContent = t.offlineNotice;
    const made = el('p', 'evx-skin__made');
    made.textContent = t.madeWith;
    nodes.push(offline, made);
    const pkg = h.packageInfo;
    if (pkg) {
      const stamp = el('p', 'evx-skin__made');
      stamp.dataset.package = pkg.kind;
      stamp.textContent = t.packageStamp(
        t.packageKinds[pkg.kind] ?? pkg.kind,
        pkg.createdAt.slice(0, 10),
        pkg.producer,
      );
      const id = el('p', 'evx-skin__made');
      // The start of the manifest's SHA-256: matches the delivery note if nothing changed.
      id.textContent = t.packageId(pkg.digest.slice(0, 16));
      nodes.push(stamp, id);
      if (pkg.quickStart) {
        const a = el('a', 'evx-cta evx-cta--ghost');
        a.textContent = t.quickStart;
        a.download = 'Quick start - Démarrage rapide.pdf';
        a.href = '#';
        const get = pkg.quickStart;
        a.addEventListener('click', (e) => {
          if (a.getAttribute('href') !== '#') return;
          e.preventDefault();
          void get().then((url) => {
            a.href = url;
            a.click();
          });
        });
        nodes.push(a);
      }
    }
    await h.showDialog(L(h.environment.title), nodes);
  }

  private async help() {
    const t = this.host.t();
    const list = el('ul', 'evx-bullets evx-skin__help');
    for (const item of t.helpItems) {
      const li = el('li');
      li.textContent = item;
      list.append(li);
    }
    await this.host.showDialog(t.helpTitle, [list]);
  }

  dispose(): void {
    this.resize.disconnect();
    document.removeEventListener('fullscreenchange', this.fullscreenHandler);
    // The radar belongs to the Viewer: hand it back before the chrome goes.
    const radar = this.host.radarElement;
    if (radar && this.root.contains(radar)) this.host.element.append(radar);
    const style = this.host.element.style;
    for (const k of Object.keys(this.skin.tokens)) style.removeProperty(k);
    for (const k of ['top', 'bottom', 'left', 'right']) style.removeProperty(`--evx-inset-${k}`);
    delete this.host.element.dataset.breakpoint;
    delete this.host.element.dataset.kiosk;
    this.root.remove();
  }
}
