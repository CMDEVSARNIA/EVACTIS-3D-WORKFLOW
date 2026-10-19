/**
 * Editing operations on a draft environment (see store.ts). Each keeps the document
 * valid: IDs unique, references pointing at things that exist. Removing something
 * that safety content (equipment, routes) or training logic still uses is refused with
 * an `InUseError` rather than silently editing that content.
 *
 * Run them through `DocumentStore.edit`: a refused operation may leave its draft
 * half-edited, and the store discards drafts whose edit threw.
 */
import {
  checkReferences,
  type Action,
  type Environment,
  type Floor,
  type Hotspot,
  type LocalizedText,
  type PlanPoint,
  type Scene,
  type SceneMedia,
  type Spherical,
  type View,
} from '@evactis-3dworkflow/schema';
import type { AssetRecord } from '../api.ts';

export class InUseError extends Error {
  constructor(readonly uses: string[]) {
    super(`still used: ${uses.join('; ')}`);
  }
}

export class EditError extends Error {}

/** Degrees wrapped to [-180, 180). */
export function wrapDeg(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/** A schema ID derived from `base`, unique among `taken`. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug =
    base
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item';
  if (!used.has(slug)) return slug;
  for (let n = 2; ; n++) if (!used.has(`${slug}-${n}`)) return `${slug}-${n}`;
}

const text = (s: string): LocalizedText => ({ en: s, fr: s });

const allIds = (env: Environment) => [
  ...env.scenes.map((s) => s.id),
  ...env.hotspots.map((h) => h.id),
  ...env.buildings.flatMap((b) => [b.id, ...b.floors.map((f) => f.id)]),
];

/** Fails (leaving the document unchanged, see store.edit) if a removal left dangling references. */
function assertNoDanglingReferences(env: Environment) {
  const issues = checkReferences(env);
  if (issues.length) throw new InUseError(issues.map((i) => `${i.path.join('.')}: ${i.message}`));
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

/** Scene media for a library asset; floor plans are not scenes. */
export function sceneMedia(asset: AssetRecord): SceneMedia {
  switch (asset.kind) {
    case 'panorama':
      return {
        type: 'equirect',
        source: asset.source,
        ...(asset.preview && { preview: asset.preview }),
        ...(asset.tiles && {
          tiles: { ...asset.tiles, format: asset.tiles.format as 'jpg' | 'webp' | 'png' },
        }),
        hdr: asset.hdr,
      };
    case 'panorama-stereo':
      return {
        type: 'equirect-stereo',
        source: asset.source,
        layout: asset.layout === 'stereo-side-by-side' ? 'side-by-side' : 'top-bottom',
        ...(asset.preview && { preview: asset.preview }),
      };
    case 'video360':
      return {
        type: 'video360',
        source: asset.playback ?? asset.source,
        ...(asset.preview && { poster: asset.preview }),
        loop: true,
        stereo:
          asset.layout === 'stereo-top-bottom'
            ? 'top-bottom'
            : asset.layout === 'stereo-side-by-side'
              ? 'side-by-side'
              : 'mono',
      };
    case 'glb':
      return { type: 'glb', source: asset.source };
    case 'splat':
      return {
        type: 'splat',
        source: asset.source,
        format: (asset.splatFormat ?? 'ply') as 'ply' | 'splat' | 'ksplat' | 'spz',
      };
    case 'floor-plan':
      throw new EditError('a floor plan cannot be a scene');
  }
}

/** Adds a scene for a library asset; the first scene becomes the start scene. */
export function addScene(env: Environment, asset: AssetRecord, name = asset.name): string {
  const id = uniqueId(name, allIds(env));
  const scene: Scene = {
    id,
    name: text(name),
    media: sceneMedia(asset),
    ...(asset.thumbnail && { thumbnail: asset.thumbnail }),
    initialView: { yaw: 0, pitch: 0, fov: 90 },
    northOffsetDeg: 0,
    ...(asset.capture.captureDate && { captureDate: asset.capture.captureDate }),
    ...(asset.capture.gps && { gps: asset.capture.gps }),
    audienceIds: [],
  };
  env.scenes.push(scene);
  env.initialSceneId ??= id;
  return id;
}

export function scene(env: Environment, id: string): Scene {
  const s = env.scenes.find((x) => x.id === id);
  if (!s) throw new EditError(`unknown scene ${id}`);
  return s;
}

export function renameScene(env: Environment, id: string, lang: string, name: string) {
  scene(env, id).name[lang] = name;
}

export function setInitialView(env: Environment, id: string, view: View) {
  scene(env, id).initialView = {
    yaw: round(wrapDeg(view.yaw)),
    pitch: round(Math.max(-90, Math.min(90, view.pitch))),
    fov: round(Math.max(10, Math.min(140, view.fov))),
  };
}

/** North lies at `yaw` in this panorama (the author faces north and clicks "Set north"). */
export function setNorth(env: Environment, id: string, yaw: number) {
  scene(env, id).northOffsetDeg = round(wrapDeg(yaw));
}

export function setStartScene(env: Environment, id: string) {
  scene(env, id);
  env.initialSceneId = id;
}

export function moveScene(env: Environment, id: string, to: number) {
  const from = env.scenes.findIndex((s) => s.id === id);
  if (from < 0) throw new EditError(`unknown scene ${id}`);
  const [s] = env.scenes.splice(from, 1);
  env.scenes.splice(Math.max(0, Math.min(env.scenes.length, to)), 0, s!);
}

/**
 * Removes a scene with its hotspots and every link to it. Refused when equipment,
 * routes, training or conditions still use it.
 */
export function removeScene(env: Environment, id: string) {
  scene(env, id);
  env.scenes = env.scenes.filter((s) => s.id !== id);
  const removedHotspots = new Set(env.hotspots.filter((h) => h.sceneId === id).map((h) => h.id));
  env.hotspots = env.hotspots.filter((h) => h.sceneId !== id);
  for (const h of env.hotspots)
    h.actions = h.actions.filter((a) => !(a.type === 'goToScene' && a.sceneId === id));
  pruneVisibilityTargets(env, removedHotspots);
  if (env.initialSceneId === id) env.initialSceneId = env.scenes[0]?.id;
  if (env.initialSceneId === undefined) delete env.initialSceneId;
  if (env.autopilot) env.autopilot.sceneOrder = env.autopilot.sceneOrder.filter((s) => s !== id);
  for (const a of env.audio) a.sceneIds = a.sceneIds.filter((s) => s !== id);
  for (const l of env.liveLayers) l.overrides = l.overrides.filter((o) => o.sceneId !== id);
  env.animatedRegions = env.animatedRegions.filter((r) => r.sceneId !== id);
  assertNoDanglingReferences(env);
}

// ---------------------------------------------------------------------------
// Hotspots
// ---------------------------------------------------------------------------

export type HotspotKind = 'link' | 'info';

export function hotspot(env: Environment, id: string): Hotspot {
  const h = env.hotspots.find((x) => x.id === id);
  if (!h) throw new EditError(`unknown hotspot ${id}`);
  return h;
}

export function goTo(sceneId: string): Action {
  return { type: 'goToScene', sceneId, transition: { kind: 'fade', durationMs: 800 } };
}

/**
 * Adds a hotspot at `at` in a scene. A link goes to `target` (if given); an info
 * hotspot opens a text popup the author fills in.
 */
export function addHotspot(
  env: Environment,
  sceneId: string,
  at: Spherical,
  kind: HotspotKind,
  options: { target?: string; title?: LocalizedText } = {},
): string {
  scene(env, sceneId);
  const id = uniqueId(`${sceneId}-${kind}`, allIds(env));
  const target = options.target ? scene(env, options.target) : undefined;
  const title =
    options.title ??
    (target
      ? { ...target.name }
      : kind === 'link'
        ? { en: 'Go to…', fr: 'Aller à…' }
        : { en: 'Information', fr: 'Information' });
  env.hotspots.push({
    id,
    sceneId,
    title,
    position: {
      kind: 'spherical',
      yaw: round(wrapDeg(at.yaw)),
      pitch: round(Math.max(-90, Math.min(90, at.pitch))),
    },
    appearance:
      kind === 'link' ? { kind: 'button', icon: 'next' } : { kind: 'marker', marker: 'info' },
    actions:
      kind === 'link'
        ? target
          ? [goTo(target.id)]
          : []
        : [
            {
              type: 'openPopup',
              title: { ...title },
              content: { kind: 'text', body: { en: '', fr: '' } },
            },
          ],
    audienceIds: [],
    hidden: false,
  });
  return id;
}

export function moveHotspot(env: Environment, id: string, at: Spherical) {
  const h = hotspot(env, id);
  if (h.position.kind !== 'spherical')
    throw new EditError('only spherical hotspots can be dragged');
  h.position = {
    kind: 'spherical',
    yaw: round(wrapDeg(at.yaw)),
    pitch: round(Math.max(-90, Math.min(90, at.pitch))),
  };
}

export function setHotspotTitle(env: Environment, id: string, lang: string, title: string) {
  hotspot(env, id).title[lang] = title;
}

export function setHotspotAppearance(
  env: Environment,
  id: string,
  appearance: Hotspot['appearance'],
) {
  hotspot(env, id).appearance = appearance;
}

/** Replaces a hotspot's actions; refused if one points at something that does not exist. */
export function setActions(env: Environment, id: string, actions: Action[]) {
  const h = hotspot(env, id);
  const before = h.actions;
  h.actions = actions;
  try {
    assertNoDanglingReferences(env);
  } catch (e) {
    h.actions = before;
    throw e;
  }
}

function pruneVisibilityTargets(env: Environment, removed: Set<string>) {
  if (!removed.size) return;
  for (const h of env.hotspots)
    h.actions = h.actions.flatMap((a): Action[] => {
      if (a.type !== 'setVisibility') return [a];
      const targetIds = a.targetIds.filter((t) => !removed.has(t));
      return targetIds.length ? [{ ...a, targetIds }] : [];
    });
}

export function removeHotspot(env: Environment, id: string) {
  hotspot(env, id);
  env.hotspots = env.hotspots.filter((h) => h.id !== id);
  pruneVisibilityTargets(env, new Set([id]));
  assertNoDanglingReferences(env);
}

/** Scenes this scene already links to (goToScene actions on its hotspots). */
export function linkedScenes(env: Environment, sceneId: string): Set<string> {
  const out = new Set<string>();
  for (const h of env.hotspots)
    if (h.sceneId === sceneId)
      for (const a of h.actions) if (a.type === 'goToScene') out.add(a.sceneId);
  return out;
}

// ---------------------------------------------------------------------------
// Buildings, floors and plans
// ---------------------------------------------------------------------------

export function addBuilding(env: Environment, name: LocalizedText): string {
  const id = uniqueId(name.en ?? Object.values(name)[0] ?? 'building', allIds(env));
  env.buildings.push({ id, name, floors: [] });
  return id;
}

export function addFloor(
  env: Environment,
  buildingId: string,
  name: LocalizedText,
  level: number,
): string {
  const b = env.buildings.find((x) => x.id === buildingId);
  if (!b) throw new EditError(`unknown building ${buildingId}`);
  const id = uniqueId(name.en ?? Object.values(name)[0] ?? 'floor', allIds(env));
  b.floors.push({ id, name, level: Math.round(level) });
  b.floors.sort((x, y) => x.level - y.level);
  return id;
}

export function floor(env: Environment, id: string): Floor {
  for (const b of env.buildings) {
    const f = b.floors.find((x) => x.id === id);
    if (f) return f;
  }
  throw new EditError(`unknown floor ${id}`);
}

export function updateFloor(
  env: Environment,
  id: string,
  patch: { name?: LocalizedText; level?: number },
) {
  const f = floor(env, id);
  if (patch.name) f.name = patch.name;
  if (patch.level !== undefined) f.level = Math.round(patch.level);
  for (const b of env.buildings) b.floors.sort((x, y) => x.level - y.level);
}

/**
 * Sets a floor's plan image from an imported floor plan. When an earlier plan is
 * replaced, scene positions and the calibration are scaled to the new image size, so
 * a sharper scan of the same plan keeps everything in place.
 */
export function setFloorPlan(env: Environment, floorId: string, asset: AssetRecord) {
  if (asset.kind !== 'floor-plan' || !asset.preview || !asset.width || !asset.height)
    throw new EditError('not a floor plan');
  const f = floor(env, floorId);
  const old = f.plan;
  const sx = old ? asset.width / old.widthPx : 1;
  const sy = old ? asset.height / old.heightPx : 1;
  const scale = (p: PlanPoint): PlanPoint => ({ x: round(p.x * sx, 1), y: round(p.y * sy, 1) });
  f.plan = {
    image: asset.preview,
    format: 'raster',
    widthPx: asset.width,
    heightPx: asset.height,
    northDeg: old?.northDeg ?? 0,
    ...(old?.calibration && {
      calibration: { ...old.calibration, a: scale(old.calibration.a), b: scale(old.calibration.b) },
    }),
    ...(old?.pixelsPerMetre && { pixelsPerMetre: round(old.pixelsPerMetre * sx, 4) }),
  };
  if (old)
    for (const s of env.scenes)
      if (s.floorId === floorId && s.planPosition) s.planPosition = scale(s.planPosition);
}

/** Two points on the plan and the real distance between them set the plan's scale. */
export function calibrate(
  env: Environment,
  floorId: string,
  a: PlanPoint,
  b: PlanPoint,
  distanceM: number,
) {
  const plan = floor(env, floorId).plan;
  if (!plan) throw new EditError('the floor has no plan');
  if (!(distanceM > 0) || !Number.isFinite(distanceM))
    throw new EditError('the distance must be positive');
  const px = Math.hypot(b.x - a.x, b.y - a.y);
  if (px < 10) throw new EditError('the two points are too close together');
  plan.calibration = { a, b, distanceM };
  plan.pixelsPerMetre = round(px / distanceM, 4);
}

export function setPlanNorth(env: Environment, floorId: string, northDeg: number) {
  const plan = floor(env, floorId).plan;
  if (!plan) throw new EditError('the floor has no plan');
  const d = round(((northDeg % 360) + 360) % 360);
  plan.northDeg = d >= 360 ? 0 : d;
}

/** Puts a scene on a floor, optionally at a point of its plan (pixels). */
export function placeScene(env: Environment, sceneId: string, floorId: string, at?: PlanPoint) {
  const f = floor(env, floorId);
  const s = scene(env, sceneId);
  s.floorId = floorId;
  if (at && f.plan) {
    s.planPosition = {
      x: round(Math.max(0, Math.min(f.plan.widthPx, at.x)), 1),
      y: round(Math.max(0, Math.min(f.plan.heightPx, at.y)), 1),
    };
  } else delete s.planPosition;
}

export function unplaceScene(env: Environment, sceneId: string) {
  const s = scene(env, sceneId);
  delete s.floorId;
  delete s.planPosition;
}

/** Removes a floor; its scenes stay, unplaced. Refused when safety content uses it. */
export function removeFloor(env: Environment, floorId: string) {
  floor(env, floorId);
  for (const b of env.buildings) b.floors = b.floors.filter((f) => f.id !== floorId);
  for (const s of env.scenes)
    if (s.floorId === floorId) {
      delete s.floorId;
      delete s.planPosition;
    }
  for (const h of env.hotspots)
    h.actions = h.actions.filter((a) => !(a.type === 'showFloorPlan' && a.floorId === floorId));
  assertNoDanglingReferences(env);
}

/** Removes a building and its floors (see removeFloor). */
export function removeBuilding(env: Environment, buildingId: string) {
  const b = env.buildings.find((x) => x.id === buildingId);
  if (!b) throw new EditError(`unknown building ${buildingId}`);
  for (const f of [...b.floors]) removeFloor(env, f.id);
  env.buildings = env.buildings.filter((x) => x.id !== buildingId);
}
