import type {
  Action,
  Environment,
  Hotspot,
  Route,
  Scene,
  Transition,
} from '@evactis-3dworkflow/schema';
import {
  localize,
  parseEnvironment,
  routeHeading,
  routesForScene,
} from '@evactis-3dworkflow/schema';
import {
  AssetError,
  baseResolver,
  checkedResolver,
  resolveBase,
  type AssetResolver,
} from './assets.ts';
import { Controls } from './controls.ts';
import { Dialogs } from './dialogs.ts';
import { Emitter } from './events.ts';
import { HotspotLayer } from './hotspots.ts';
import { uiStrings } from './i18n.ts';
import { clamp, easeInOut, lerp, wrapYaw, yawDelta } from './math.ts';
import { PanoramaRenderer, type View } from './panorama/renderer.ts';
import { equipmentHotspots, planFloors, planView, RouteLayer } from './safety.ts';
import { ViewerState, type VarValue } from './state.ts';
import { runTransition } from './transitions.ts';

export type { View };

export interface ViewerOptions {
  /** Folder the environment's asset paths are relative to. Default: "./". Must be local. */
  baseUrl?: string;
  /** UI and content language. Default: the environment's default language. */
  language?: string;
  /** Audience ID. Default: settings.defaultAudienceId. */
  audience?: string;
  /** Scene to open first. Default: initialSceneId, else the first scene. */
  sceneId?: string;
  keyboard?: boolean;
  minFov?: number;
  maxFov?: number;
  /** Force reduced motion. Default: the environment setting, then the OS preference. */
  reducedMotion?: boolean;
  /**
   * Called for external URLs when the environment's offline-link policy allows them.
   * Return true if handled. Without it, external links are never opened.
   */
  onExternalUrl?: (url: string) => boolean;
  /**
   * Maps asset paths to URLs instead of `baseUrl` (e.g. Studio's desktop asset protocol).
   * Every URL it returns must still be local, or loading is refused.
   */
  resolveAsset?: (path: string) => string;
  /**
   * Authoring mode (Studio): clicking a hotspot selects it (emits `hotspotclick`) instead
   * of running its actions, and hotspots can be dragged (emits `hotspotmove`).
   */
  editing?: boolean;
}

export interface ViewerEvents extends Record<string, unknown> {
  ready: { sceneId: string };
  scenechange: { sceneId: string; previousSceneId: string | null };
  viewchange: View;
  hotspotclick: { hotspotId: string };
  /** A click (not a drag) on the panorama itself, with the direction under it. */
  panoramaclick: { x: number; y: number; yaw: number; pitch: number };
  /** Editing mode: a hotspot was dragged to a new direction. */
  hotspotmove: { hotspotId: string; yaw: number; pitch: number };
  /** Every action executed, including the ones the core delegates (floor plan, routes, modules…). */
  action: { action: Action; hotspotId: string | null };
  answer: { correct: boolean; choiceId: string | null; points: number };
  blocked: { url: string; reason: 'offline-policy' | 'invalid' };
  variablechange: { id: string; value: VarValue };
  audiencechange: { audience: string | null };
  languagechange: { language: string };
  error: { error: Error };
  /** An evacuation route was shown (or hidden: `routeId` null). */
  routechange: { routeId: string | null; priority: Route['priority'] | null };
  /** The floor plan was opened. */
  floorplan: { floorId: string };
}

export interface GoToOptions {
  transition?: Partial<Transition>;
  view?: Partial<View>;
  /** Screen point the transition moves towards (e.g. the clicked hotspot). */
  towards?: { x: number; y: number } | null;
}

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

/** Direction of a hotspot's centre (polygons: the vertex average). */
function hotspotCentre(h: Hotspot): { yaw: number; pitch: number } | null {
  const p = h.position;
  if (p.kind === 'spherical') return p;
  if (p.kind === 'polygon') {
    const n = p.points.length;
    const yaw0 = p.points[0]!.yaw;
    const yaw = yaw0 + p.points.reduce((s, q) => s + yawDelta(yaw0, q.yaw), 0) / n;
    return { yaw: wrapYaw(yaw), pitch: p.points.reduce((s, q) => s + q.pitch, 0) / n };
  }
  return null;
}

/**
 * EVACTIS 3DWORKFLOW Viewer. Create with `createViewer(element, environment, options)`.
 */
export class Viewer {
  environment: Environment;
  readonly element: HTMLElement;
  private events = new Emitter<ViewerEvents>((e) => this.fail(e));
  private renderer: PanoramaRenderer;
  private controls: Controls;
  private hotspots: HotspotLayer;
  private routes: RouteLayer;
  private route: Route | null = null;
  private dialogs: Dialogs;
  private overlay: HTMLDivElement;
  private live: HTMLDivElement;
  private resolver: AssetResolver;
  private selected: string | null = null;
  private state: ViewerState;
  private lang: string;
  private scene: Scene | null = null;
  private navigating: Promise<void> = Promise.resolve();
  private audio = new Map<string, HTMLAudioElement>();
  private animation = 0;
  private destroyed = false;
  private options: ViewerOptions;

  constructor(host: HTMLElement, environment: Environment, options: ViewerOptions = {}) {
    this.environment = environment;
    this.options = options;
    const s = environment.settings;
    this.lang = options.language ?? s.defaultLanguage;
    const audience = options.audience ?? s.defaultAudienceId ?? null;
    this.state = new ViewerState(
      environment,
      s.lockAudience ? (s.defaultAudienceId ?? null) : audience,
    );
    this.resolver = options.resolveAsset
      ? checkedResolver(options.resolveAsset)
      : baseResolver(resolveBase(options.baseUrl ?? './'));

    this.element = document.createElement('div');
    this.element.className = 'evx-viewer';
    this.element.tabIndex = 0;
    this.element.setAttribute('role', 'application');
    host.append(this.element);

    this.renderer = new PanoramaRenderer(this.element, () => {
      this.hotspots.update();
      this.routes.update();
      this.events.emit('viewchange', { ...this.renderer.view });
    });
    this.overlay = document.createElement('div');
    this.overlay.className = 'evx-viewer__overlay';
    this.element.append(this.overlay);
    this.hotspots = new HotspotLayer(
      this.element,
      this.renderer,
      (h) => void this.activate(h),
      (h) => {
        const c = hotspotCentre(h);
        if (c) void this.lookAt({ yaw: c.yaw, pitch: c.pitch }, 400);
      },
      options.editing
        ? (h, yaw, pitch) => this.events.emit('hotspotmove', { hotspotId: h.id, yaw, pitch })
        : null,
    );
    this.routes = new RouteLayer(this.element, this.renderer, {
      alternative: () => {
        const other = this.routeChoice().find((r) => r && r !== this.route);
        if (other) this.showRoute(other.id);
      },
      plan: () => void this.showFloorPlan(),
      close: () => this.hideRoute(),
    });
    this.dialogs = new Dialogs(this.element, () => uiStrings(this.lang));
    this.live = document.createElement('div');
    this.live.className = 'evx-viewer__live';
    this.live.setAttribute('aria-live', 'polite');
    this.element.append(this.live);

    this.controls = new Controls(
      this.element,
      () => this.renderer.view,
      (v) => this.renderer.setView(v),
      () => cancelAnimationFrame(this.animation),
      {
        keyboard: options.keyboard ?? true,
        minFov: options.minFov ?? 30,
        maxFov: options.maxFov ?? 110,
        reducedMotion: () => this.reducedMotion,
      },
    );
    this.updateLabels();
    this.watchClicks();
  }

  // ---------------------------------------------------------------- public API

  on<K extends keyof ViewerEvents>(type: K, fn: (payload: ViewerEvents[K]) => void): () => void {
    return this.events.on(type, fn);
  }

  off<K extends keyof ViewerEvents>(type: K, fn: (payload: ViewerEvents[K]) => void): void {
    this.events.off(type, fn);
  }

  get sceneId(): string | null {
    return this.scene?.id ?? null;
  }

  get language(): string {
    return this.lang;
  }

  get audience(): string | null {
    return this.state.audience;
  }

  get variables(): Record<string, VarValue> {
    return Object.fromEntries(this.state.variables);
  }

  get visitedScenes(): string[] {
    return [...this.state.visited];
  }

  /** Direction under a point of the viewer (CSS pixels from its top-left corner). */
  screenToView(x: number, y: number): { yaw: number; pitch: number } {
    const d = this.renderer.unproject(x, y);
    return { yaw: wrapYaw(d.yaw), pitch: clamp(d.pitch, -90, 90) };
  }

  /** Where a direction appears in the viewer (CSS pixels); null when behind the camera. */
  viewToScreen(yaw: number, pitch: number): { x: number; y: number } | null {
    return this.renderer.project(yaw, pitch);
  }

  /**
   * Replaces the environment in place (Studio edits): hotspots and labels refresh, and
   * the current scene's panorama reloads only if its media changed. Variables, visited
   * scenes and the view are kept.
   */
  async setEnvironment(environment: Environment): Promise<void> {
    const before = this.scene;
    this.environment = environment;
    const now = before && environment.scenes.find((s) => s.id === before.id);
    if (!now) {
      this.scene = null;
      const first = environment.initialSceneId ?? environment.scenes[0]?.id;
      if (first) await this.goToScene(first, { transition: { kind: 'cut' } });
      else this.refreshHotspots();
      return;
    }
    this.scene = now;
    if (JSON.stringify(now.media) !== JSON.stringify(before.media)) {
      const view = this.getView();
      await this.renderer.show(now.media, this.resolver);
      this.setView(view);
    }
    if (this.route) this.route = environment.routes.find((r) => r.id === this.route!.id) ?? null;
    this.refreshHotspots();
    this.refreshRoute();
    this.updateLabels();
  }

  /** Editing: highlights one hotspot (or none). */
  selectHotspot(id: string | null): void {
    this.selected = id;
    this.hotspots.select(id);
  }

  getView(): View {
    return { ...this.renderer.view };
  }

  setView(view: Partial<View>): void {
    const v = this.renderer.view;
    this.renderer.setView({
      yaw: wrapYaw(view.yaw ?? v.yaw),
      pitch: clamp(view.pitch ?? v.pitch, -90, 90),
      fov: clamp(view.fov ?? v.fov, this.options.minFov ?? 30, this.options.maxFov ?? 110),
    });
  }

  /** Animates the view; resolves when done. */
  lookAt(view: Partial<View>, durationMs = 600): Promise<void> {
    cancelAnimationFrame(this.animation);
    const from = this.getView();
    const to = { ...from, ...view };
    if (this.reducedMotion || durationMs <= 0) {
      this.setView(to);
      return Promise.resolve();
    }
    const dYaw = yawDelta(from.yaw, to.yaw);
    const start = performance.now();
    return new Promise((resolve) => {
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        const e = easeInOut(t);
        this.setView({
          yaw: from.yaw + dYaw * e,
          pitch: lerp(from.pitch, to.pitch, e),
          fov: lerp(from.fov, to.fov, e),
        });
        if (t < 1) this.animation = requestAnimationFrame(step);
        else resolve();
      };
      this.animation = requestAnimationFrame(step);
    });
  }

  zoom(factor: number): void {
    this.controls.zoom(factor);
  }

  /** Scenes the current audience may visit. */
  get scenes(): Scene[] {
    return this.environment.scenes.filter((s) => this.state.inAudience(s.audienceIds));
  }

  /** The evacuation route shown, if any. */
  get activeRoute(): Route | null {
    return this.route;
  }

  /**
   * Shows an evacuation route: the given one, or the nearest confirmed primary route
   * for the current scene (the evac-route button). Returns the route shown, or null
   * when no route applies (a message says so).
   */
  showRoute(routeId?: string): Route | null {
    const candidates = this.environment.routes.filter((r) => this.state.inAudience(r.audienceIds));
    const route = routeId
      ? (candidates.find((r) => r.id === routeId) ?? null)
      : (this.routeChoice()[0] ?? null);
    this.route = route;
    this.refreshRoute();
    // Face the way to walk, so the arrows are in front of the reader (not while authoring).
    const heading =
      route && this.scene && !this.options.editing && routeHeading(route, this.scene.id);
    if (heading) void this.lookAt({ yaw: heading.yaw, pitch: heading.pitch });
    if (!route && !routeId)
      void this.dialogs.show('', [this.dialogs.text(uiStrings(this.lang).noRoute)]);
    this.events.emit('routechange', {
      routeId: route?.id ?? null,
      priority: route?.priority ?? null,
    });
    return route;
  }

  hideRoute(): void {
    if (!this.route) return;
    this.route = null;
    this.refreshRoute();
    this.events.emit('routechange', { routeId: null, priority: null });
  }

  /** Opens the floor plan: the given floor, else the current scene's. */
  async showFloorPlan(floorId?: string): Promise<void> {
    const floors = planFloors(this.environment);
    const id = floorId ?? this.scene?.floorId ?? floors[0]?.id;
    const floor = floors.find((f) => f.id === id) ?? floors[0];
    const t = uiStrings(this.lang);
    if (!floor) {
      await this.dialogs.show(t.floorPlan, [this.dialogs.text(t.noPlan)]);
      return;
    }
    const content = planView({
      env: this.environment,
      floorId: floor.id,
      lang: this.lang,
      audience: this.state.audience,
      t,
      scene: this.scene,
      viewYaw: this.renderer.view.yaw,
      route: this.route ?? this.routeChoice()[0] ?? null,
      resolve: (p) => this.resolve(p),
    });
    this.events.emit('floorplan', { floorId: floor.id });
    await this.dialogs.show(t.floorPlan, [content], 'evx-viewer__dialog--plan');
  }

  /** Navigates to a scene. Navigations are serialised; resolves when the scene is shown. */
  goToScene(sceneId: string, opts: GoToOptions = {}): Promise<void> {
    this.navigating = this.navigating
      .then(() => this.navigate(sceneId, opts))
      .catch((e) => this.fail(e));
    return this.navigating;
  }

  setLanguage(lang: string): void {
    if (!this.environment.settings.languages.includes(lang))
      throw new Error(`Language "${lang}" is not enabled`);
    this.lang = lang;
    this.updateLabels();
    this.refreshHotspots();
    this.refreshRoute();
    this.events.emit('languagechange', { language: lang });
  }

  /** Switches audience; refused when the package locks it. */
  setAudience(audience: string | null): void {
    const s = this.environment.settings;
    if (s.lockAudience) throw new Error('The audience is locked in this package');
    if (audience !== null && !this.environment.audiences.some((a) => a.id === audience))
      throw new Error(`Unknown audience "${audience}"`);
    this.state.audience = audience;
    // A route the new audience may not see is closed.
    if (this.route && !this.state.inAudience(this.route.audienceIds)) this.hideRoute();
    this.refreshHotspots();
    this.refreshRoute();
    this.events.emit('audiencechange', { audience });
  }

  setVariable(id: string, value: VarValue): void {
    this.state.variables.set(id, value);
    this.refreshHotspots();
    this.events.emit('variablechange', { id, value });
  }

  /** Runs actions in order, as a hotspot would. */
  async runActions(
    actions: Action[],
    hotspotId: string | null = null,
    towards: { x: number; y: number } | null = null,
  ) {
    for (const action of actions) {
      if (this.destroyed) return;
      if (!this.state.test(action.condition)) continue;
      this.events.emit('action', { action, hotspotId });
      await this.run(action, towards);
    }
  }

  enableGyro(): Promise<boolean> {
    return this.controls.enableGyro();
  }

  disableGyro(): void {
    this.controls.disableGyro();
  }

  setMuted(muted: boolean): void {
    for (const a of this.audio.values()) a.muted = muted;
  }

  /** Resolves when nothing is loading or animating — useful for tests and screenshots. */
  async whenIdle(): Promise<void> {
    await this.navigating;
    await this.renderer.whenIdle();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.animation);
    for (const a of this.audio.values()) a.pause();
    this.audio.clear();
    this.controls.dispose();
    this.renderer.dispose();
    this.hotspots.dispose();
    this.dialogs.dispose();
    this.events.clear();
    this.element.remove();
  }

  // ---------------------------------------------------------------- internals

  get reducedMotion(): boolean {
    if (this.options.reducedMotion !== undefined) return this.options.reducedMotion;
    const pref = this.environment.settings.accessibility.reducedMotion;
    if (pref !== 'system') return pref === 'on';
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  private fail(e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    if (this.events) this.events.emit('error', { error });
  }

  private updateLabels() {
    const t = uiStrings(this.lang);
    this.element.setAttribute('aria-roledescription', t.panorama);
    this.element.setAttribute(
      'aria-label',
      this.scene ? localize(this.scene.name, this.lang) : t.panorama,
    );
    this.element.lang = this.lang;
  }

  private visibleHotspots(): Hotspot[] {
    if (!this.scene) return [];
    return [
      ...this.environment.hotspots.filter(
        (h) =>
          h.sceneId === this.scene!.id &&
          (this.state.visibility.get(h.id) ?? !h.hidden) &&
          this.state.inAudience(h.audienceIds) &&
          this.state.test(h.condition),
      ),
      ...equipmentHotspots(
        this.environment,
        this.scene.id,
        this.state.audience,
        this.lang,
        uiStrings(this.lang),
      ),
    ];
  }

  /** [nearest primary, alternative] for the current scene; Studio previews drafts too. */
  private routeChoice(): (Route | null)[] {
    if (!this.scene) return [];
    const c = routesForScene(this.environment, this.scene.id, this.state.audience, {
      includeUnconfirmed: this.options.editing,
    });
    const active = this.route;
    if (active && active === c.secondary) return [c.secondary, c.primary];
    return [c.primary, c.secondary];
  }

  private refreshRoute() {
    const r = this.route;
    const alternative = r ? (this.routeChoice().find((x) => x && x !== r) ?? null) : null;
    this.routes.set(
      r ? { route: r, alternative } : null,
      this.environment,
      this.scene,
      this.lang,
      uiStrings(this.lang),
      this.reducedMotion,
    );
  }

  private refreshHotspots() {
    this.hotspots.set(this.visibleHotspots(), this.lang);
    this.hotspots.select(this.selected);
  }

  /** Emits `panoramaclick` for a press and release that did not move (not a drag). */
  private watchClicks() {
    let down: { x: number; y: number; t: number } | null = null;
    this.element.addEventListener('pointerdown', (e) => {
      down = e.isPrimary ? { x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
    });
    this.element.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (!d || !e.isPrimary || !this.scene) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || e.timeStamp - d.t > 600) return;
      const target = e.target as Element | null;
      if (target?.closest('.evx-viewer__hotspot, .evx-viewer__area, dialog')) return;
      const r = this.element.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      this.events.emit('panoramaclick', { x, y, ...this.screenToView(x, y) });
    });
  }

  private async navigate(sceneId: string, opts: GoToOptions) {
    const scene = this.environment.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new Error(`Unknown scene "${sceneId}"`);
    if (!this.state.inAudience(scene.audienceIds))
      throw new Error(`Scene "${sceneId}" is not available to this audience`);
    const previous = this.scene?.id ?? null;
    const transition: Transition = {
      kind: opts.transition?.kind ?? (previous ? 'fade' : 'cut'),
      durationMs: opts.transition?.durationMs ?? 800,
    };
    const snapshot = previous && transition.kind !== 'cut' ? this.renderer.snapshot() : null;
    await runTransition(
      this.overlay,
      snapshot,
      transition,
      this.reducedMotion,
      opts.towards ?? null,
      async () => {
        await this.renderer.show(scene.media, this.resolver);
        this.scene = scene;
        this.state.visited.add(scene.id);
        const v = { ...scene.initialView, ...opts.view };
        this.renderer.setView({ yaw: wrapYaw(v.yaw), pitch: v.pitch, fov: v.fov });
        this.refreshHotspots();
        this.refreshRoute();
        this.updateLabels();
      },
    );
    this.live.textContent = localize(scene.name, this.lang);
    this.events.emit('scenechange', { sceneId, previousSceneId: previous });
    if (!previous) this.events.emit('ready', { sceneId });
  }

  private async activate(h: Hotspot) {
    this.events.emit('hotspotclick', { hotspotId: h.id });
    if (this.options.editing) return;
    const el = this.element.querySelector(`[data-hotspot-id="${CSS.escape(h.id)}"]`);
    const r = el?.getBoundingClientRect();
    const host = this.element.getBoundingClientRect();
    const towards = r
      ? { x: r.left + r.width / 2 - host.left, y: r.top + r.height / 2 - host.top }
      : null;
    await this.runActions(h.actions, h.id, towards);
  }

  private resolve(path: string): string | null {
    try {
      return this.resolver(path);
    } catch (e) {
      if (e instanceof AssetError) {
        this.events.emit('blocked', { url: path, reason: 'invalid' });
        return null;
      }
      throw e;
    }
  }

  private async run(action: Action, towards: { x: number; y: number } | null): Promise<void> {
    const L = (t: Record<string, string> | undefined) => localize(t, this.lang);
    const t = uiStrings(this.lang);
    switch (action.type) {
      case 'goToScene':
        await this.goToScene(action.sceneId, {
          transition: action.transition,
          view: action.view,
          towards,
        });
        return;
      case 'lookAt':
        await this.lookAt(action.view);
        return;
      case 'openPopup': {
        const c = action.content;
        const nodes: Node[] = [];
        if (c.kind === 'text')
          nodes.push(
            ...L(c.body)
              .split(/\n{2,}/)
              .map((p) => this.dialogs.text(p)),
          );
        else if (c.kind === 'image') {
          const src = this.resolve(c.source);
          if (src) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = L(c.alt);
            img.className = 'evx-viewer__media';
            nodes.push(img);
          }
        } else if (c.kind === 'video') {
          const src = this.resolve(c.source);
          if (src) {
            const v = document.createElement('video');
            v.src = src;
            v.controls = true;
            v.className = 'evx-viewer__media';
            nodes.push(v);
          }
        } else if (c.kind === 'pdf') {
          const doc = this.environment.documents.find((d) => d.id === c.documentId);
          const src = doc && this.resolve(doc.source);
          if (src) nodes.push(this.frame(src, L(doc!.title)));
        } else nodes.push(this.dialogs.text(t.unsupported));
        await this.dialogs.show(L(action.title), nodes);
        return;
      }
      case 'openDocument': {
        const doc = this.environment.documents.find((d) => d.id === action.documentId);
        const src = doc && this.resolve(doc.source);
        if (doc && src) await this.dialogs.show(L(doc.title), [this.frame(src, L(doc.title))]);
        return;
      }
      case 'openUrl': {
        const url = action.url.trim();
        if (EXTERNAL.test(url)) {
          const allowed = this.environment.settings.offlineLinkPolicy === 'allow-external';
          if (!allowed || !this.options.onExternalUrl?.(url)) {
            this.events.emit('blocked', { url, reason: 'offline-policy' });
            await this.dialogs.show('', [this.dialogs.text(t.blockedLink)]);
          }
          return;
        }
        const src = this.resolve(url);
        if (src) await this.dialogs.show('', [this.frame(src, url, true)]);
        return;
      }
      case 'playAudio': {
        const def = this.environment.audio.find((a) => a.id === action.audioId);
        if (!def) return;
        let el = this.audio.get(def.id);
        if (!el) {
          const src = this.resolve(def.source);
          if (!src) return;
          el = new Audio(src);
          el.loop = def.loop;
          el.volume = def.volume;
          this.audio.set(def.id, el);
        }
        if (action.restart) el.currentTime = 0;
        await el.play().catch(() => undefined);
        return;
      }
      case 'stopAudio':
        this.audio.get(action.audioId)?.pause();
        return;
      case 'setVisibility':
        for (const id of action.targetIds) {
          const h = this.environment.hotspots.find((x) => x.id === id);
          const cur = this.state.visibility.get(id) ?? !(h?.hidden ?? false);
          this.state.visibility.set(id, action.visible === 'toggle' ? !cur : action.visible);
        }
        this.refreshHotspots();
        return;
      case 'setVariable': {
        const cur = this.state.variables.get(action.variable);
        const value =
          action.op === 'toggle'
            ? !cur
            : action.op === 'add'
              ? Number(cur ?? 0) + Number(action.value ?? 1)
              : (action.value ?? true);
        this.setVariable(action.variable, value);
        return;
      }
      case 'askQuestion': {
        const answer = await this.dialogs.ask(action.question, this.lang);
        this.events.emit('answer', answer);
        return;
      }
      // Delegated to later modules (floor plan, routes, training, live layers) through
      // the 'action' event already emitted above.
      case 'showFloorPlan':
        await this.showFloorPlan(action.floorId);
        return;
      case 'showRoute':
        this.showRoute(action.routeId);
        return;
      case 'startModule':
      case 'setLiveLayer':
        return;
    }
  }

  /**
   * Frames a local package file. Documents (PDF) need the browser's built-in viewer, so
   * they are not sandboxed; other local files linked by URL get a script-free sandbox.
   */
  private frame(src: string, title: string, sandbox = false): HTMLElement {
    const f = document.createElement('iframe');
    f.src = src;
    f.title = title;
    f.className = 'evx-viewer__frame';
    if (sandbox) f.setAttribute('sandbox', 'allow-same-origin');
    f.referrerPolicy = 'no-referrer';
    return f;
  }
}

/**
 * Creates a Viewer in `element` for an environment (a validated `Environment` or raw
 * JSON, which is migrated and validated first). Opens the initial scene.
 */
export async function createViewer(
  element: HTMLElement,
  environment: Environment | unknown,
  options: ViewerOptions = {},
): Promise<Viewer> {
  const parsed = parseEnvironment(environment);
  if (!parsed.success) throw parsed.error;
  const env = parsed.environment;
  const viewer = new Viewer(element, env, options);
  const first = options.sceneId ?? env.initialSceneId ?? viewer.scenes[0]?.id;
  if (!first) throw new Error('The environment has no scene this audience can view');
  let failure: Error | null = null;
  const stop = viewer.on('error', ({ error }) => (failure = error));
  await viewer.goToScene(first, { transition: { kind: 'cut' } });
  stop();
  if (!viewer.sceneId) {
    viewer.destroy();
    throw failure ?? new Error(`Could not open scene "${first}"`);
  }
  return viewer;
}
