/**
 * Phase 9 scenes of the demo facility: the lobby in stereo (for VR), a GLB model of the
 * loading dock and a Gaussian splat capture of the mechanical room, with equipment
 * placed in model space (world positions) and the evacuation route drawn on the dock
 * floor. Like every demo placement, these stand in for a person placing them.
 */
import type { EnvironmentInput } from '@evactis-3dworkflow/schema';
import { plan } from './layout.ts';
import { DOCK, MECHANICAL } from './models.ts';
import { featureAngles } from './scenes.ts';

type Input = Required<EnvironmentInput>;
const T = (en: string, fr: string) => ({ en, fr });
const world = (p: { x: number; y: number; z: number }) => ({ kind: 'world' as const, ...p });

export const scenes3d: Input['scenes'] = [
  {
    id: 'lobby-stereo',
    name: T('Stereo lobby (for VR headsets)', 'Hall en stéréo (pour casques de RV)'),
    media: {
      type: 'equirect-stereo',
      source: 'media/lobby-stereo/stereo.jpg',
      layout: 'top-bottom',
    },
    floorId: 'f1',
    initialView: { yaw: 0, pitch: -2, fov: 90 },
  },
  {
    id: 'dock',
    name: T('Loading dock (3D model)', 'Quai de chargement (modèle 3D)'),
    media: { type: 'glb', source: 'media/dock/dock.glb' },
    viewpoint: DOCK.viewpoint,
    floorId: 'f1',
    planPosition: plan(-4, -17),
    initialView: { yaw: 0, pitch: -6, fov: 90 },
  },
  {
    id: 'mechanical',
    name: T('Mechanical room (3D capture)', 'Salle mécanique (capture 3D)'),
    media: { type: 'splat', source: 'media/mechanical/room.splat', format: 'splat' },
    viewpoint: MECHANICAL.viewpoint,
    floorId: 'f1',
    // Off the drawn evacuation routes (route scenes are suggested within 3 m of a line).
    planPosition: plan(-5, -10),
    initialView: { yaw: 0, pitch: -4, fov: 90 },
  },
];

const link = (
  id: string,
  sceneId: string,
  to: string,
  position:
    | { kind: 'world'; x: number; y: number; z: number }
    | { kind: 'spherical'; yaw: number; pitch: number },
  title: [string, string],
) => ({
  id,
  sceneId,
  title: T(...title),
  position,
  appearance: { kind: 'button' as const, icon: 'next' as const },
  actions: [
    {
      type: 'goToScene' as const,
      sceneId: to,
      transition: { kind: 'fade' as const, durationMs: 700 },
    },
  ],
});

const corridorWest = featureAngles('corridor', 'door', 'w');

export const hotspots3d: Input['hotspots'] = [
  // Facing south-east, away from the lobby's usual views.
  link('lobby-to-stereo', 'lobby', 'lobby-stereo', { kind: 'spherical', yaw: 150, pitch: 8 }, [
    'See the lobby in stereo (VR headsets)',
    'Voir le hall en stéréo (casques de RV)',
  ]),
  link('stereo-to-lobby', 'lobby-stereo', 'lobby', { kind: 'spherical', yaw: 150, pitch: 8 }, [
    'Back to the lobby',
    'Retour au hall',
  ]),
  link(
    'corridor-to-dock',
    'corridor',
    'dock',
    // Low on the far west door, clear of the alarm sign above it.
    { kind: 'spherical', ...corridorWest, pitch: corridorWest.pitch - 10 },
    ['To the loading dock (3D model)', 'Vers le quai de chargement (modèle 3D)'],
  ),
  link('dock-to-corridor', 'dock', 'corridor', world({ ...DOCK.door, y: 1.2 }), [
    'To the east corridor',
    'Vers le couloir est',
  ]),
  link('dock-to-mechanical', 'dock', 'mechanical', world({ x: -4.9, y: 1.2, z: 3.5 }), [
    'To the mechanical room (3D capture)',
    'Vers la salle mécanique (capture 3D)',
  ]),
  link('mechanical-to-dock', 'mechanical', 'dock', world({ ...MECHANICAL.door, y: 1.2 }), [
    'To the loading dock',
    'Vers le quai de chargement',
  ]),
];

export const equipment3d: Input['equipment'] = [
  {
    id: 'fe-105',
    typeId: 'fire-extinguisher',
    tag: 'FE-105',
    description: T(
      'ABC dry chemical, 10 lb, by the dock door.',
      'Poudre ABC, 10 lb, près de la porte du quai.',
    ),
    floorId: 'f1',
    placements: [{ sceneId: 'dock', position: world(DOCK.extinguisher) }],
    lastInspection: '2026-09-15',
    nextInspection: '2026-10-15',
  },
  {
    id: 'exit-dock',
    typeId: 'exit',
    label: T('Exit to the east corridor', 'Sortie vers le couloir est'),
    floorId: 'f1',
    placements: [{ sceneId: 'dock', position: world(DOCK.exitSign) }],
  },
  {
    id: 'fak-103',
    typeId: 'first-aid',
    tag: 'FAK-103',
    floorId: 'f1',
    placements: [{ sceneId: 'dock', position: world(DOCK.firstAid) }],
  },
  {
    id: 'fe-106',
    typeId: 'fire-extinguisher',
    tag: 'FE-106',
    description: T(
      'CO2, 10 lb. For electrical and boiler-room fires.',
      'CO2, 10 lb. Pour les feux électriques et de chaufferie.',
    ),
    floorId: 'f1',
    placements: [{ sceneId: 'mechanical', position: world(MECHANICAL.extinguisher) }],
    lastInspection: '2026-09-15',
  },
];

/** The walk from the dock to its exit, drawn on the model's floor. */
export const dockPath = { sceneId: 'dock', points: [...DOCK.route] };
