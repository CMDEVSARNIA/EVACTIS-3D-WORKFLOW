/**
 * The demo facility's safety layer: equipment, first-responder layers, zones, two
 * evacuation routes and two plan postings, all derived from the room geometry.
 *
 * In a real project every item is placed or confirmed by a person (CLAUDE.md). Here the
 * confirmation names the procedural generator, so nobody mistakes demo data for a
 * verified plan.
 */
import type { EnvironmentInput } from '@evactis-3dworkflow/schema';
import { featureAngles, anglesOf, sceneSpec, type RoomSpec, type Wall } from './scenes.ts';
import {
  PLAN_H,
  PLAN_W,
  PX_PER_M,
  ROOMS,
  plan,
  roomOrigin,
  roomRect,
  wallPoint,
  yawTo,
} from './layout.ts';

type Input = Required<EnvironmentInput>;
const T = (en: string, fr: string) => ({ en, fr });
export const DEMO_CONFIRMATION = {
  by: 'Evactis demo data (procedural, not a real site)',
  at: '2026-10-14T09:00:00-04:00',
};
const FR = ['first-responders'];

export const floorPlans = {
  f1: {
    image: 'plans/f1.png',
    widthPx: PLAN_W,
    heightPx: PLAN_H,
    pixelsPerMetre: PX_PER_M,
    northDeg: 0,
  },
  f2: {
    image: 'plans/f2.png',
    widthPx: PLAN_W,
    heightPx: PLAN_H,
    pixelsPerMetre: PX_PER_M,
    northDeg: 0,
  },
};

/** Plan position of each scene's camera. */
export function scenePlacement(id: string) {
  const r = ROOMS[id]!;
  return { floorId: r.floor, planPosition: plan(...r.origin) };
}

/** Where an exit sign sits: just above the door. */
function exitSign(scene: string, wall: Wall, at: number) {
  const r = sceneSpec(scene) as RoomSpec;
  const b = r.bounds;
  const p: [number, number, number] =
    wall === 'n'
      ? [at, 0.75, b.zMin]
      : wall === 's'
        ? [at, 0.75, b.zMax]
        : wall === 'w'
          ? [b.xMin, 0.75, at]
          : [b.xMax, 0.75, at];
  return anglesOf(p);
}

const placed = (scene: string, at: { yaw: number; pitch: number }) => [
  { sceneId: scene, position: { kind: 'spherical' as const, ...at } },
];
const onWall = (scene: string, wall: Wall, at: number) => {
  const [x, z] = wallPoint(scene, wall, at);
  return { floorId: ROOMS[scene]!.floor, planPosition: plan(x, z) };
};

export const equipmentTypes: Input['equipmentTypes'] = [
  {
    id: 'fire-alarm-panel',
    name: T('Fire alarm annunciator panel', 'Panneau annonciateur d’alarme incendie'),
    category: 'fire',
    symbol: 'FACP',
  },
  {
    id: 'sprinkler-riser',
    name: T('Sprinkler riser and control valve', 'Colonne montante et vanne de gicleurs'),
    category: 'fire',
    symbol: 'SPR',
  },
  {
    id: 'fire-department-connection',
    name: T('Fire department connection', 'Raccord-pompier'),
    category: 'fire',
    symbol: 'FDC',
  },
  {
    id: 'electrical-shutoff',
    name: T('Main electrical shut-off', 'Coupure électrique principale'),
    category: 'utility',
    symbol: 'ELEC',
  },
  {
    id: 'key-box',
    name: T('Fire department key box', 'Boîte à clés des pompiers'),
    category: 'access',
    symbol: 'KEY',
  },
];

export const equipment: Input['equipment'] = [
  // Ground floor
  {
    id: 'fe-101',
    typeId: 'fire-extinguisher',
    tag: 'FE-101',
    description: T(
      'ABC dry chemical, 5 lb. Pull the pin, aim at the base of the fire, squeeze, sweep.',
      'Poudre ABC, 5 lb. Tirez la goupille, visez la base du feu, pressez, balayez.',
    ),
    ...onWall('lobby', 'w', -1.5),
    placements: placed('lobby', featureAngles('lobby', 'extinguisher', 'w')),
    lastInspection: '2026-09-15',
    nextInspection: '2026-10-15',
  },
  {
    id: 'aed-1',
    typeId: 'aed',
    tag: 'AED-1',
    description: T(
      'Automated external defibrillator. Open the cabinet and follow the voice prompts.',
      'Défibrillateur externe automatisé. Ouvrez l’armoire et suivez les instructions vocales.',
    ),
    ...onWall('lobby', 'w', 1),
    placements: placed('lobby', featureAngles('lobby', 'aed', 'w')),
    lastInspection: '2026-09-02',
    nextInspection: '2026-12-02',
  },
  {
    id: 'fa-101',
    typeId: 'fire-alarm',
    tag: 'FA-101',
    description: T(
      'Pull down firmly to sound the building alarm.',
      'Tirez fermement vers le bas pour déclencher l’alarme.',
    ),
    ...onWall('lobby', 'n', 3.2),
    placements: placed('lobby', featureAngles('lobby', 'alarm', 'n')),
    lastInspection: '2026-06-20',
  },
  {
    id: 'exit-main',
    typeId: 'exit',
    label: T('Main exit', 'Sortie principale'),
    ...onWall('lobby', 's', 0),
    placements: placed('lobby', exitSign('lobby', 's', 0)),
  },
  {
    id: 'fe-102',
    typeId: 'fire-extinguisher',
    tag: 'FE-102',
    description: T('ABC dry chemical, 10 lb.', 'Poudre ABC, 10 lb.'),
    ...onWall('corridor', 'e', -6),
    placements: placed('corridor', featureAngles('corridor', 'extinguisher', 'e')),
    lastInspection: '2026-09-15',
    nextInspection: '2026-10-15',
  },
  {
    id: 'fa-102',
    typeId: 'fire-alarm',
    tag: 'FA-102',
    ...onWall('corridor', 'w', -6.5),
    placements: placed('corridor', featureAngles('corridor', 'alarm', 'w')),
    lastInspection: '2026-06-20',
  },
  {
    id: 'exit-north',
    typeId: 'exit',
    label: T('North exit', 'Sortie nord'),
    ...onWall('corridor', 'n', 0),
    placements: placed('corridor', exitSign('corridor', 'n', 0)),
  },
  {
    id: 'fe-103',
    typeId: 'fire-extinguisher',
    tag: 'FE-103',
    ...onWall('stairwell', 's', 1.2),
    placements: placed('stairwell', featureAngles('stairwell', 'extinguisher', 's')),
    lastInspection: '2026-09-15',
    nextInspection: '2026-10-15',
  },
  {
    id: 'hz-stairs',
    typeId: 'hazard',
    label: T('Caution: steep stairs', 'Attention : escalier abrupt'),
    description: T('Use the handrail.', 'Utilisez la main courante.'),
    ...onWall('stairwell', 'e', 1),
    placements: placed('stairwell', featureAngles('stairwell', 'hazard', 'e')),
  },
  {
    id: 'ap-a',
    typeId: 'assembly-point',
    label: T('Assembly point A — front lawn', 'Point de rassemblement A — pelouse avant'),
    description: T(
      'Report to your floor warden. Do not leave until you are accounted for.',
      'Présentez-vous à votre responsable d’étage. Ne partez pas avant d’avoir été compté.',
    ),
    floorId: 'f1',
    planPosition: plan(...roomOrigin('assembly')),
    placements: placed('assembly', { yaw: 20, pitch: 5.25 }),
  },
  // Second floor
  {
    id: 'fak-201',
    typeId: 'first-aid',
    tag: 'FAK-201',
    description: T('Type 2 kit. Inspected monthly.', 'Trousse de type 2. Inspectée chaque mois.'),
    ...onWall('office', 'n', -2),
    placements: placed('office', featureAngles('office', 'first-aid', 'n')),
    lastInspection: '2026-10-01',
    nextInspection: '2026-11-01',
  },
  {
    id: 'fe-201',
    typeId: 'fire-extinguisher',
    tag: 'FE-201',
    ...onWall('office', 'n', 2),
    placements: placed('office', featureAngles('office', 'extinguisher', 'n')),
    lastInspection: '2026-09-15',
    nextInspection: '2026-10-15',
  },
  {
    id: 'fa-201',
    typeId: 'fire-alarm',
    tag: 'FA-201',
    ...onWall('office', 'w', 2),
    placements: placed('office', featureAngles('office', 'alarm', 'w')),
    lastInspection: '2026-06-20',
  },
  {
    id: 'aed-2',
    typeId: 'aed',
    tag: 'AED-2',
    description: T(
      'Automated external defibrillator, second floor. Open the cabinet and follow the voice prompts.',
      'Défibrillateur externe automatisé, deuxième étage. Ouvrez l’armoire et suivez les instructions vocales.',
    ),
    ...onWall('office', 'w', 4.2),
    placements: placed('office', featureAngles('office', 'aed', 'w')),
    lastInspection: '2026-09-02',
    nextInspection: '2026-12-02',
  },
  {
    id: 'exit-office',
    typeId: 'exit',
    label: T('Exit to stairwell A', 'Sortie vers l’escalier A'),
    ...onWall('office', 's', 0),
    placements: placed('office', exitSign('office', 's', 0)),
  },
  {
    id: 'fe-202',
    typeId: 'fire-extinguisher',
    tag: 'FE-202',
    description: T('CO2, 10 lb. For electrical fires.', 'CO2, 10 lb. Pour les feux électriques.'),
    ...onWall('electrical', 'w', 0.5),
    placements: placed('electrical', featureAngles('electrical', 'extinguisher', 'w')),
    lastInspection: '2026-09-15',
    nextInspection: '2026-10-15',
    audienceIds: FR,
  },
  {
    id: 'hz-electrical',
    typeId: 'hazard',
    label: T('Electrical hazard', 'Danger électrique'),
    description: T('600 V. Qualified personnel only.', '600 V. Personnel qualifié seulement.'),
    ...onWall('electrical', 'n', 1.4),
    placements: placed('electrical', featureAngles('electrical', 'hazard', 'n')),
    audienceIds: FR,
  },
  // First-responder layer
  {
    id: 'facp',
    typeId: 'fire-alarm-panel',
    tag: 'FACP',
    description: T(
      'Annunciator: zone 1 ground floor, zone 2 second floor. Silence and reset keys in the key box.',
      'Annonciateur : zone 1 rez-de-chaussée, zone 2 deuxième étage. Clés de silence et de réarmement dans la boîte à clés.',
    ),
    ...onWall('lobby', 's', 2.4),
    placements: placed('lobby', featureAngles('lobby', 'panel', 's')),
    audienceIds: FR,
  },
  {
    id: 'riser-a',
    typeId: 'sprinkler-riser',
    tag: 'SPR-A',
    description: T(
      'Wet system serving both floors. Main control valve, chained open.',
      'Système sous eau desservant les deux étages. Vanne principale, enchaînée ouverte.',
    ),
    ...onWall('stairwell', 's', -1.2),
    placements: placed('stairwell', featureAngles('stairwell', 'panel', 's')),
    lastInspection: '2026-08-12',
    audienceIds: FR,
  },
  {
    id: 'fdc',
    typeId: 'fire-department-connection',
    tag: 'FDC',
    description: T(
      'Siamese connection on the front wall, west of the main entrance.',
      'Raccord siamois sur la façade, à l’ouest de l’entrée principale.',
    ),
    floorId: 'f1',
    planPosition: plan(-3, 4.3),
    audienceIds: FR,
  },
  {
    id: 'key-box',
    typeId: 'key-box',
    tag: 'KNOX',
    description: T('Right of the main entrance.', 'À droite de l’entrée principale.'),
    floorId: 'f1',
    planPosition: plan(1.4, 4.3),
    audienceIds: FR,
  },
  {
    id: 'elec-main',
    typeId: 'electrical-shutoff',
    tag: 'MDP',
    description: T(
      'Main breaker top left. 600 V.',
      'Disjoncteur principal en haut à gauche. 600 V.',
    ),
    ...onWall('electrical', 'n', 0),
    placements: placed('electrical', featureAngles('electrical', 'panel', 'n')),
    audienceIds: FR,
  },
].map((e) => ({ ...e, confirmed: DEMO_CONFIRMATION }));

export const zones: Input['zones'] = (
  [
    ['lobby', T('Main lobby', 'Hall principal')],
    ['corridor', T('East corridor', 'Couloir est')],
    ['stairwell', T('Stairwell A', 'Escalier A')],
    ['office', T('Open office', 'Bureau ouvert')],
    ['electrical', T('Electrical room', 'Salle électrique')],
  ] as const
).map(([id, name]) => {
  const r = roomRect(id);
  return {
    id: `zone-${id}`,
    name: { ...name },
    kind: 'department' as const,
    floorId: ROOMS[id]!.floor,
    polygon: [
      plan(r.xMin, r.zMin),
      plan(r.xMax, r.zMin),
      plan(r.xMax, r.zMax),
      plan(r.xMin, r.zMax),
    ],
  };
});

const path = (...p: [number, number][]) => p.map(([x, z]) => plan(x, z));
const heading = (scene: string, x: number, z: number) => ({
  sceneId: scene,
  heading: { yaw: yawTo(scene, x, z), pitch: -12 },
});

/** Shared by both routes: the second floor down stairwell A to the ground-floor lobby. */
const upstairs = [
  { floorId: 'f2', points: path([-2, -15], [0, -15], [8, -15], [8, -13]) },
  { floorId: 'f2', points: path([8, -13], [8, -7], [8, -4]) },
];
const upstairsStarts = [
  heading('electrical', 0, -15),
  heading('office', 8, -7),
  heading('stairwell', 6, -1),
];

export const routes: Input['routes'] = [
  {
    id: 'route-south',
    name: T('Main exit (south)', 'Sortie principale (sud)'),
    priority: 'primary',
    segments: [
      ...upstairs,
      { floorId: 'f1', points: path([8, -4], [8, -1], [6, -1], [0, -1], [0, 4], [0, 20]) },
      { floorId: 'f1', points: path([2, -8], [2, -5], [2, -1]) },
    ],
    sceneSequence: ['office', 'stairwell', 'lobby', 'assembly'],
    starts: [
      ...upstairsStarts,
      heading('corridor', 2, -5),
      heading('lobby', 0, 4),
      { sceneId: 'assembly', heading: { yaw: 20, pitch: -6 } },
    ],
    assemblyPointId: 'ap-a',
    confirmed: DEMO_CONFIRMATION,
  },
  {
    id: 'route-north',
    name: T('North exit by the east corridor', 'Sortie nord par le couloir est'),
    priority: 'secondary',
    segments: [
      ...upstairs,
      {
        floorId: 'f1',
        points: path(
          [8, -4],
          [8, -1],
          [6, -1],
          [2, -1],
          [2, -5],
          [2, -24],
          [2, -27],
          [-10, -27],
          [-10, 20],
          [0, 20],
        ),
      },
    ],
    sceneSequence: ['office', 'stairwell', 'lobby', 'corridor', 'assembly'],
    starts: [
      ...upstairsStarts,
      heading('lobby', 2, -5),
      heading('corridor', 2, -24),
      { sceneId: 'assembly', heading: { yaw: 20, pitch: -6 } },
    ],
    assemblyPointId: 'ap-a',
    confirmed: DEMO_CONFIRMATION,
  },
];

export const postings: Input['postings'] = [
  {
    id: 'post-lobby',
    name: T('Main lobby, north wall', 'Hall principal, mur nord'),
    floorId: 'f1',
    planPosition: plan(-1, -4.8),
    facingDeg: 0,
    sceneId: 'lobby',
  },
  {
    id: 'post-office',
    name: T('Open office, by the stair door', 'Bureau ouvert, près de la porte de l’escalier'),
    floorId: 'f2',
    planPosition: plan(6, -7.2),
    facingDeg: 180,
    sceneId: 'office',
  },
];
