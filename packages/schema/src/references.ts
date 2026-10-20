import type { Action, Condition } from './actions.ts';
import { BUILT_IN_EQUIPMENT_TYPES, type Environment } from './environment.ts';

export interface ReferenceIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Cross-entity checks Zod cannot express per field: unique IDs and every reference
 * pointing at something that exists. Returned rather than thrown so Studio can list
 * all problems at once.
 */
export function checkReferences(env: Environment): ReferenceIssue[] {
  const issues: ReferenceIssue[] = [];
  const add = (path: (string | number)[], message: string) => issues.push({ path, message });

  const ids = <T extends { id: string }>(items: T[], key: string): Set<string> => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      if (seen.has(item.id)) add([key, i, 'id'], `Duplicate ${key} id "${item.id}"`);
      seen.add(item.id);
    });
    return seen;
  };

  const floors = env.buildings.flatMap((b) => b.floors);
  const floorIds = ids(floors, 'floors');
  ids(env.buildings, 'buildings');
  const sceneIds = ids(env.scenes, 'scenes');
  const hotspotIds = ids(env.hotspots, 'hotspots');
  const variableIds = ids(env.variables, 'variables');
  const layerIds = ids(env.liveLayers, 'liveLayers');
  ids(env.animatedRegions, 'animatedRegions');
  const audioIds = ids(env.audio, 'audio');
  const albumIds = ids(env.albums, 'albums');
  const customTypeIds = ids(env.equipmentTypes, 'equipmentTypes');
  const equipmentIds = ids(env.equipment, 'equipment');
  const routeIds = ids(env.routes, 'routes');
  const zoneIds = ids(env.zones, 'zones');
  ids(env.postings, 'postings');
  const audienceIds = ids(env.audiences, 'audiences');
  const moduleIds = ids(env.modules, 'modules');
  const documentIds = ids(env.documents, 'documents');
  if (env.skin) {
    const seen = new Set<string>();
    env.skin.elements.forEach((el, i) => {
      if (seen.has(el.id))
        add(['skin', 'elements', i, 'id'], `Duplicate skin element id "${el.id}"`);
      seen.add(el.id);
    });
  }

  const typeIds = new Set<string>([...BUILT_IN_EQUIPMENT_TYPES, ...customTypeIds]);

  const ref = (
    set: Set<string>,
    id: string | undefined,
    path: (string | number)[],
    what: string,
  ) => {
    if (id !== undefined && !set.has(id)) add(path, `Unknown ${what} "${id}"`);
  };
  const refAudiences = (list: string[], path: (string | number)[]) =>
    list.forEach((a, i) => ref(audienceIds, a, [...path, i], 'audience'));

  const checkCondition = (c: Condition | undefined, path: (string | number)[]): void => {
    if (!c) return;
    if ('all' in c) c.all.forEach((x, i) => checkCondition(x, [...path, 'all', i]));
    else if ('any' in c) c.any.forEach((x, i) => checkCondition(x, [...path, 'any', i]));
    else if ('not' in c) checkCondition(c.not, [...path, 'not']);
    else if ('variable' in c) ref(variableIds, c.variable, [...path, 'variable'], 'variable');
    else if ('visited' in c) ref(sceneIds, c.visited, [...path, 'visited'], 'scene');
    else ref(audienceIds, c.audience, [...path, 'audience'], 'audience');
  };

  const checkAction = (a: Action, path: (string | number)[]) => {
    checkCondition(a.condition, [...path, 'condition']);
    switch (a.type) {
      case 'goToScene':
        return ref(sceneIds, a.sceneId, [...path, 'sceneId'], 'scene');
      case 'openPopup':
        if (a.content.kind === 'pdf')
          ref(documentIds, a.content.documentId, [...path, 'content', 'documentId'], 'document');
        return;
      case 'openDocument':
        return ref(documentIds, a.documentId, [...path, 'documentId'], 'document');
      case 'playAudio':
      case 'stopAudio':
        return ref(audioIds, a.audioId, [...path, 'audioId'], 'audio');
      case 'setVisibility':
        return a.targetIds.forEach((t, i) =>
          ref(
            new Set([...hotspotIds, ...equipmentIds, ...routeIds]),
            t,
            [...path, 'targetIds', i],
            'target',
          ),
        );
      case 'setVariable':
        return ref(variableIds, a.variable, [...path, 'variable'], 'variable');
      case 'startModule':
        return ref(moduleIds, a.moduleId, [...path, 'moduleId'], 'module');
      case 'showFloorPlan':
        return ref(floorIds, a.floorId, [...path, 'floorId'], 'floor');
      case 'showRoute':
        return ref(routeIds, a.routeId, [...path, 'routeId'], 'route');
      case 'setLiveLayer': {
        ref(layerIds, a.layerId, [...path, 'layerId'], 'live layer');
        const layer = env.liveLayers.find((l) => l.id === a.layerId);
        if (layer && !layer.states.some((s) => s.id === a.stateId))
          add([...path, 'stateId'], `Unknown state "${a.stateId}" in live layer "${layer.id}"`);
        return;
      }
      case 'openAlbum': {
        ref(albumIds, a.albumId, [...path, 'albumId'], 'album');
        const album = env.albums.find((x) => x.id === a.albumId);
        if (album && a.start >= album.items.length)
          add([...path, 'start'], `Album "${album.id}" has ${album.items.length} photo(s)`);
        return;
      }
      case 'openUrl':
      case 'askQuestion':
      case 'lookAt':
        return;
    }
  };

  ref(sceneIds, env.initialSceneId, ['initialSceneId'], 'scene');

  env.scenes.forEach((s, i) => {
    ref(floorIds, s.floorId, ['scenes', i, 'floorId'], 'floor');
    refAudiences(s.audienceIds, ['scenes', i, 'audienceIds']);
  });

  env.hotspots.forEach((h, i) => {
    const p = ['hotspots', i];
    ref(sceneIds, h.sceneId, [...p, 'sceneId'], 'scene');
    refAudiences(h.audienceIds, [...p, 'audienceIds']);
    checkCondition(h.condition, [...p, 'condition']);
    h.actions.forEach((a, j) => checkAction(a, [...p, 'actions', j]));
    if (h.timeRange) {
      if (h.timeRange.end <= h.timeRange.start)
        add([...p, 'timeRange'], 'The end time must be after the start time');
      const scene = env.scenes.find((x) => x.id === h.sceneId);
      if (scene && scene.media.type !== 'video360')
        add([...p, 'timeRange'], 'Timed hotspots belong to 360° video scenes');
    }
  });

  env.liveLayers.forEach((l, i) => {
    const states = new Set(l.states.map((s) => s.id));
    if (!states.has(l.defaultStateId))
      add(['liveLayers', i, 'defaultStateId'], `Unknown state "${l.defaultStateId}"`);
    l.overrides.forEach((o, j) => {
      ref(sceneIds, o.sceneId, ['liveLayers', i, 'overrides', j, 'sceneId'], 'scene');
      if (!states.has(o.stateId))
        add(['liveLayers', i, 'overrides', j, 'stateId'], `Unknown state "${o.stateId}"`);
    });
  });

  env.animatedRegions.forEach((r, i) => {
    ref(sceneIds, r.sceneId, ['animatedRegions', i, 'sceneId'], 'scene');
    checkCondition(r.condition, ['animatedRegions', i, 'condition']);
  });
  env.audio.forEach((a, i) => {
    a.sceneIds.forEach((s, j) => ref(sceneIds, s, ['audio', i, 'sceneIds', j], 'scene'));
    if (a.kind === 'spatial' && !a.position)
      add(['audio', i, 'position'], 'A spatial sound needs a position in the panorama');
  });
  env.autopilot?.sceneOrder.forEach((s, i) =>
    ref(sceneIds, s, ['autopilot', 'sceneOrder', i], 'scene'),
  );

  env.equipment.forEach((e, i) => {
    const p = ['equipment', i];
    ref(typeIds, e.typeId, [...p, 'typeId'], 'equipment type');
    ref(floorIds, e.floorId, [...p, 'floorId'], 'floor');
    e.placements.forEach((pl, j) =>
      ref(sceneIds, pl.sceneId, [...p, 'placements', j, 'sceneId'], 'scene'),
    );
    refAudiences(e.audienceIds, [...p, 'audienceIds']);
  });

  env.zones.forEach((z, i) => ref(floorIds, z.floorId, ['zones', i, 'floorId'], 'floor'));

  env.routes.forEach((r, i) => {
    const p = ['routes', i];
    r.segments.forEach((s, j) =>
      ref(floorIds, s.floorId, [...p, 'segments', j, 'floorId'], 'floor'),
    );
    r.sceneSequence.forEach((s, j) => ref(sceneIds, s, [...p, 'sceneSequence', j], 'scene'));
    r.zoneIds.forEach((z, j) => ref(zoneIds, z, [...p, 'zoneIds', j], 'zone'));
    r.starts.forEach((s, j) => ref(sceneIds, s.sceneId, [...p, 'starts', j, 'sceneId'], 'scene'));
    refAudiences(r.audienceIds, [...p, 'audienceIds']);
    const end = env.equipment.find((e) => e.id === r.assemblyPointId);
    if (!end) add([...p, 'assemblyPointId'], `Unknown equipment "${r.assemblyPointId}"`);
    else if (end.typeId !== 'assembly-point')
      add([...p, 'assemblyPointId'], `Route must end at an assembly point, not "${end.typeId}"`);
  });

  env.postings.forEach((x, i) => {
    ref(floorIds, x.floorId, ['postings', i, 'floorId'], 'floor');
    ref(sceneIds, x.sceneId, ['postings', i, 'sceneId'], 'scene');
  });

  env.modules.forEach((m, i) => {
    const p = ['modules', i];
    refAudiences(m.audienceIds, [...p, 'audienceIds']);
    ref(sceneIds, m.startSceneId, [...p, 'startSceneId'], 'scene');
    const stepIds = new Set<string>();
    m.steps.forEach((s, j) => {
      if (stepIds.has(s.id)) add([...p, 'steps', j, 'id'], `Duplicate step id "${s.id}"`);
      stepIds.add(s.id);
      if (s.kind === 'hazard-hunt') {
        s.hazards.forEach((h, k) =>
          ref(sceneIds, h.sceneId, [...p, 'steps', j, 'hazards', k, 'sceneId'], 'scene'),
        );
        if (s.required !== undefined && s.required > s.hazards.length)
          add([...p, 'steps', j, 'required'], 'More hazards required than there are');
      }
      if (s.kind === 'navigate') ref(sceneIds, s.sceneId, [...p, 'steps', j, 'sceneId'], 'scene');
      if (s.kind === 'find-item')
        ref(
          new Set([...equipmentIds, ...hotspotIds]),
          s.targetId,
          [...p, 'steps', j, 'targetId'],
          'equipment or hotspot',
        );
    });
    m.checklist.forEach((c, j) => ref(stepIds, c.stepId, [...p, 'checklist', j, 'stepId'], 'step'));
  });

  env.documents.forEach((d, i) => refAudiences(d.audienceIds, ['documents', i, 'audienceIds']));

  const s = env.settings;
  if (!s.languages.includes(s.defaultLanguage))
    add(['settings', 'defaultLanguage'], `Default language "${s.defaultLanguage}" is not enabled`);
  ref(audienceIds, s.defaultAudienceId, ['settings', 'defaultAudienceId'], 'audience');
  if (s.lockAudience && !s.defaultAudienceId)
    add(['settings', 'lockAudience'], 'Locking the audience requires a default audience');

  return issues;
}
