/**
 * Rich-content editing operations (Phase 6): sounds, documents, photo albums, live
 * layers, animated regions and timed hotspots. Like ops.ts they run on a store draft;
 * removing something an action still uses is refused (InUseError), never silently
 * rewritten.
 */
import type {
  Audio,
  Environment,
  LiveLayer,
  LocalizedText,
  Spherical,
} from '@evactis-3dworkflow/schema';
import type { AssetRecord } from '../api.ts';
import { assertNoDanglingReferences, EditError, hotspot, scene, uniqueId } from './ops.ts';

const r2 = (n: number) => Math.round(n * 100) / 100;
const text = (s: string): LocalizedText => ({ en: s, fr: s });

const contentIds = (env: Environment) => [
  ...env.audio.map((a) => a.id),
  ...env.documents.map((d) => d.id),
  ...env.albums.map((a) => a.id),
  ...env.liveLayers.map((l) => l.id),
  ...env.animatedRegions.map((r) => r.id),
];

function need(asset: AssetRecord, kind: AssetRecord['kind']) {
  if (asset.kind !== kind) throw new EditError(`${asset.name} is not a ${kind}`);
}

// ---------------------------------------------------------------------------- sounds

export function sound(env: Environment, id: string): Audio {
  const a = env.audio.find((x) => x.id === id);
  if (!a) throw new EditError(`unknown sound ${id}`);
  return a;
}

/** A sound from an imported audio asset: ambient in the given scene to start with. */
export function addSound(env: Environment, asset: AssetRecord, sceneId?: string): string {
  need(asset, 'audio');
  const id = uniqueId(asset.name, contentIds(env));
  env.audio.push({
    id,
    name: text(asset.name),
    kind: 'ambient',
    source: asset.source,
    sceneIds: sceneId ? [sceneId] : [],
    volume: 1,
    loop: false,
    autoplay: false,
  });
  return id;
}

export function updateSound(
  env: Environment,
  id: string,
  patch: Partial<Pick<Audio, 'name' | 'kind' | 'sceneIds' | 'volume' | 'loop' | 'autoplay'>>,
) {
  const a = sound(env, id);
  Object.assign(a, patch);
  if (patch.volume !== undefined) a.volume = Math.max(0, Math.min(1, r2(patch.volume)));
  // A spatial sound needs a direction; start it straight ahead until placed.
  if (a.kind === 'spatial' && !a.position) a.position = { yaw: 0, pitch: 0 };
  if (a.kind !== 'spatial') delete a.position;
}

/** Where a spatial sound comes from (a click in the preview). */
export function placeSound(env: Environment, id: string, at: Spherical) {
  const a = sound(env, id);
  if (a.kind !== 'spatial') throw new EditError('only spatial sounds have a position');
  a.position = { yaw: r2(at.yaw), pitch: r2(at.pitch) };
}

export function removeSound(env: Environment, id: string) {
  env.audio = env.audio.filter((a) => a.id !== id);
  assertNoDanglingReferences(env);
}

// ---------------------------------------------------------------------------- documents

export function addDocument(env: Environment, asset: AssetRecord): string {
  need(asset, 'document');
  const id = uniqueId(asset.name, contentIds(env));
  env.documents.push({ id, title: text(asset.name), source: asset.source, audienceIds: [] });
  return id;
}

export function updateDocument(
  env: Environment,
  id: string,
  patch: { title?: LocalizedText; audienceIds?: string[] },
) {
  const d = env.documents.find((x) => x.id === id);
  if (!d) throw new EditError(`unknown document ${id}`);
  Object.assign(d, patch);
}

export function removeDocument(env: Environment, id: string) {
  env.documents = env.documents.filter((d) => d.id !== id);
  assertNoDanglingReferences(env);
}

// ---------------------------------------------------------------------------- albums

function album(env: Environment, id: string) {
  const a = env.albums.find((x) => x.id === id);
  if (!a) throw new EditError(`unknown album ${id}`);
  return a;
}

/** A new album; it needs at least one photo, so it starts with the given ones. */
export function addAlbum(env: Environment, name: LocalizedText, photos: AssetRecord[]): string {
  if (!photos.length) throw new EditError('an album needs at least one photo');
  photos.forEach((p) => need(p, 'photo'));
  const id = uniqueId(name.en || 'album', contentIds(env));
  env.albums.push({ id, name, items: photos.map((p) => ({ source: p.preview ?? p.source })) });
  return id;
}

export function renameAlbum(env: Environment, id: string, name: LocalizedText) {
  album(env, id).name = name;
}

export function addPhotos(env: Environment, id: string, photos: AssetRecord[]) {
  photos.forEach((p) => need(p, 'photo'));
  album(env, id).items.push(...photos.map((p) => ({ source: p.preview ?? p.source })));
}

export function setCaption(env: Environment, id: string, index: number, caption: LocalizedText) {
  const item = album(env, id).items[index];
  if (!item) throw new EditError(`no photo ${index}`);
  const empty = Object.values(caption).every((v) => !v);
  if (empty) delete item.caption;
  else item.caption = caption;
}

export function movePhoto(env: Environment, id: string, from: number, to: number) {
  const items = album(env, id).items;
  if (to < 0 || to >= items.length) return;
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item!);
}

export function removePhoto(env: Environment, id: string, index: number) {
  const a = album(env, id);
  if (a.items.length === 1) throw new EditError('an album keeps at least one photo');
  a.items.splice(index, 1);
  // An action opening the album at a photo that no longer exists starts at the first.
  for (const h of env.hotspots)
    for (const act of h.actions)
      if (act.type === 'openAlbum' && act.albumId === id && act.start >= a.items.length)
        act.start = 0;
}

export function removeAlbum(env: Environment, id: string) {
  env.albums = env.albums.filter((a) => a.id !== id);
  assertNoDanglingReferences(env);
}

// ---------------------------------------------------------------------------- live layers

const LAYER_STATES: Record<LiveLayer['kind'], [string, LocalizedText][]> = {
  smoke: [
    ['normal', { en: 'Normal', fr: 'Normales' }],
    ['smoke', { en: 'Smoke', fr: 'Fumée' }],
  ],
  'day-night': [
    ['day', { en: 'Day', fr: 'Jour' }],
    ['night', { en: 'Night', fr: 'Nuit' }],
  ],
  'before-after': [
    ['before', { en: 'Before', fr: 'Avant' }],
    ['after', { en: 'After', fr: 'Après' }],
  ],
  custom: [
    ['a', { en: 'State A', fr: 'État A' }],
    ['b', { en: 'State B', fr: 'État B' }],
  ],
};

/** Suggested look for the second state of a new layer, applied to every panorama. */
const LAYER_LOOK: Partial<
  Record<LiveLayer['kind'], { exposure: number; visibilityM?: number; fogColor?: string }>
> = {
  smoke: { exposure: -0.6, visibilityM: 3, fogColor: '#6f6c66' },
  'day-night': { exposure: -1.5 },
};

export function liveLayer(env: Environment, id: string): LiveLayer {
  const l = env.liveLayers.find((x) => x.id === id);
  if (!l) throw new EditError(`unknown live layer ${id}`);
  return l;
}

/**
 * A new live layer of a kind, with its two usual states. Smoke and night layers start
 * with a look on every panorama scene, for the author to adjust per scene.
 */
export function addLiveLayer(
  env: Environment,
  kind: LiveLayer['kind'],
  name: LocalizedText,
): string {
  const id = uniqueId(name.en || kind, contentIds(env));
  const states = LAYER_STATES[kind].map(([sid, n]) => ({ id: sid, name: n }));
  const look = LAYER_LOOK[kind];
  env.liveLayers.push({
    id,
    name,
    kind,
    states,
    defaultStateId: states[0]!.id,
    overrides: look
      ? env.scenes
          .filter((s) => s.media.type === 'equirect')
          .map((s) => ({ sceneId: s.id, stateId: states[1]!.id, lighting: { ...look } }))
      : [],
  });
  return id;
}

export function renameLiveLayer(env: Environment, id: string, name: LocalizedText) {
  liveLayer(env, id).name = name;
}

export function renameState(env: Environment, id: string, stateId: string, name: LocalizedText) {
  const st = liveLayer(env, id).states.find((s) => s.id === stateId);
  if (!st) throw new EditError(`unknown state ${stateId}`);
  st.name = name;
}

export type Lighting = { exposure: number; visibilityM?: number; fogColor?: string };

/** The look of one scene in one state; null removes it (the scene looks as captured). */
export function setSceneLook(
  env: Environment,
  id: string,
  stateId: string,
  sceneId: string,
  lighting: Lighting | null,
) {
  const l = liveLayer(env, id);
  scene(env, sceneId);
  if (!l.states.some((s) => s.id === stateId)) throw new EditError(`unknown state ${stateId}`);
  const others = l.overrides.filter((o) => !(o.sceneId === sceneId && o.stateId === stateId));
  const existing = l.overrides.find((o) => o.sceneId === sceneId && o.stateId === stateId);
  if (!lighting) {
    // A replacement panorama stays even without a lighting change.
    if (existing?.media) {
      const { lighting: _gone, ...rest } = existing;
      void _gone;
      l.overrides = [...others, rest];
    } else l.overrides = others;
    return;
  }
  const clean: Lighting = { exposure: r2(Math.max(-4, Math.min(4, lighting.exposure))) };
  if (lighting.visibilityM) clean.visibilityM = r2(Math.max(0.5, lighting.visibilityM));
  if (lighting.fogColor) clean.fogColor = lighting.fogColor;
  l.overrides = [
    ...others,
    { sceneId, stateId, ...(existing?.media && { media: existing.media }), lighting: clean },
  ];
}

export function removeLiveLayer(env: Environment, id: string) {
  env.liveLayers = env.liveLayers.filter((l) => l.id !== id);
  assertNoDanglingReferences(env);
}

// ---------------------------------------------------------------------------- regions

/** An animated region drawn in a scene (at least three points, in yaw/pitch). */
export function addRegion(
  env: Environment,
  sceneId: string,
  polygon: Spherical[],
  source: string,
): string {
  scene(env, sceneId);
  if (polygon.length < 3) throw new EditError('a region needs at least three points');
  if (!source.trim()) throw new EditError('a region needs a video or image');
  const id = uniqueId(`${sceneId}-region`, contentIds(env));
  env.animatedRegions.push({
    id,
    sceneId,
    polygon: polygon.map((p) => ({ yaw: r2(p.yaw), pitch: r2(p.pitch) })),
    source: source.trim(),
    loop: true,
  });
  return id;
}

export function updateRegion(
  env: Environment,
  id: string,
  patch: { source?: string; loop?: boolean; polygon?: Spherical[] },
) {
  const r = env.animatedRegions.find((x) => x.id === id);
  if (!r) throw new EditError(`unknown region ${id}`);
  if (patch.polygon && patch.polygon.length < 3)
    throw new EditError('a region needs at least three points');
  if (patch.source !== undefined && !patch.source.trim())
    throw new EditError('a region needs a video or image');
  Object.assign(r, patch);
}

export function removeRegion(env: Environment, id: string) {
  env.animatedRegions = env.animatedRegions.filter((r) => r.id !== id);
}

// ---------------------------------------------------------------------------- timed hotspots

/** Shows a hotspot of a 360° video scene only between two playback times (s); null: always. */
export function setTimeRange(
  env: Environment,
  id: string,
  range: { start: number; end: number } | null,
) {
  const h = hotspot(env, id);
  if (!range) {
    delete h.timeRange;
    return;
  }
  if (scene(env, h.sceneId).media.type !== 'video360')
    throw new EditError('timed hotspots belong to 360° video scenes');
  const start = Math.max(0, r2(range.start));
  const end = r2(range.end);
  if (end <= start) throw new EditError('the end time must be after the start time');
  h.timeRange = { start, end };
}
