import {
  EnvironmentSchema,
  type Environment,
  type EnvironmentInput,
} from '@evactis-3dworkflow/schema';
import {
  equipment,
  equipmentTypes,
  floorPlans,
  postings,
  routes,
  scenePlacement,
  zones,
} from './safety.ts';
import { featureAngles, sceneSpec, anglesOf } from './scenes.ts';

/**
 * The seeded demo facility environment. Hotspot directions come from the procedural
 * scene geometry, so markers sit exactly on the doors and equipment in the panoramas.
 * Safety equipment, routes, zones and plan postings come from safety.ts (Phase 5).
 */
const T = (en: string, fr: string) => ({ en, fr });
const nav = (
  id: string,
  sceneId: string,
  to: string,
  at: { yaw: number; pitch: number },
  title: [string, string],
  kind: 'walk' | 'fade' | 'zoom' = 'walk',
) => ({
  id,
  sceneId,
  title: T(...title),
  position: { kind: 'spherical' as const, yaw: at.yaw, pitch: Math.max(-30, at.pitch - 4) },
  appearance: { kind: 'button' as const, icon: 'next' as const },
  actions: [{ type: 'goToScene' as const, sceneId: to, transition: { kind, durationMs: 700 } }],
});
/** Points slightly above a door so the arrow does not cover the exit sign. */
const door = (scene: string, wall: 'n' | 'e' | 's' | 'w', at?: number) =>
  featureAngles(scene, 'door', wall, at);

export function demoEnvironmentInput(): EnvironmentInput {
  const media = (id: string, tiled = true) =>
    tiled
      ? {
          type: 'equirect' as const,
          source: `media/${id}/preview.jpg`,
          preview: `media/${id}/preview.jpg`,
          tiles: {
            basePath: `media/${id}/tiles`,
            tileSize: 512,
            levels: [{ size: 512 }, { size: 1024 }],
            format: 'jpg' as const,
          },
        }
      : { type: 'equirect' as const, source: `media/${id}/panorama.jpg` };
  const assemblyYaw = (sceneSpec('assembly') as { signYaw: number }).signYaw;

  return {
    schemaVersion: 1,
    id: 'evactis-demo-centre',
    title: T('Evactis Demo Centre', 'Centre de démonstration Evactis'),
    facility: {
      name: T('Evactis Demo Centre', 'Centre de démonstration Evactis'),
      client: 'Evactis',
    },
    createdAt: '2026-10-14T09:00:00-04:00',
    updatedAt: '2026-10-14T09:00:00-04:00',
    buildings: [
      {
        id: 'main',
        name: T('Main building', 'Bâtiment principal'),
        floors: [
          { id: 'f1', name: T('Ground floor', 'Rez-de-chaussée'), level: 0, plan: floorPlans.f1 },
          { id: 'f2', name: T('Second floor', 'Deuxième étage'), level: 1, plan: floorPlans.f2 },
        ],
      },
    ],
    scenes: [
      {
        id: 'lobby',
        name: T('Main lobby', 'Hall principal'),
        media: media('lobby'),
        ...scenePlacement('lobby'),
        initialView: { yaw: 0, pitch: -2, fov: 90 },
      },
      {
        id: 'corridor',
        name: T('East corridor', 'Couloir est'),
        media: media('corridor'),
        ...scenePlacement('corridor'),
        initialView: { yaw: 0, pitch: 0, fov: 85 },
      },
      {
        id: 'stairwell',
        name: T('Stairwell A', 'Escalier A'),
        media: media('stairwell'),
        ...scenePlacement('stairwell'),
        initialView: { yaw: 0, pitch: 0, fov: 90 },
      },
      {
        id: 'office',
        name: T('Open office', 'Bureau ouvert'),
        media: media('office'),
        ...scenePlacement('office'),
        initialView: { yaw: 90, pitch: 0, fov: 90 },
      },
      {
        id: 'electrical',
        name: T('Electrical room', 'Salle électrique'),
        media: media('electrical'),
        ...scenePlacement('electrical'),
        audienceIds: ['first-responders'],
        initialView: { yaw: 0, pitch: 0, fov: 90 },
      },
      {
        id: 'assembly',
        name: T('Assembly point', 'Point de rassemblement'),
        media: media('assembly', false),
        ...scenePlacement('assembly'),
        initialView: { yaw: assemblyYaw, pitch: 2, fov: 80 },
      },
    ],
    initialSceneId: 'lobby',
    hotspots: [
      // Navigation
      nav('lobby-to-corridor', 'lobby', 'corridor', door('lobby', 'n'), [
        'To the east corridor',
        'Vers le couloir est',
      ]),
      nav('lobby-to-stairs', 'lobby', 'stairwell', door('lobby', 'e'), [
        'To stairwell A',
        'Vers l’escalier A',
      ]),
      nav(
        'lobby-to-assembly',
        'lobby',
        'assembly',
        door('lobby', 's'),
        ['Main exit to the assembly point', 'Sortie principale vers le point de rassemblement'],
        'fade',
      ),
      nav('corridor-to-lobby', 'corridor', 'lobby', door('corridor', 's'), [
        'Back to the lobby',
        'Retour au hall',
      ]),
      nav(
        'corridor-to-assembly',
        'corridor',
        'assembly',
        door('corridor', 'n'),
        ['East exit to the assembly point', 'Sortie est vers le point de rassemblement'],
        'fade',
      ),
      nav('stairs-to-lobby', 'stairwell', 'lobby', door('stairwell', 'w'), [
        'Back to the lobby',
        'Retour au hall',
      ]),
      nav('stairs-up', 'stairwell', 'office', featureAngles('stairwell', 'opening', 'n'), [
        'Up to the second floor',
        'Vers le deuxième étage',
      ]),
      nav('office-to-stairs', 'office', 'stairwell', door('office', 's'), [
        'Down stairwell A',
        'Descendre par l’escalier A',
      ]),
      {
        ...nav('office-to-electrical', 'office', 'electrical', door('office', 'w'), [
          'Electrical room',
          'Salle électrique',
        ]),
        audienceIds: ['first-responders'],
      },
      nav('electrical-to-office', 'electrical', 'office', door('electrical', 'e'), [
        'Back to the office',
        'Retour au bureau',
      ]),
      {
        ...nav(
          'assembly-to-lobby',
          'assembly',
          'lobby',
          anglesOf([0, -1.2, 10]),
          ['Back inside', 'Retour à l’intérieur'],
          'fade',
        ),
        appearance: { kind: 'label' as const, text: T('Back inside', 'Retour à l’intérieur') },
      },
      // Information and first-responder content
      {
        id: 'lobby-welcome',
        sceneId: 'lobby',
        title: T('Welcome', 'Bienvenue'),
        position: { kind: 'spherical' as const, yaw: -25, pitch: 2 },
        appearance: { kind: 'marker' as const, marker: 'info' as const },
        actions: [
          {
            type: 'openPopup' as const,
            title: T('Evactis Demo Centre', 'Centre de démonstration Evactis'),
            content: {
              kind: 'text' as const,
              body: T(
                'This demonstration environment runs entirely offline.\n\nDrag to look around, use the arrow buttons to move, and select a safety sign to learn about the equipment.',
                'Cet environnement de démonstration fonctionne entièrement hors ligne.\n\nFaites glisser pour regarder autour, utilisez les flèches pour vous déplacer et sélectionnez un panneau de sécurité pour en savoir plus.',
              ),
            },
          },
          { type: 'setVariable' as const, variable: 'welcomed', op: 'set' as const, value: true },
        ],
      },
      {
        id: 'lobby-quiz',
        sceneId: 'lobby',
        title: T('Quick question', 'Petite question'),
        position: { kind: 'spherical' as const, yaw: 160, pitch: 4 },
        appearance: { kind: 'button' as const, icon: 'help' as const },
        condition: { variable: 'welcomed', op: 'eq' as const, value: true },
        actions: [
          {
            type: 'askQuestion' as const,
            question: {
              prompt: T(
                'Where is the nearest AED from the lobby?',
                'Où est le DEA le plus proche du hall?',
              ),
              choices: [
                {
                  id: 'west',
                  label: T('On the west wall of the lobby', 'Sur le mur ouest du hall'),
                  correct: true,
                },
                {
                  id: 'office',
                  label: T('In the second-floor office', 'Dans le bureau du deuxième étage'),
                },
                { id: 'none', label: T('There is no AED', 'Il n’y a pas de DEA') },
              ],
            },
          },
        ],
      },
      {
        id: 'electrical-panel',
        sceneId: 'electrical',
        title: T('Main electrical panel — shut-off', 'Panneau électrique principal — coupure'),
        position: {
          kind: 'polygon' as const,
          points: [
            [-0.6, -0.4],
            [0.6, -0.4],
            [0.6, 1.2],
            [-0.6, 1.2],
          ].map(([x, y]) => anglesOf([x!, y! - 0.1, -2.2])),
        },
        appearance: { kind: 'area' as const },
        audienceIds: ['first-responders'],
        actions: [
          {
            type: 'openPopup' as const,
            title: T('Main electrical shut-off', 'Coupure électrique principale'),
            content: {
              kind: 'text' as const,
              body: T(
                'Main breaker is top left. Key box on the door frame.',
                'Le disjoncteur principal est en haut à gauche. Boîte à clés sur le cadre de porte.',
              ),
            },
          },
        ],
      },
    ],
    variables: [{ id: 'welcomed', kind: 'boolean', initial: false }],
    equipmentTypes,
    equipment,
    zones,
    routes,
    postings,
    audiences: [
      { id: 'staff', name: T('Staff', 'Personnel') },
      { id: 'contractors', name: T('Contractors', 'Entrepreneurs') },
      { id: 'leadership', name: T('Leadership', 'Direction') },
      { id: 'first-responders', name: T('First Responders', 'Premiers intervenants') },
    ],
    settings: { defaultAudienceId: 'staff' },
  };
}

/** Validated demo environment. */
export function demoEnvironment(): Environment {
  return EnvironmentSchema.parse(demoEnvironmentInput());
}
