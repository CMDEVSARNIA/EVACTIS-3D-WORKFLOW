import {
  EnvironmentSchema,
  createEmptyEnvironment,
  type Environment,
} from '@evactis-3dworkflow/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetRecord } from '../api.ts';
import { floorPitch, geoVector, suggestLinks } from './autolink.ts';
import * as ops from './ops.ts';
import { DocumentStore } from './store.ts';

const empty = (): Environment =>
  createEmptyEnvironment(
    'riverside',
    { en: 'Riverside', fr: 'Riverside' },
    new Date('2026-10-19T12:00:00Z'),
  );

function asset(id: string, over: Partial<AssetRecord> = {}): AssetRecord {
  return {
    recordVersion: 1,
    id,
    kind: 'panorama',
    name: id,
    originalFileName: `${id}.jpg`,
    sha256: '0'.repeat(64),
    bytes: 1,
    importedAt: '2026-10-19T12:00:00Z',
    source: `media/${id}/source.jpg`,
    preview: `media/${id}/preview.jpg`,
    thumbnail: `media/${id}/thumb.jpg`,
    tiles: { basePath: `media/${id}/tiles`, tileSize: 512, levels: [{ size: 512 }], format: 'jpg' },
    width: 8192,
    height: 4096,
    layout: 'mono',
    hdr: false,
    capture: {},
    warnings: [],
    ...over,
  };
}

const plan = (id: string, w: number, h: number) =>
  asset(id, {
    kind: 'floor-plan',
    preview: `media/${id}/plan.png`,
    width: w,
    height: h,
    tiles: undefined,
    layout: undefined,
  });

const valid = (env: Environment) => {
  const r = EnvironmentSchema.safeParse(env);
  if (!r.success)
    throw new Error(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
};

describe('editing operations', () => {
  it('adds scenes from every scene asset kind and keeps the document valid', () => {
    const env = empty();
    const lobby = ops.addScene(
      env,
      asset('lobby', { capture: { captureDate: '2026-09-30', gps: { lat: 45.5, lon: -73.6 } } }),
    );
    ops.addScene(
      env,
      asset('stairs', { kind: 'panorama-stereo', layout: 'stereo-side-by-side', tiles: undefined }),
    );
    ops.addScene(
      env,
      asset('walk', { kind: 'video360', playback: 'media/walk/video.mp4', tiles: undefined }),
    );
    ops.addScene(env, asset('pump', { kind: 'glb', tiles: undefined }));
    ops.addScene(env, asset('hall', { kind: 'splat', splatFormat: 'spz', tiles: undefined }));
    ops.addScene(env, asset('lobby'), 'Lobby');
    expect(env.scenes.map((s) => s.id)).toEqual([
      'lobby',
      'stairs',
      'walk',
      'pump',
      'hall',
      'lobby-2',
    ]);
    expect(env.initialSceneId).toBe('lobby');
    const s = ops.scene(env, lobby);
    expect(s.media).toMatchObject({ type: 'equirect', tiles: { basePath: 'media/lobby/tiles' } });
    expect(s).toMatchObject({ captureDate: '2026-09-30', gps: { lat: 45.5, lon: -73.6 } });
    expect(env.scenes[1]!.media).toMatchObject({ type: 'equirect-stereo', layout: 'side-by-side' });
    expect(env.scenes[2]!.media).toMatchObject({
      type: 'video360',
      source: 'media/walk/video.mp4',
      poster: 'media/walk/preview.jpg',
    });
    expect(env.scenes[4]!.media).toMatchObject({ type: 'splat', format: 'spz' });
    expect(() => ops.addScene(env, plan('l1', 100, 100))).toThrow(ops.EditError);
    valid(env);
  });

  it('places, moves and removes hotspots; removing a scene removes links to it', () => {
    const env = empty();
    const a = ops.addScene(env, asset('a'));
    const b = ops.addScene(env, asset('b'));
    const link = ops.addHotspot(env, a, { yaw: 200, pitch: -100 }, 'link', { target: b });
    const info = ops.addHotspot(env, a, { yaw: 10, pitch: 5 }, 'info');
    const h = ops.hotspot(env, link);
    expect(h.position).toEqual({ kind: 'spherical', yaw: -160, pitch: -90 });
    expect(h.title).toEqual({ en: 'b', fr: 'b' });
    expect(h.actions).toEqual([ops.goTo(b)]);
    expect(ops.hotspot(env, info).actions[0]).toMatchObject({ type: 'openPopup' });
    ops.moveHotspot(env, link, { yaw: 45.123, pitch: -12.346 });
    expect(h.position).toEqual({ kind: 'spherical', yaw: 45.12, pitch: -12.35 });
    expect(ops.linkedScenes(env, a)).toEqual(new Set([b]));
    // A back link from b, and a hotspot in a that hides the info hotspot.
    ops.addHotspot(env, b, { yaw: 180, pitch: 0 }, 'link', { target: a });
    ops.setActions(env, link, [
      ops.goTo(b),
      { type: 'setVisibility', targetIds: [info], visible: 'toggle' },
    ]);
    expect(() => ops.setActions(env, link, [ops.goTo('nowhere')])).toThrow(ops.InUseError);
    valid(env);

    ops.removeHotspot(env, info);
    expect(ops.hotspot(env, link).actions).toEqual([ops.goTo(b)]);
    ops.setStartScene(env, b);
    ops.removeScene(env, b);
    expect(env.hotspots.map((x) => x.id)).toEqual([link]);
    expect(ops.hotspot(env, link).actions).toEqual([]);
    expect(env.initialSceneId).toBe(a);
    valid(env);
  });

  it('refuses to remove a scene that safety content still uses', () => {
    const env = empty();
    const a = ops.addScene(env, asset('a'));
    env.equipment.push({
      id: 'ext-1',
      typeId: 'fire-extinguisher',
      name: { en: 'Extinguisher', fr: 'Extincteur' },
      placements: [{ sceneId: a, position: { kind: 'spherical', yaw: 0, pitch: 0 }, style: 'A' }],
      audienceIds: [],
      attributes: {},
    } as unknown as Environment['equipment'][number]);
    expect(() => ops.removeScene(env, a)).toThrow(/equipment\.0\.placements\.0\.sceneId/);
  });

  it('sets initial view and north with wrapped, rounded angles', () => {
    const env = empty();
    const a = ops.addScene(env, asset('a'));
    ops.setInitialView(env, a, { yaw: 190.456, pitch: 100, fov: 200 });
    ops.setNorth(env, a, -270);
    expect(ops.scene(env, a)).toMatchObject({
      initialView: { yaw: -169.54, pitch: 90, fov: 140 },
      northOffsetDeg: 90,
    });
    valid(env);
  });

  it('builds floors with plans, calibration and placed scenes; rescales on a new plan', () => {
    const env = empty();
    const b = ops.addBuilding(env, { en: 'Main building', fr: 'Bâtiment principal' });
    const l2 = ops.addFloor(env, b, { en: 'Level 2', fr: 'Niveau 2' }, 2);
    const l1 = ops.addFloor(env, b, { en: 'Level 1', fr: 'Niveau 1' }, 1);
    expect(env.buildings[0]!.floors.map((f) => f.id)).toEqual([l1, l2]);
    expect(() => ops.calibrate(env, l1, { x: 0, y: 0 }, { x: 100, y: 0 }, 5)).toThrow('no plan');
    ops.setFloorPlan(env, l1, plan('p1', 2000, 1000));
    ops.calibrate(env, l1, { x: 100, y: 100 }, { x: 400, y: 500 }, 10);
    expect(ops.floor(env, l1).plan!.pixelsPerMetre).toBe(50);
    expect(() => ops.calibrate(env, l1, { x: 1, y: 1 }, { x: 2, y: 2 }, 3)).toThrow('too close');
    expect(() => ops.calibrate(env, l1, { x: 1, y: 1 }, { x: 200, y: 2 }, 0)).toThrow('positive');
    const s = ops.addScene(env, asset('a'));
    ops.placeScene(env, s, l1, { x: 2500, y: 300 });
    expect(ops.scene(env, s)).toMatchObject({ floorId: l1, planPosition: { x: 2000, y: 300 } });
    ops.setPlanNorth(env, l1, -0.001);
    expect(ops.floor(env, l1).plan!.northDeg).toBe(0);
    valid(env);

    // A sharper scan of the same plan: everything scales with it.
    ops.setFloorPlan(env, l1, plan('p1-hd', 4000, 2000));
    const p = ops.floor(env, l1).plan!;
    expect(p).toMatchObject({ image: 'media/p1-hd/plan.png', widthPx: 4000, pixelsPerMetre: 100 });
    expect(p.calibration!.a).toEqual({ x: 200, y: 200 });
    expect(ops.scene(env, s).planPosition).toEqual({ x: 4000, y: 600 });

    ops.removeFloor(env, l1);
    expect(ops.scene(env, s).floorId).toBeUndefined();
    expect(ops.scene(env, s).planPosition).toBeUndefined();
    ops.removeBuilding(env, b);
    expect(env.buildings).toEqual([]);
    valid(env);
  });

  it('makes unique, schema-safe IDs', () => {
    expect(ops.uniqueId('Salle électrique #2', [])).toBe('salle-electrique-2');
    expect(ops.uniqueId('Lobby', ['lobby', 'lobby-2'])).toBe('lobby-3');
    expect(ops.uniqueId('***', [])).toBe('item');
  });
});

describe('auto-link suggestions', () => {
  it('computes distance and bearing from GPS', () => {
    const g = geoVector({ lat: 45.5, lon: -73.6 }, { lat: 45.5001, lon: -73.6 });
    expect(g.distanceM).toBeCloseTo(11.1, 1);
    expect(g.bearingDeg).toBeCloseTo(0, 3);
    expect(
      geoVector({ lat: 45.5, lon: -73.6 }, { lat: 45.5, lon: -73.5999 }).bearingDeg,
    ).toBeCloseTo(90, 1);
    expect(floorPitch(1.6)).toBe(-45);
    expect(floorPitch(4)).toBe(-21.8);
    expect(floorPitch(undefined)).toBe(-15);
  });

  it('uses the plan first, then GPS, then capture order, skipping existing links', () => {
    const env = empty();
    const b = ops.addBuilding(env, { en: 'Main', fr: 'Principal' });
    const l1 = ops.addFloor(env, b, { en: 'Level 1', fr: 'Niveau 1' }, 1);
    ops.setFloorPlan(env, l1, plan('p', 1000, 1000));
    ops.calibrate(env, l1, { x: 0, y: 0 }, { x: 100, y: 0 }, 1); // 100 px per metre
    const a = ops.addScene(env, asset('a', { capture: { gps: { lat: 45.5, lon: -73.6 } } }));
    const east = ops.addScene(env, asset('east'));
    const north = ops.addScene(env, asset('north'));
    const gpsOnly = ops.addScene(
      env,
      asset('gps', { capture: { gps: { lat: 45.5, lon: -73.59995 } } }),
    );
    const far = ops.addScene(env, asset('far', { capture: { gps: { lat: 45.6, lon: -73.6 } } }));
    const last = ops.addScene(env, asset('last'));
    ops.placeScene(env, a, l1, { x: 500, y: 500 });
    ops.placeScene(env, east, l1, { x: 800, y: 500 }); // 3 m east (plan up = north)
    ops.placeScene(env, north, l1, { x: 500, y: 0 }); // 5 m north
    // The panorama's north is 90° to the left of its forward direction.
    ops.setNorth(env, a, -90);

    const s = suggestLinks(env, a);
    // The capture-order neighbour (east) is already suggested from the plan.
    expect(s).toEqual([
      { targetId: east, reason: 'plan', distanceM: 3, yaw: 0, pitch: -28.1 },
      { targetId: gpsOnly, reason: 'gps', distanceM: 3.9, yaw: 0, pitch: -22.3 },
      { targetId: north, reason: 'plan', distanceM: 5, yaw: -90, pitch: -17.7 },
    ]);
    expect(s.some((x) => x.targetId === far || x.targetId === last)).toBe(false);

    // Linked scenes are not suggested again; the plan's north turns every bearing.
    ops.addHotspot(env, a, { yaw: 0, pitch: -20 }, 'link', { target: east });
    ops.setPlanNorth(env, l1, 90);
    const t = suggestLinks(env, a, { order: [last, a, far] });
    expect(t.map((x) => [x.targetId, x.reason, x.yaw])).toEqual([
      [gpsOnly, 'gps', 0],
      [north, 'plan', -180],
      [last, 'sequence', undefined],
      [far, 'sequence', undefined],
    ]);
  });
});

describe('document store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(over: Partial<ConstructorParameters<typeof DocumentStore>[1]> = {}) {
    const saved: string[] = [];
    const snapshot = vi.fn(async () => {});
    const store = new DocumentStore(empty(), {
      save: async (json) => {
        saved.push(json);
      },
      snapshot,
      now: () => Date.now(),
      ...over,
    });
    return { store, saved, snapshot };
  }

  it('undoes and redoes labelled edits and returns what the edit returns', () => {
    const { store } = setup();
    const id = store.edit('Add scene', (d) => ops.addScene(d, asset('a')));
    expect(id).toBe('a');
    store.edit('Rename scene', (d) => ops.renameScene(d, id, 'en', 'Lobby'));
    expect(store.getState()).toMatchObject({ undoLabel: 'Rename scene', redoLabel: null });
    store.undo();
    expect(store.env.scenes[0]!.name.en).toBe('a');
    expect(store.getState()).toMatchObject({ undoLabel: 'Add scene', redoLabel: 'Rename scene' });
    store.redo();
    expect(store.env.scenes[0]!.name.en).toBe('Lobby');
    store.undo();
    store.undo();
    expect(store.env.scenes).toEqual([]);
    store.undo(); // nothing left: no-op
    store.redo();
    store.edit('Add scene', (d) => ops.addScene(d, asset('b')));
    expect(store.getState().redoLabel).toBeNull();
  });

  it('merges keyed edits in quick succession, skips no-ops and failed edits', () => {
    const { store } = setup();
    const a = store.edit('Add scene', (d) => ops.addScene(d, asset('a')));
    const h = store.edit('Add hotspot', (d) => ops.addHotspot(d, a, { yaw: 0, pitch: 0 }, 'info'));
    for (let i = 1; i <= 5; i++) {
      store.edit('Move hotspot', (d) => ops.moveHotspot(d, h, { yaw: i, pitch: 0 }), `move:${h}`);
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(2000);
    store.edit('Move hotspot', (d) => ops.moveHotspot(d, h, { yaw: 30, pitch: 0 }), `move:${h}`);
    const before = store.getState().revision;
    store.edit('Nothing', () => {});
    expect(() => store.edit('Bad', (d) => ops.removeScene(d, 'nope'))).toThrow();
    expect(store.getState().revision).toBe(before);
    store.undo();
    expect(ops.hotspot(store.env, h).position).toMatchObject({ yaw: 5 });
    store.undo();
    expect(ops.hotspot(store.env, h).position).toMatchObject({ yaw: 0 });
  });

  it('keeps at most `limit` undo steps', () => {
    const { store } = setup({ limit: 3 });
    for (let i = 0; i < 5; i++) store.edit(`Add ${i}`, (d) => ops.addScene(d, asset(`s${i}`)));
    let n = 0;
    while (store.getState().undoLabel) {
      store.undo();
      n++;
    }
    expect(n).toBe(3);
    expect(store.env.scenes).toHaveLength(2);
  });

  it('autosaves valid documents after a pause, with the save time', async () => {
    const { store, saved } = setup();
    store.edit('Add scene', (d) => ops.addScene(d, asset('a')));
    expect(store.getState().status).toBe('pending');
    await vi.advanceTimersByTimeAsync(1000);
    store.edit('Rename', (d) => ops.renameScene(d, 'a', 'fr', 'Hall'));
    await vi.advanceTimersByTimeAsync(1499);
    expect(saved).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toHaveLength(1);
    expect(store.getState().status).toBe('saved');
    const doc = JSON.parse(saved[0]!) as Environment;
    expect(doc.scenes[0]!.name).toEqual({ en: 'a', fr: 'Hall' });
    expect(doc.updatedAt).toBe(new Date(Date.now()).toISOString());
    expect(saved[0]!.endsWith('}\n')).toBe(true);
  });

  it('never saves an invalid document and reports why', async () => {
    const { store, saved } = setup();
    store.edit('Break', (d) => {
      d.initialSceneId = 'missing';
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(saved).toHaveLength(0);
    expect(store.getState()).toMatchObject({
      status: 'invalid',
      problem: 'initialSceneId: Unknown scene "missing"',
    });
    store.undo();
    await vi.advanceTimersByTimeAsync(2000);
    expect(saved).toHaveLength(1);
    expect(store.getState()).toMatchObject({ status: 'saved', problem: null });
  });

  it('reports save errors and saves again on the next edit; flush saves at once', async () => {
    let fail = true;
    const saved: string[] = [];
    const store = new DocumentStore(empty(), {
      save: async (json) => {
        if (fail) throw { code: 'project', message: 'disk full' };
        saved.push(json);
      },
    });
    store.edit('Add', (d) => ops.addScene(d, asset('a')));
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.getState()).toMatchObject({ status: 'error', problem: 'disk full' });
    fail = false;
    store.edit('Add', (d) => ops.addScene(d, asset('b')));
    await store.flush();
    expect(saved).toHaveLength(1);
    expect(store.getState().status).toBe('saved');
    await store.flush(); // nothing pending
    expect(saved).toHaveLength(1);
  });

  it('takes an automatic version at most every interval, after a save', async () => {
    const { store, snapshot } = setup({ snapshotEveryMs: 60_000 });
    store.edit('Add', (d) => ops.addScene(d, asset('a')));
    await vi.advanceTimersByTimeAsync(1500);
    expect(snapshot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    store.edit('Add', (d) => ops.addScene(d, asset('b')));
    await vi.advanceTimersByTimeAsync(1500);
    expect(snapshot).toHaveBeenCalledTimes(1);
    store.edit('Add', (d) => ops.addScene(d, asset('c')));
    await vi.advanceTimersByTimeAsync(1500);
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it('reset replaces the document without undo history and notifies subscribers', () => {
    const { store } = setup();
    const seen = vi.fn();
    store.subscribe(seen);
    store.edit('Add', (d) => ops.addScene(d, asset('a')));
    const restored = empty();
    store.reset(restored);
    expect(store.env).toBe(restored);
    expect(store.getState()).toMatchObject({ undoLabel: null, redoLabel: null, status: 'saved' });
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
