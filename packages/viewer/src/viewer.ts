import type {
  Action,
  Environment,
  Hotspot,
  QuizQuestion,
  Route,
  Scene,
  TrainingModule,
  Transition,
} from '@evactis-3dworkflow/schema';
import {
  localize,
  parseEnvironment,
  routeHeading,
  routesForScene,
  SkinSchema,
  type SkinInput,
} from '@evactis-3dworkflow/schema';
import {
  AssetError,
  baseResolver,
  checkedResolver,
  resolveBase,
  type AssetResolver,
} from './assets.ts';
import { soundDirection, Sounds, type SoundState } from './audio.ts';
import { Controls } from './controls.ts';
import { Dialogs } from './dialogs.ts';
import { Training, type ModuleResult, type TrainingEvents } from './training.ts';
import { Emitter } from './events.ts';
import { HotspotLayer } from './hotspots.ts';
import { uiStrings } from './i18n.ts';
import { LiveLayers } from './live.ts';
import { clamp, easeInOut, lerp, wrapYaw, yawDelta } from './math.ts';
import { albumView, VideoBar } from './media.ts';
import { LuminanceMap } from './panorama/adaptive.ts';
import { PanoramaRenderer, type View } from './panorama/renderer.ts';
import { pdfView } from './pdf.ts';
import { Radar } from './radar.ts';
import { SkinChrome } from './skin.ts';
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
  /** Shows the floor-plan radar (corner mini-plan with the view cone). Default: false. */
  radar?: boolean;
  /**
   * Lays out the Viewer's interface (toolbar, logo, scene title, radar…) with a skin:
   * the environment's, `DEFAULT_SKIN`, or any other. Without one, the Viewer shows the
   * panorama and its hotspots only, for hosts that bring their own interface.
   */
  skin?: SkinInput | null;
  /** Kiosk deployment: the skin's kiosk layout (large touch targets, no full screen). */
  kiosk?: boolean;
}

export interface ViewerEvents extends Record<string, unknown>, TrainingEvents {
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
  /** A live layer changed state (e.g. normal → smoke). */
  livelayerchange: { layerId: string; stateId: string };
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
  private layers: LiveLayers;
  private sounds: Sounds;
  private caption: HTMLDivElement;
  private videoBar: VideoBar;
  private radar: Radar | null = null;
  private chrome: SkinChrome | null = null;
  private trainer: Training;
  private isMuted = false;
  private timedKey = '';
  private sceneLoad = 0;
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

    this.layers = new LiveLayers(() => this.environment);
    this.sounds = new Sounds(
      () => this.environment,
      (p) => this.resolve(p),
      () => this.updateCaption(),
    );
    this.renderer = new PanoramaRenderer(this.element, () => {
      this.hotspots.update();
      this.routes.update();
      const v = this.renderer.view;
      this.sounds.setView(v.yaw, v.pitch);
      this.radar?.setView(v.yaw, this.renderer.hfov);
      this.updateCaption();
      this.events.emit('viewchange', { ...v });
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
    this.trainer = new Training(this.trainingHost());
    this.live = document.createElement('div');
    this.live.className = 'evx-viewer__live';
    this.live.setAttribute('aria-live', 'polite');
    this.element.append(this.live);
    this.caption = document.createElement('div');
    this.caption.className = 'evx-viewer__caption';
    this.caption.hidden = true;
    this.element.append(this.caption);
    this.videoBar = new VideoBar(
      this.element,
      () => uiStrings(this.lang),
      () => this.refreshTimed(),
    );
    if (options.radar) this.ensureRadar();
    const refresh = () => this.chrome?.refresh();
    for (const e of [
      'scenechange',
      'routechange',
      'languagechange',
      'audiencechange',
      'livelayerchange',
      'modulestart',
      'moduleend',
    ] as const)
      this.events.on(e, refresh);
    this.events.on('languagechange', () => this.trainer.render());
    if (options.skin) this.setSkin(options.skin, options.kiosk);
    // Sound may only start after a gesture inside the page.
    const unlock = () => this.sounds.unlock();
    this.element.addEventListener('pointerdown', unlock);
    this.element.addEventListener('keydown', unlock);

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
      await this.renderer.show(this.layers.media(now.id, now.media), this.resolver);
      this.setView(view);
    }
    this.sceneExtras(now);
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
    if (this.scene) this.refreshRegions(this.scene);
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

  get muted(): boolean {
    return this.isMuted;
  }

  /** Starts a training module (its audience must match); a running one is left. */
  startModule(moduleId: string): Promise<void> {
    return this.trainer.start(moduleId);
  }

  /** Leaves the running module without results. */
  quitModule(): void {
    this.trainer.quit();
  }

  /** The module in progress, if any. */
  get training(): { moduleId: string; stepIndex: number } | null {
    return this.trainer.active;
  }

  /** Training modules this audience may take. */
  get modules(): TrainingModule[] {
    return this.trainer.available();
  }

  /** The start-module button: pick a module (or continue the one in progress). */
  showModules(): Promise<void> {
    return this.trainer.picker();
  }

  /** The checklist button: the running module's checklist. */
  showChecklist(): Promise<void> {
    return this.trainer.checklist();
  }

  /**
   * Replaces the skin (or removes it with null). Studio's skin designer uses this to
   * show edits live; `kiosk` picks the kiosk layout.
   */
  setSkin(skin: SkinInput | null, kiosk = !!this.options.kiosk): void {
    const parsed = skin ? SkinSchema.parse(skin) : null;
    this.chrome?.dispose();
    this.chrome = null;
    if (!parsed) return;
    if (parsed.elements.some((e) => e.type === 'radar')) this.ensureRadar();
    this.chrome = new SkinChrome(this.skinHost(), parsed, kiosk);
  }

  private ensureRadar() {
    if (this.radar) return;
    this.radar = new Radar(
      this.element,
      () => uiStrings(this.lang),
      (id) => void this.goToScene(id),
    );
    if (this.scene) {
      this.radar.set(this.environment, this.scene, this.scenes, this.lang, (p) => this.resolve(p));
      this.radar.setView(this.renderer.view.yaw, this.renderer.hfov);
    }
  }

  /** The skin laid out around the panorama, if any (breakpoint, commands). */
  get skinChrome(): SkinChrome | null {
    return this.chrome;
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.sounds.setMuted(muted);
    const v = this.renderer.video;
    if (v) v.muted = muted;
  }

  /** Live layers and their current states. */
  get liveLayers(): { layerId: string; stateId: string }[] {
    return this.layers.current.map(({ layer, stateId }) => ({ layerId: layer.id, stateId }));
  }

  /**
   * Switches a live layer (e.g. to smoke conditions). The current scene's look changes
   * at once; its panorama reloads only when the state captured a different one.
   */
  async setLiveLayer(layerId: string, stateId: string): Promise<void> {
    this.layers.set(layerId, stateId);
    const scene = this.scene;
    if (scene) {
      const media = this.layers.media(scene.id, scene.media);
      if (JSON.stringify(media) !== JSON.stringify(this.shownMedia)) {
        const view = this.getView();
        await this.renderer.show(media, this.resolver);
        this.shownMedia = media;
        this.setView(view);
      }
      this.sceneExtras(scene);
    }
    const layer = this.environment.liveLayers.find((l) => l.id === layerId)!;
    const state = layer.states.find((x) => x.id === stateId)!;
    this.live.textContent = uiStrings(this.lang).conditions(
      localize(layer.name, this.lang),
      localize(state.name, this.lang),
    );
    this.events.emit('livelayerchange', { layerId, stateId });
  }

  /** Sounds playing (or waiting for the first gesture), with their pan and gain. */
  get soundStates(): SoundState[] {
    return this.sounds.states;
  }

  /** The current scene's video (360° video scenes), for custom controls. */
  get video(): HTMLVideoElement | null {
    return this.renderer.video;
  }

  /** Adaptive HDR exposure shift in stops (0 for non-HDR scenes). */
  get exposureAdaptation(): number {
    return this.renderer.adaptation;
  }

  /** Animated regions shown in the current scene. */
  get regions(): string[] {
    return this.renderer.regionIds;
  }

  /** Resolves when nothing is loading or animating — useful for tests and screenshots. */
  async whenIdle(): Promise<void> {
    await this.navigating;
    await this.renderer.whenIdle();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.animation);
    this.sounds.dispose();
    this.chrome?.dispose();
    this.trainer.dispose();
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
          this.state.test(h.condition) &&
          this.inTime(h),
      ),
      ...equipmentHotspots(
        this.environment,
        this.scene.id,
        this.state.audience,
        this.lang,
        uiStrings(this.lang),
      ),
      ...this.trainer.hotspots(this.scene.id),
    ];
  }

  /** What training works through. */
  private trainingHost() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const v = this;
    return {
      get element() {
        return v.element;
      },
      get environment() {
        return v.environment;
      },
      get language() {
        return v.lang;
      },
      get audience() {
        return v.state.audience;
      },
      get sceneId() {
        return v.sceneId;
      },
      t: () => uiStrings(v.lang),
      inAudience: (ids: string[]) => v.state.inAudience(ids),
      goToScene: (id: string) => v.goToScene(id),
      showDialog: (title: string, content: Node[], modifier?: string) =>
        v.dialogs.show(title, content, modifier),
      closeDialog: () => v.dialogs.close(),
      ask: async (q: QuizQuestion) => {
        const answer = await v.dialogs.ask(q, v.lang);
        v.events.emit('answer', answer);
        return answer;
      },
      showRoute: (id: string) => v.showRoute(id),
      view: () => ({ yaw: v.renderer.view.yaw, pitch: v.renderer.view.pitch }),
      refreshHotspots: () => v.refreshHotspots(),
      emit: <K extends keyof TrainingEvents>(type: K, payload: TrainingEvents[K]) =>
        v.events.emit(type, payload as ViewerEvents[K]),
      certificate: (result: ModuleResult, name: string) => v.certificate(result, name),
    };
  }

  /** Builds the completion certificate on this device (lazily loaded) and saves it. */
  private async certificate(result: ModuleResult, name: string): Promise<void> {
    const { certificatePdf } = await import('./certificate.ts');
    const module = this.environment.modules.find((m) => m.id === result.moduleId)!;
    const bytes = await certificatePdf(this.environment, module, result, name);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${module.id}-certificate.pdf`;
    this.element.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** The narrow view of the Viewer that the skin works through. */
  private skinHost() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const v = this;
    return {
      get element() {
        return v.element;
      },
      get environment() {
        return v.environment;
      },
      get sceneId() {
        return v.sceneId;
      },
      get language() {
        return v.lang;
      },
      get audience() {
        return v.audience;
      },
      get scenes() {
        return v.scenes;
      },
      get muted() {
        return v.isMuted;
      },
      get radarElement() {
        return v.radar?.element ?? null;
      },
      get activeRouteId() {
        return v.route?.id ?? null;
      },
      get liveLayers() {
        return v.liveLayers;
      },
      t: () => uiStrings(v.lang),
      goToScene: (id: string) => v.goToScene(id),
      showFloorPlan: () => v.showFloorPlan(),
      toggleRoute: () => (v.route ? v.hideRoute() : void v.showRoute()),
      zoom: (f: number) => v.zoom(f),
      setMuted: (m: boolean) => v.setMuted(m),
      setLanguage: (l: string) => v.setLanguage(l),
      setAudience: (a: string | null) => v.setAudience(a),
      setLiveLayer: (l: string, st: string) => v.setLiveLayer(l, st),
      showDialog: (title: string, content: Node[], modifier?: string) =>
        v.dialogs.show(title, content, modifier),
      closeDialog: () => v.dialogs.close(),
      resolve: (p: string) => v.resolve(p),
      get trainingActive() {
        return v.trainer.active !== null;
      },
      showModules: () => v.showModules(),
      showChecklist: () => v.showChecklist(),
    };
  }

  /** Timed hotspots show while the scene's video is inside their time range. */
  private inTime(h: Hotspot): boolean {
    if (!h.timeRange || this.options.editing) return true;
    const v = this.renderer.video;
    if (!v) return false;
    return v.currentTime >= h.timeRange.start && v.currentTime < h.timeRange.end;
  }

  private refreshTimed() {
    const key = this.visibleHotspots()
      .filter((h) => h.timeRange)
      .map((h) => h.id)
      .join(',');
    if (key !== this.timedKey) {
      this.timedKey = key;
      this.refreshHotspots();
    }
  }

  private shownMedia: Scene['media'] | null = null;

  /**
   * Everything a scene shows besides its panorama: live-layer look, adaptive HDR,
   * animated regions, video controls, sounds and the radar.
   */
  private sceneExtras(scene: Scene) {
    const load = ++this.sceneLoad;
    this.renderer.instantAdaptation = this.reducedMotion;
    this.renderer.setGrade(this.layers.grade(scene.id));
    const media = this.shownMedia;
    const lum =
      media?.type === 'equirect' && media.hdr && media.luminance && this.resolve(media.luminance);
    if (lum)
      void LuminanceMap.load(lum).then(
        (map) => load === this.sceneLoad && this.renderer.setLuminance(map),
        () => load === this.sceneLoad && this.renderer.setLuminance(null),
      );
    else this.renderer.setLuminance(null);
    this.regionKey = null;
    this.refreshRegions(scene);
    this.videoBar.attach(this.renderer.video);
    this.timedKey = '';
    // Authoring: nothing starts playing by itself (sounds are previewed on request).
    if (!this.options.editing) this.sounds.enterScene(scene.id);
    this.radar?.set(this.environment, scene, this.scenes, this.lang, (p) => this.resolve(p));
    this.radar?.setView(this.renderer.view.yaw, this.renderer.hfov);
  }

  private regionKey: string | null = null;

  /** Animated regions of the scene whose condition holds (rebuilt only on change). */
  private refreshRegions(scene: Scene) {
    const regions = this.environment.animatedRegions.filter(
      (r) => r.sceneId === scene.id && this.state.test(r.condition),
    );
    const key = JSON.stringify(regions);
    if (key === this.regionKey) return;
    this.regionKey = key;
    this.renderer.setRegions(
      regions.flatMap((r) => {
        const src = this.resolve(r.source);
        if (!src) return [];
        const isVideo = /\.(webm|mp4|m4v|ogv)$/i.test(r.source);
        const el = isVideo ? document.createElement('video') : new Image();
        el.src = src;
        if (el instanceof HTMLVideoElement) {
          el.muted = true;
          el.playsInline = true;
          el.loop = r.loop;
          el.preload = 'auto';
          // Reduced motion: the region shows its first frame, still.
          if (!this.reducedMotion) void el.play().catch(() => undefined);
        }
        return [{ id: r.id, polygon: r.polygon, element: el }];
      }),
    );
  }

  /** Captions for sounds: what is playing and where it comes from. */
  private updateCaption() {
    if (!this.environment.settings.accessibility.captions) {
      this.caption.hidden = true;
      return;
    }
    const t = uiStrings(this.lang);
    const lines = this.sounds.states.map((st) => {
      const def = this.environment.audio.find((a) => a.id === st.id)!;
      const where =
        def.kind === 'spatial' && def.position
          ? t.directions[soundDirection(this.renderer.view.yaw, def.position.yaw)]
          : '';
      const name = localize(def.name, this.lang);
      return where ? t.sound(name, where) : name;
    });
    const text = lines.join(' · ');
    if (this.caption.textContent !== text) this.caption.textContent = text;
    this.caption.hidden = !text;
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
      const at = this.screenToView(x, y);
      this.events.emit('panoramaclick', { x, y, ...at });
      if (!this.options.editing) this.trainer.onPanoramaClick(at);
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
        const media = this.layers.media(scene.id, scene.media);
        await this.renderer.show(media, this.resolver);
        this.shownMedia = media;
        this.scene = scene;
        this.state.visited.add(scene.id);
        const v = { ...scene.initialView, ...opts.view };
        this.renderer.setView({ yaw: wrapYaw(v.yaw), pitch: v.pitch, fov: v.fov });
        this.sceneExtras(scene);
        this.refreshHotspots();
        this.refreshRoute();
        this.updateLabels();
      },
    );
    this.live.textContent = localize(scene.name, this.lang);
    this.events.emit('scenechange', { sceneId, previousSceneId: previous });
    if (!previous) this.events.emit('ready', { sceneId });
    if (!this.options.editing) this.trainer.onScene(sceneId);
  }

  private async activate(h: Hotspot) {
    this.events.emit('hotspotclick', { hotspotId: h.id });
    if (this.options.editing) return;
    this.trainer.onHotspot(h.id);
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
          if (src) nodes.push(pdfView(src, L(doc!.title), t));
        } else nodes.push(this.dialogs.text(t.unsupported));
        await this.dialogs.show(L(action.title), nodes);
        return;
      }
      case 'openDocument': {
        const doc = this.environment.documents.find((d) => d.id === action.documentId);
        const src = doc && this.resolve(doc.source);
        if (doc && src)
          await this.dialogs.show(
            L(doc.title),
            [pdfView(src, L(doc.title), t)],
            'evx-viewer__dialog--wide',
          );
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
      case 'playAudio':
        // A hotspot press is a gesture: sound may start now.
        this.sounds.unlock();
        await this.sounds.play(action.audioId, action.restart);
        return;
      case 'stopAudio':
        this.sounds.stop(action.audioId);
        return;
      case 'openAlbum': {
        const view = albumView(this.environment, action.albumId, action.start, this.lang, t, (p) =>
          this.resolve(p),
        );
        const album = this.environment.albums.find((a) => a.id === action.albumId);
        if (view && album)
          await this.dialogs.show(L(album.name), [view], 'evx-viewer__dialog--wide');
        return;
      }
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
      case 'setLiveLayer':
        await this.setLiveLayer(action.layerId, action.stateId);
        return;
      case 'startModule':
        await this.startModule(action.moduleId);
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
