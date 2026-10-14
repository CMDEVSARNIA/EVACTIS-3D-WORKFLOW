import { describe, expect, it } from 'vitest';
import {
  AssetPathSchema,
  CURRENT_SCHEMA_VERSION,
  EnvironmentSchema,
  SchemaVersionError,
  createEmptyEnvironment,
  findMissingTranslations,
  localize,
  migrateEnvironment,
  parseEnvironment,
  type EnvironmentInput,
} from '../src/index.ts';

const T = (en: string, fr: string) => ({ en, fr });
const confirmed = { by: 'J. Tremblay', at: '2026-10-01T09:00:00-04:00' };

function sample(): EnvironmentInput {
  return {
    schemaVersion: 1,
    id: 'riverside',
    title: T('Riverside Hospital', 'Hôpital Riverside'),
    facility: { name: T('Riverside Hospital', 'Hôpital Riverside') },
    createdAt: '2026-10-01T09:00:00-04:00',
    updatedAt: '2026-10-01T09:00:00-04:00',
    buildings: [
      {
        id: 'main',
        name: T('Main building', 'Bâtiment principal'),
        floors: [
          {
            id: 'f1',
            name: T('Floor 1', 'Étage 1'),
            level: 0,
            plan: { image: 'plans/f1.png', widthPx: 2000, heightPx: 1400, pixelsPerMetre: 20 },
          },
          { id: 'f2', name: T('Floor 2', 'Étage 2'), level: 1 },
        ],
      },
    ],
    scenes: [
      {
        id: 'lobby',
        name: T('Lobby', 'Hall'),
        media: { type: 'equirect', source: 'media/lobby.jpg' },
        floorId: 'f1',
      },
      {
        id: 'corridor',
        name: T('Corridor', 'Couloir'),
        media: { type: 'equirect', source: 'media/corridor.jpg' },
        floorId: 'f1',
      },
    ],
    initialSceneId: 'lobby',
    hotspots: [
      {
        id: 'to-corridor',
        sceneId: 'lobby',
        title: T('To corridor', 'Vers le couloir'),
        position: { kind: 'spherical', yaw: 30, pitch: -5 },
        appearance: { kind: 'button', icon: 'next' },
        actions: [{ type: 'goToScene', sceneId: 'corridor' }],
      },
    ],
    equipment: [
      {
        id: 'ap-1',
        typeId: 'assembly-point',
        floorId: 'f1',
        planPosition: { x: 1900, y: 100 },
        confirmed,
      },
      {
        id: 'fe-101',
        typeId: 'fire-extinguisher',
        tag: 'FE-101',
        floorId: 'f1',
        placements: [{ sceneId: 'corridor', position: { kind: 'spherical', yaw: 90, pitch: -10 } }],
        lastInspection: '2026-09-15',
        confirmed,
      },
      {
        id: 'gas-shutoff',
        typeId: 'gas-shutoff',
        floorId: 'f1',
        audienceIds: ['first-responders'],
        confirmed,
      },
    ],
    equipmentTypes: [
      { id: 'gas-shutoff', name: T('Gas shut-off', 'Robinet de gaz'), category: 'utility' },
    ],
    zones: [
      {
        id: 'east',
        name: T('East wing', 'Aile est'),
        kind: 'wing',
        floorId: 'f1',
        polygon: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
      },
    ],
    routes: [
      {
        id: 'r1',
        name: T('East exit', 'Sortie est'),
        priority: 'primary',
        segments: [
          {
            floorId: 'f1',
            points: [
              { x: 100, y: 100 },
              { x: 1900, y: 100 },
            ],
          },
        ],
        sceneSequence: ['lobby', 'corridor'],
        zoneIds: ['east'],
        assemblyPointId: 'ap-1',
        confirmed,
      },
    ],
    audiences: [
      { id: 'staff', name: T('Staff', 'Personnel') },
      { id: 'first-responders', name: T('First Responders', 'Premiers intervenants') },
    ],
    settings: { defaultAudienceId: 'staff' },
  };
}

describe('EnvironmentSchema', () => {
  it('accepts a valid environment and applies defaults', () => {
    const env = EnvironmentSchema.parse(sample());
    expect(env.settings.languages).toEqual(['en', 'fr']);
    expect(env.settings.offlineLinkPolicy).toBe('local-only');
    expect(env.scenes[0]?.initialView).toEqual({ yaw: 0, pitch: 0, fov: 90 });
    expect(env.hotspots[0]?.actions[0]).toMatchObject({
      type: 'goToScene',
      transition: { kind: 'fade' },
    });
  });

  it('rejects dangling references', () => {
    const doc = sample();
    doc.hotspots![0]!.actions = [{ type: 'goToScene', sceneId: 'nowhere' }];
    const r = EnvironmentSchema.safeParse(doc);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain('Unknown scene "nowhere"');
  });

  it('rejects duplicate IDs', () => {
    const doc = sample();
    doc.scenes!.push({ ...doc.scenes![0]! });
    const r = EnvironmentSchema.safeParse(doc);
    expect(r.error?.issues.some((i) => i.message.startsWith('Duplicate scenes id'))).toBe(true);
  });

  it('requires routes to end at an assembly point', () => {
    const doc = sample();
    doc.routes![0]!.assemblyPointId = 'fe-101';
    const r = EnvironmentSchema.safeParse(doc);
    expect(r.error?.issues[0]?.message).toMatch(/must end at an assembly point/);
  });

  it('rejects unknown equipment types but accepts registered custom types', () => {
    const doc = sample();
    expect(EnvironmentSchema.safeParse(doc).success).toBe(true);
    doc.equipmentTypes = [];
    expect(EnvironmentSchema.safeParse(doc).success).toBe(false);
  });

  it('requires a default audience when the audience is locked', () => {
    const doc = sample();
    doc.settings = { lockAudience: true };
    expect(EnvironmentSchema.safeParse(doc).success).toBe(false);
  });
});

describe('AssetPathSchema', () => {
  it.each(['media/a.jpg', 'a.jpg', 'tiles/lobby/f/0/0_0.jpg'])('accepts %s', (p) => {
    expect(AssetPathSchema.safeParse(p).success).toBe(true);
  });
  it.each([
    'https://cdn.example.com/a.jpg',
    'http://example.com/a.jpg',
    '//example.com/a.jpg',
    '/etc/passwd',
    'C:/Users/a.jpg',
    'media\\a.jpg',
    '../outside.jpg',
    'media/../../outside.jpg',
    'data:image/png;base64,AAAA',
  ])('rejects %s', (p) => {
    expect(AssetPathSchema.safeParse(p).success).toBe(false);
  });
});

describe('migrations', () => {
  it('passes current documents through', () => {
    const doc = { schemaVersion: CURRENT_SCHEMA_VERSION, id: 'x' };
    expect(migrateEnvironment(doc)).toEqual(doc);
  });

  it('applies registered steps in order', () => {
    const steps = {
      1: (d: Record<string, unknown>) => ({ ...d, a: 1 }),
      2: (d: Record<string, unknown>) => ({ ...d, b: (d.a as number) + 1 }),
    };
    expect(migrateEnvironment({ schemaVersion: 1 }, steps, 3)).toEqual({
      schemaVersion: 3,
      a: 1,
      b: 2,
    });
  });

  it('refuses documents from a newer version', () => {
    expect(() => migrateEnvironment({ schemaVersion: 99 })).toThrow(SchemaVersionError);
    expect(() => migrateEnvironment({ schemaVersion: 99 })).toThrow(/newer version/);
  });

  it('refuses missing versions and gaps', () => {
    expect(() => migrateEnvironment({})).toThrow(/schemaVersion/);
    expect(() => migrateEnvironment([])).toThrow(/JSON object/);
    expect(() => migrateEnvironment({ schemaVersion: 1 }, {}, 2)).toThrow(/No migration/);
  });

  it('parseEnvironment never throws', () => {
    expect(parseEnvironment('nope').success).toBe(false);
    expect(parseEnvironment({ schemaVersion: 2 }).success).toBe(false);
    expect(parseEnvironment(sample()).success).toBe(true);
  });
});

describe('i18n helpers', () => {
  it('reports missing translations for enabled languages', () => {
    const env = EnvironmentSchema.parse(sample());
    expect(findMissingTranslations(env)).toEqual([]);
    env.scenes[1]!.name = { en: 'Corridor' };
    expect(findMissingTranslations(env)).toEqual([{ path: ['scenes', 1, 'name'], language: 'fr' }]);
  });

  it('localizes with fallback', () => {
    expect(localize({ en: 'Exit', fr: 'Sortie' }, 'fr-CA')).toBe('Sortie');
    expect(localize({ en: 'Exit' }, 'fr')).toBe('Exit');
    expect(localize(undefined, 'fr')).toBe('');
  });

  it('creates a bilingual empty environment with the four standard audiences', () => {
    const env = createEmptyEnvironment('demo', T('Demo', 'Démo'), new Date('2026-10-14T12:00:00Z'));
    expect(env.audiences.map((a) => a.id)).toEqual([
      'staff',
      'contractors',
      'leadership',
      'first-responders',
    ]);
    expect(findMissingTranslations(env)).toEqual([]);
  });
});

describe('security', () => {
  it('runs Zod without eval (jitless) so strict CSP never reports a violation', async () => {
    const { z } = await import('zod');
    expect(z.config().jitless).toBe(true);
  });
});
