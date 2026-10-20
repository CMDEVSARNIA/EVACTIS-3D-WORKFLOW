/**
 * Phase 8 sample training: "find your nearest exit", "locate the AED on floor 2", an
 * office hazard hunt (the boxes and spill drawn in scenes.ts) and a contractors-only
 * orientation. Hazard directions come from the procedural scene, like hotspots.
 */
import type { EnvironmentInput } from '@evactis-3dworkflow/schema';
import { anglesOf, featureAngles } from './scenes.ts';

const T = (en: string, fr: string) => ({ en, fr });

/** The spill drawn on the office floor (scenes.ts), seen from the camera (eye 1.6 m). */
export const officeSpill = anglesOf([-3, -1.6, 2.5]);
export const officeBoxes = featureAngles('office', 'boxes', 'w');

export const modules: NonNullable<EnvironmentInput['modules']> = [
  {
    id: 'nearest-exit',
    title: T('Find your nearest exit', 'Trouvez la sortie la plus proche'),
    description: T(
      'From your desk on the second floor, get out to the assembly point the shortest way.',
      'De votre bureau au deuxième étage, rendez-vous au point de rassemblement par le chemin le plus court.',
    ),
    startSceneId: 'office',
    steps: [
      {
        id: 'exit',
        kind: 'reach-exit',
        instruction: T(
          'The alarm is sounding. Find your nearest exit and get out to the assembly point.',
          'L’alarme retentit. Trouvez la sortie la plus proche et rendez-vous au point de rassemblement.',
        ),
        hint: T(
          'Leave by the exit sign on the south wall, take stairwell A down, then the main exit.',
          'Sortez par l’enseigne de sortie du mur sud, descendez par l’escalier A, puis la sortie principale.',
        ),
        points: 2,
      },
      {
        id: 'blocked',
        kind: 'question',
        question: {
          prompt: T(
            'The main exit is blocked by smoke. What do you do?',
            'La sortie principale est bloquée par la fumée. Que faites-vous?',
          ),
          choices: [
            {
              id: 'north',
              label: T(
                'Use the north exit by the east corridor',
                'Prendre la sortie nord par le couloir est',
              ),
              correct: true,
            },
            { id: 'elevator', label: T('Take the elevator', 'Prendre l’ascenseur') },
            { id: 'wait', label: T('Wait at my desk', 'Attendre à mon bureau') },
          ],
          feedbackCorrect: T(
            'Yes: the alternative route is the north exit.',
            'Oui : l’itinéraire de rechange est la sortie nord.',
          ),
          feedbackIncorrect: T(
            'Never use elevators in a fire. Take the alternative route: the north exit.',
            'N’utilisez jamais l’ascenseur en cas d’incendie. Prenez l’itinéraire de rechange : la sortie nord.',
          ),
        },
      },
    ],
    checklist: [
      {
        id: 'know-exit',
        label: T('I know my nearest exit', 'Je connais ma sortie la plus proche'),
        stepId: 'exit',
      },
      {
        id: 'know-assembly',
        label: T(
          'I know where assembly point A is',
          'Je sais où se trouve le point de rassemblement A',
        ),
      },
    ],
  },
  {
    id: 'aed-floor-2',
    title: T('Locate the AED on floor 2', 'Repérez le DEA du deuxième étage'),
    startSceneId: 'lobby',
    steps: [
      {
        id: 'upstairs',
        kind: 'navigate',
        sceneId: 'office',
        instruction: T(
          'Go up to the open office on the second floor.',
          'Montez au bureau ouvert du deuxième étage.',
        ),
      },
      {
        id: 'find-aed',
        kind: 'find-item',
        targetId: 'aed-2',
        instruction: T(
          'Find the AED and select its sign.',
          'Trouvez le DEA et sélectionnez son enseigne.',
        ),
        hint: T(
          'It is on the west wall, near the corner.',
          'Il est sur le mur ouest, près du coin.',
        ),
      },
      {
        id: 'aed-first',
        kind: 'question',
        question: {
          prompt: T(
            'You open the AED cabinet. What next?',
            'Vous ouvrez l’armoire du DEA. Ensuite?',
          ),
          choices: [
            {
              id: 'prompts',
              label: T(
                'Turn it on and follow the voice prompts',
                'L’allumer et suivre les instructions vocales',
              ),
              correct: true,
            },
            { id: 'manual', label: T('Read the manual first', 'Lire d’abord le manuel') },
          ],
        },
      },
    ],
  },
  {
    id: 'office-hazards',
    title: T('Hazard hunt: open office', 'Chasse aux dangers : bureau ouvert'),
    description: T(
      'Two hazards are hiding in the open office.',
      'Deux dangers se cachent dans le bureau ouvert.',
    ),
    startSceneId: 'office',
    steps: [
      {
        id: 'hunt',
        kind: 'hazard-hunt',
        instruction: T(
          'Look around and select every hazard you see (or turn to it and press Inspect).',
          'Regardez autour et sélectionnez chaque danger (ou tournez-vous vers lui et appuyez sur Inspecter).',
        ),
        hint: T('Check the doors and the floor.', 'Vérifiez les portes et le plancher.'),
        points: 2,
        hazards: [
          {
            id: 'blocked-door',
            sceneId: 'office',
            position: officeBoxes,
            radius: 12,
            label: T('Boxes blocking a door', 'Boîtes qui bloquent une porte'),
          },
          {
            id: 'spill',
            sceneId: 'office',
            position: officeSpill,
            radius: 12,
            label: T('Spill on the floor', 'Déversement sur le plancher'),
          },
        ],
      },
    ],
    checklist: [
      {
        id: 'reported',
        label: T(
          'I will report hazards to my supervisor',
          'Je signalerai les dangers à mon superviseur',
        ),
      },
    ],
  },
  {
    id: 'contractor-orientation',
    title: T('Contractor orientation', 'Accueil des entrepreneurs'),
    audienceIds: ['contractors'],
    startSceneId: 'lobby',
    steps: [
      {
        id: 'pull-station',
        kind: 'find-item',
        targetId: 'fa-101',
        instruction: T(
          'Find the fire alarm pull station in the lobby and select it.',
          'Trouvez l’avertisseur d’incendie du hall et sélectionnez-le.',
        ),
      },
      {
        id: 'way-out',
        kind: 'reach-exit',
        instruction: T(
          'Now get out to the assembly point.',
          'Rendez-vous maintenant au point de rassemblement.',
        ),
      },
    ],
    passMark: 100,
  },
];
