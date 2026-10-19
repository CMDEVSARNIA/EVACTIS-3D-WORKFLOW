import { EnvironmentSchema, type Environment } from '@evactis-3dworkflow/schema';
import { demoEnvironment } from '@evactis-3dworkflow/demo-facility/environment';
import { describe, expect, it } from 'vitest';
import type { AssetRecord } from '../api.ts';
import * as c from './contentOps.ts';
import { EditError, InUseError, setActions } from './ops.ts';

const valid = (env: Environment) => {
  const r = EnvironmentSchema.safeParse(env);
  if (!r.success)
    throw new Error(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
};

const asset = (kind: AssetRecord['kind'], name: string, file: string): AssetRecord => ({
  recordVersion: 1,
  id: name.toLowerCase().replace(/\W+/g, ''),
  kind,
  name,
  originalFileName: file,
  sha256: '0'.repeat(64),
  bytes: 1,
  importedAt: '2026-10-19T12:00:00Z',
  source: `media/${name}/source.${file.split('.').pop()}`,
  ...(kind === 'photo' && { preview: `media/${name}/photo.jpg` }),
  hdr: false,
  capture: {},
  warnings: [],
});

describe('rich content editing operations', () => {
  it('adds a sound, makes it spatial and places it, and refuses removing it while used', () => {
    const env = demoEnvironment();
    const id = c.addSound(env, asset('audio', 'Evacuation message', 'msg.mp3'), 'corridor');
    expect(c.sound(env, id)).toMatchObject({ kind: 'ambient', sceneIds: ['corridor'], volume: 1 });
    c.updateSound(env, id, { kind: 'spatial', volume: 0.555 });
    expect(c.sound(env, id)).toMatchObject({ position: { yaw: 0, pitch: 0 }, volume: 0.56 });
    c.placeSound(env, id, { yaw: -91.234, pitch: 4.567 });
    expect(c.sound(env, id).position).toEqual({ yaw: -91.23, pitch: 4.57 });
    c.updateSound(env, id, { kind: 'ambient' });
    expect(c.sound(env, id).position).toBeUndefined();
    expect(() => c.placeSound(env, id, { yaw: 0, pitch: 0 })).toThrow(EditError);
    valid(env);
    setActions(env, 'lobby-welcome', [{ type: 'playAudio', audioId: id, restart: true }]);
    expect(() => c.removeSound(env, id)).toThrow(InUseError);
    expect(() => c.addSound(env, asset('photo', 'Not audio', 'x.jpg'))).toThrow(EditError);
  });

  it('adds documents and albums, captions and reorders photos', () => {
    const env = demoEnvironment();
    const doc = c.addDocument(env, asset('document', 'MSDS sheet', 'msds.pdf'));
    c.updateDocument(env, doc, { title: { en: 'Safety data sheet', fr: 'Fiche de données' } });
    const photos = ['North door', 'Riser room'].map((n) => asset('photo', n, `${n}.jpg`));
    const id = c.addAlbum(env, { en: 'Inspection photos', fr: 'Photos d’inspection' }, photos);
    c.addPhotos(env, id, [asset('photo', 'Roof hatch', 'roof.jpg')]);
    c.setCaption(env, id, 2, { en: 'Roof hatch', fr: 'Trappe de toit' });
    c.movePhoto(env, id, 2, 0);
    const album = env.albums.find((a) => a.id === id)!;
    expect(album.items.map((i) => i.source)).toEqual([
      'media/Roof hatch/photo.jpg',
      'media/North door/photo.jpg',
      'media/Riser room/photo.jpg',
    ]);
    expect(album.items[0]!.caption).toEqual({ en: 'Roof hatch', fr: 'Trappe de toit' });
    c.setCaption(env, id, 0, { en: '', fr: '' });
    expect(album.items[0]!.caption).toBeUndefined();
    // An action opening the last photo falls back to the first when it is removed.
    setActions(env, 'lobby-welcome', [{ type: 'openAlbum', albumId: id, start: 2 }]);
    c.removePhoto(env, id, 2);
    expect(env.hotspots.find((h) => h.id === 'lobby-welcome')!.actions[0]).toMatchObject({
      start: 0,
    });
    valid(env);
    expect(() => c.addAlbum(env, { en: 'Empty' }, [])).toThrow(EditError);
    expect(() => c.removeAlbum(env, id)).toThrow(InUseError);
  });

  it('creates a smoke layer with a look on every panorama, editable per scene', () => {
    const env = demoEnvironment();
    env.liveLayers = [];
    const id = c.addLiveLayer(env, 'smoke', { en: 'Smoke', fr: 'Fumée' });
    const layer = c.liveLayer(env, id);
    expect(layer.states.map((s) => s.id)).toEqual(['normal', 'smoke']);
    const panoramas = env.scenes.filter((s) => s.media.type === 'equirect').map((s) => s.id);
    expect(layer.overrides.map((o) => o.sceneId).sort()).toEqual(panoramas.sort());
    expect(layer.overrides.every((o) => o.stateId === 'smoke')).toBe(true);
    // Outdoors: clear air; exposure clamped to ±4 stops.
    c.setSceneLook(env, id, 'smoke', 'assembly', null);
    c.setSceneLook(env, id, 'smoke', 'lobby', {
      exposure: -9,
      visibilityM: 0.1,
      fogColor: '#505050',
    });
    expect(layer.overrides.find((o) => o.sceneId === 'assembly')).toBeUndefined();
    expect(layer.overrides.find((o) => o.sceneId === 'lobby')!.lighting).toEqual({
      exposure: -4,
      visibilityM: 0.5,
      fogColor: '#505050',
    });
    valid(env);
    expect(() => c.setSceneLook(env, id, 'fog', 'lobby', { exposure: 0 })).toThrow(EditError);
  });

  it('draws regions and times hotspots on video scenes only', () => {
    const env = demoEnvironment();
    const id = c.addRegion(
      env,
      'corridor',
      [
        { yaw: 10, pitch: 5 },
        { yaw: 20, pitch: 5 },
        { yaw: 20, pitch: -5 },
      ],
      'media/clips/beacon.webm',
    );
    expect(env.animatedRegions.find((r) => r.id === id)).toMatchObject({
      sceneId: 'corridor',
      loop: true,
    });
    expect(() => c.addRegion(env, 'corridor', [{ yaw: 0, pitch: 0 }], 'x.webm')).toThrow(EditError);
    c.setTimeRange(env, 'drill-exit', { start: 3.333, end: 9 });
    expect(env.hotspots.find((h) => h.id === 'drill-exit')!.timeRange).toEqual({
      start: 3.33,
      end: 9,
    });
    expect(() => c.setTimeRange(env, 'drill-exit', { start: 5, end: 5 })).toThrow(
      /after the start/,
    );
    expect(() => c.setTimeRange(env, 'lobby-welcome', { start: 0, end: 2 })).toThrow(
      /video scenes/,
    );
    c.setTimeRange(env, 'drill-exit', null);
    expect(env.hotspots.find((h) => h.id === 'drill-exit')!.timeRange).toBeUndefined();
    valid(env);
  });
});
