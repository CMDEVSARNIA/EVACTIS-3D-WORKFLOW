/**
 * Training editing operations (Phase 8): modules, their steps (go somewhere, find an
 * item, find the nearest exit, hazard hunt, question), hazards placed in the preview,
 * answers, and the module checklist. Hazards and targets are placed by the author;
 * nothing is generated.
 */
import {
  localize,
  type Environment,
  type LocalizedText,
  type ModuleStep,
  type Spherical,
  type TrainingModule,
} from '@evactis-3dworkflow/schema';
import { assertNoDanglingReferences, EditError, uniqueId, wrapDeg } from './ops.ts';

export type StepKind = ModuleStep['kind'];
export const STEP_KINDS: StepKind[] = [
  'navigate',
  'find-item',
  'reach-exit',
  'hazard-hunt',
  'question',
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const at = (p: Spherical): Spherical => ({ yaw: r2(wrapDeg(p.yaw)), pitch: r2(p.pitch) });
const both = (x: LocalizedText | undefined) => ({
  en: x ? localize(x, 'en') : '',
  fr: x ? localize(x, 'fr') : '',
});

export function trainingModule(env: Environment, id: string): TrainingModule {
  const m = env.modules.find((x) => x.id === id);
  if (!m) throw new EditError(`unknown module ${id}`);
  return m;
}

export function step(env: Environment, moduleId: string, stepId: string): ModuleStep {
  const s = trainingModule(env, moduleId).steps.find((x) => x.id === stepId);
  if (!s) throw new EditError(`unknown step ${stepId}`);
  return s;
}

/** Things a find-item step can point at: placed equipment, then hotspots. */
export function findTargets(env: Environment, lang: string) {
  return [
    ...env.equipment
      .filter((e) => e.placements.length)
      .map((e) => {
        const type = env.equipmentTypes.find((t) => t.id === e.typeId);
        const name = e.label ?? type?.name ?? { en: e.typeId };
        return { id: e.id, label: `${e.tag ? `${e.tag} · ` : ''}${localize(name, lang)}` };
      }),
    ...env.hotspots.map((h) => ({ id: h.id, label: localize(h.title, lang) })),
  ];
}

function targetName(env: Environment, id: string): LocalizedText {
  const e = env.equipment.find((x) => x.id === id);
  if (e) return both(e.label ?? env.equipmentTypes.find((t) => t.id === e.typeId)?.name);
  return both(env.hotspots.find((h) => h.id === id)?.title);
}

// ---------------------------------------------------------------------------- modules

export function addModule(env: Environment, title: LocalizedText): string {
  const id = uniqueId(
    localize(title, 'en') || 'module',
    env.modules.map((m) => m.id),
  );
  const first = env.initialSceneId ?? env.scenes[0]?.id;
  env.modules.push({
    id,
    title,
    audienceIds: [],
    ...(first && { startSceneId: first }),
    steps: [
      {
        id: 'step-1',
        kind: 'reach-exit',
        instruction: { en: '', fr: '' },
        points: 1,
      },
    ],
    checklist: [],
    passMark: 80,
    certificate: true,
  });
  return id;
}

export function updateModule(
  env: Environment,
  id: string,
  patch: Partial<
    Pick<TrainingModule, 'title' | 'description' | 'audienceIds' | 'passMark' | 'certificate'>
  > & { startSceneId?: string | null },
) {
  const m = trainingModule(env, id);
  const { startSceneId, ...rest } = patch;
  Object.assign(m, rest);
  if (rest.passMark !== undefined)
    m.passMark = Math.max(0, Math.min(100, Math.round(rest.passMark)));
  if (startSceneId === null) delete m.startSceneId;
  else if (startSceneId !== undefined) m.startSceneId = startSceneId;
  if (m.description && !Object.values(m.description).some(Boolean)) delete m.description;
}

/** Removes a module; refused while a "start module" action still uses it. */
export function removeModule(env: Environment, id: string) {
  env.modules = env.modules.filter((m) => m.id !== id);
  assertNoDanglingReferences(env);
}

export function moveModule(env: Environment, id: string, delta: -1 | 1) {
  const i = env.modules.findIndex((m) => m.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= env.modules.length) return;
  [env.modules[i], env.modules[j]] = [env.modules[j]!, env.modules[i]!];
}

// ---------------------------------------------------------------------------- steps

/**
 * Adds a step after the others. `here` is the scene (and view centre) the author is
 * looking at: a navigate step goes there, a hazard hunt's first hazard sits there.
 */
export function addStep(
  env: Environment,
  moduleId: string,
  kind: StepKind,
  here: { sceneId: string | null; view?: Spherical },
): string {
  const m = trainingModule(env, moduleId);
  const id = uniqueId(
    `step-${m.steps.length + 1}`,
    m.steps.map((s) => s.id),
  );
  const sceneId = here.sceneId ?? env.scenes[0]?.id;
  const scene = env.scenes.find((s) => s.id === sceneId);
  let s: ModuleStep;
  switch (kind) {
    case 'navigate': {
      if (!scene) throw new EditError('add a scene first');
      const n = both(scene.name);
      s = {
        id,
        kind,
        sceneId: scene.id,
        instruction: { en: `Go to: ${n.en}`, fr: `Allez à : ${n.fr}` },
        points: 1,
      };
      break;
    }
    case 'find-item': {
      const target = findTargets(env, 'en')[0];
      if (!target) throw new EditError('place equipment or a hotspot first');
      const n = targetName(env, target.id);
      s = {
        id,
        kind,
        targetId: target.id,
        instruction: {
          en: `Find: ${n.en}. Select it when you see it.`,
          fr: `Trouvez : ${n.fr}. Sélectionnez-le quand vous le voyez.`,
        },
        points: 1,
      };
      break;
    }
    case 'reach-exit':
      s = { id, kind, instruction: { en: '', fr: '' }, points: 1 };
      break;
    case 'hazard-hunt':
      if (!scene) throw new EditError('add a scene first');
      s = {
        id,
        kind,
        instruction: {
          en: 'Look around and select every hazard you see.',
          fr: 'Regardez autour et sélectionnez chaque danger.',
        },
        points: 1,
        hazards: [
          {
            id: 'hazard-1',
            sceneId: scene.id,
            position: at(here.view ?? { yaw: 0, pitch: 0 }),
            radius: 10,
            label: { en: 'Hazard 1', fr: 'Danger 1' },
          },
        ],
      };
      break;
    case 'question':
      s = {
        id,
        kind,
        question: {
          prompt: { en: '', fr: '' },
          choices: [
            { id: 'a', label: { en: '', fr: '' }, correct: true },
            { id: 'b', label: { en: '', fr: '' }, correct: false },
          ],
          points: 1,
        },
      };
      break;
  }
  m.steps.push(s);
  return id;
}

type StepPatch = {
  instruction?: LocalizedText;
  hint?: LocalizedText | null;
  points?: number;
  sceneId?: string;
  targetId?: string;
  required?: number | null;
  prompt?: LocalizedText;
  feedbackCorrect?: LocalizedText | null;
  feedbackIncorrect?: LocalizedText | null;
};

export function updateStep(env: Environment, moduleId: string, stepId: string, patch: StepPatch) {
  const s = step(env, moduleId, stepId);
  const empty = (x: LocalizedText | null | undefined) => !x || !Object.values(x).some(Boolean);
  if (s.kind === 'question') {
    const q = s.question;
    if (patch.prompt) q.prompt = patch.prompt;
    if (patch.points !== undefined) q.points = Math.max(0, r2(patch.points));
    for (const k of ['feedbackCorrect', 'feedbackIncorrect'] as const) {
      const v = patch[k];
      if (v === undefined) continue;
      if (empty(v)) delete q[k];
      else q[k] = v!;
    }
    return;
  }
  if (patch.instruction) s.instruction = patch.instruction;
  if (patch.hint !== undefined) {
    if (empty(patch.hint)) delete s.hint;
    else s.hint = patch.hint!;
  }
  if (patch.points !== undefined) s.points = Math.max(0, Math.min(100, r2(patch.points)));
  if (patch.sceneId !== undefined && s.kind === 'navigate') s.sceneId = patch.sceneId;
  if (patch.targetId !== undefined && s.kind === 'find-item') s.targetId = patch.targetId;
  if (patch.required !== undefined && s.kind === 'hazard-hunt') {
    if (patch.required === null) delete s.required;
    else s.required = Math.max(1, Math.min(s.hazards.length, Math.round(patch.required)));
  }
}

/** Removes a step (a module keeps at least one); checklist items it ticked are unlinked. */
export function removeStep(env: Environment, moduleId: string, stepId: string) {
  const m = trainingModule(env, moduleId);
  if (m.steps.length <= 1) throw new EditError('a module needs at least one step');
  m.steps = m.steps.filter((s) => s.id !== stepId);
  for (const c of m.checklist) if (c.stepId === stepId) delete c.stepId;
}

export function moveStep(env: Environment, moduleId: string, stepId: string, delta: -1 | 1) {
  const steps = trainingModule(env, moduleId).steps;
  const i = steps.findIndex((s) => s.id === stepId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= steps.length) return;
  [steps[i], steps[j]] = [steps[j]!, steps[i]!];
}

// ---------------------------------------------------------------------------- hazards

function hunt(env: Environment, moduleId: string, stepId: string) {
  const s = step(env, moduleId, stepId);
  if (s.kind !== 'hazard-hunt') throw new EditError('not a hazard hunt');
  return s;
}

/** Adds a hazard where the author clicked in the preview. */
export function addHazard(
  env: Environment,
  moduleId: string,
  stepId: string,
  sceneId: string,
  position: Spherical,
): string {
  const s = hunt(env, moduleId, stepId);
  const n = s.hazards.length + 1;
  const id = uniqueId(
    `hazard-${n}`,
    s.hazards.map((h) => h.id),
  );
  s.hazards.push({
    id,
    sceneId,
    position: at(position),
    radius: 10,
    label: { en: `Hazard ${n}`, fr: `Danger ${n}` },
  });
  return id;
}

export function updateHazard(
  env: Environment,
  moduleId: string,
  stepId: string,
  hazardId: string,
  patch: { label?: LocalizedText; radius?: number; sceneId?: string; position?: Spherical },
) {
  const h = hunt(env, moduleId, stepId).hazards.find((x) => x.id === hazardId);
  if (!h) throw new EditError(`unknown hazard ${hazardId}`);
  if (patch.label) h.label = patch.label;
  if (patch.radius !== undefined) h.radius = Math.max(2, Math.min(45, Math.round(patch.radius)));
  if (patch.sceneId) h.sceneId = patch.sceneId;
  if (patch.position) h.position = at(patch.position);
}

export function removeHazard(env: Environment, moduleId: string, stepId: string, hazardId: string) {
  const s = hunt(env, moduleId, stepId);
  if (s.hazards.length <= 1) throw new EditError('a hazard hunt needs at least one hazard');
  s.hazards = s.hazards.filter((h) => h.id !== hazardId);
  if (s.required !== undefined && s.required > s.hazards.length) s.required = s.hazards.length;
}

// ---------------------------------------------------------------------------- answers

function question(env: Environment, moduleId: string, stepId: string) {
  const s = step(env, moduleId, stepId);
  if (s.kind !== 'question') throw new EditError('not a question');
  return s.question;
}

export function addChoice(env: Environment, moduleId: string, stepId: string): string {
  const q = question(env, moduleId, stepId);
  const id = uniqueId(
    String.fromCharCode(97 + q.choices.length),
    q.choices.map((c) => c.id),
  );
  q.choices.push({ id, label: { en: '', fr: '' }, correct: false });
  return id;
}

export function updateChoice(
  env: Environment,
  moduleId: string,
  stepId: string,
  choiceId: string,
  label: LocalizedText,
) {
  const c = question(env, moduleId, stepId).choices.find((x) => x.id === choiceId);
  if (!c) throw new EditError(`unknown answer ${choiceId}`);
  c.label = label;
}

/** Makes one answer the correct one (questions have exactly one). */
export function setCorrect(env: Environment, moduleId: string, stepId: string, choiceId: string) {
  for (const c of question(env, moduleId, stepId).choices) c.correct = c.id === choiceId;
}

export function removeChoice(env: Environment, moduleId: string, stepId: string, choiceId: string) {
  const q = question(env, moduleId, stepId);
  if (q.choices.length <= 2) throw new EditError('a question needs at least two answers');
  q.choices = q.choices.filter((c) => c.id !== choiceId);
  if (!q.choices.some((c) => c.correct)) q.choices[0]!.correct = true;
}

// ---------------------------------------------------------------------------- checklist

export function addChecklistItem(env: Environment, moduleId: string): string {
  const m = trainingModule(env, moduleId);
  const id = uniqueId(
    `item-${m.checklist.length + 1}`,
    m.checklist.map((c) => c.id),
  );
  m.checklist.push({ id, label: { en: '', fr: '' } });
  return id;
}

export function updateChecklistItem(
  env: Environment,
  moduleId: string,
  itemId: string,
  patch: { label?: LocalizedText; stepId?: string | null },
) {
  const c = trainingModule(env, moduleId).checklist.find((x) => x.id === itemId);
  if (!c) throw new EditError(`unknown checklist item ${itemId}`);
  if (patch.label) c.label = patch.label;
  if (patch.stepId === null) delete c.stepId;
  else if (patch.stepId !== undefined) c.stepId = patch.stepId;
}

export function removeChecklistItem(env: Environment, moduleId: string, itemId: string) {
  const m = trainingModule(env, moduleId);
  m.checklist = m.checklist.filter((c) => c.id !== itemId);
}
