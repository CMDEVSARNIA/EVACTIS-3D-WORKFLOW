import { EnvironmentSchema, type Environment } from '@evactis-3dworkflow/schema';
import { demoEnvironment } from '@evactis-3dworkflow/demo-facility/environment';
import { describe, expect, it } from 'vitest';
import { EditError, InUseError } from './ops.ts';
import * as t from './trainingOps.ts';

const valid = (env: Environment) => {
  const r = EnvironmentSchema.safeParse(env);
  if (!r.success)
    throw new Error(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
};

describe('training editing operations', () => {
  it('creates a module and adds every kind of step with sensible defaults', () => {
    const env = demoEnvironment();
    const id = t.addModule(env, { en: 'Fire warden basics', fr: 'Bases du responsable' });
    expect(id).toBe('fire-warden-basics');
    expect(t.trainingModule(env, id)).toMatchObject({ startSceneId: 'lobby', passMark: 80 });
    for (const kind of t.STEP_KINDS)
      t.addStep(env, id, kind, { sceneId: 'office', view: { yaw: -129.814, pitch: -22.28 } });
    const steps = t.trainingModule(env, id).steps;
    expect(steps.map((s) => s.kind)).toEqual(['reach-exit', ...t.STEP_KINDS]);
    expect(steps[1]).toMatchObject({
      sceneId: 'office',
      instruction: { en: 'Go to: Open office' },
    });
    expect(steps[2]).toMatchObject({ targetId: 'fe-101' });
    expect(steps[4]).toMatchObject({
      hazards: [{ sceneId: 'office', position: { yaw: -129.81, pitch: -22.28 }, radius: 10 }],
    });
    valid(env);
  });

  it('edits steps, hazards, answers and the checklist; keeps the minimums', () => {
    const env = demoEnvironment();
    const m = 'office-hazards';
    t.addHazard(env, m, 'hunt', 'office', { yaw: 200, pitch: -10 });
    let hunt = t.step(env, m, 'hunt');
    expect(hunt.kind === 'hazard-hunt' && hunt.hazards.at(-1)).toMatchObject({
      id: 'hazard-3',
      position: { yaw: -160, pitch: -10 },
    });
    t.updateStep(env, m, 'hunt', { required: 9, hint: { en: '', fr: '' } });
    hunt = t.step(env, m, 'hunt');
    expect(hunt.kind === 'hazard-hunt' && hunt.required).toBe(3);
    expect(hunt.kind === 'hazard-hunt' && hunt.hint).toBeUndefined();
    t.updateHazard(env, m, 'hunt', 'spill', {
      radius: 80,
      label: { en: 'Wet floor', fr: 'Plancher mouillé' },
    });
    t.removeHazard(env, m, 'hunt', 'hazard-3');
    t.removeHazard(env, m, 'hunt', 'blocked-door');
    expect(() => t.removeHazard(env, m, 'hunt', 'spill')).toThrow(EditError);
    hunt = t.step(env, m, 'hunt');
    expect(hunt.kind === 'hazard-hunt' && hunt.hazards).toMatchObject([
      { id: 'spill', radius: 45 },
    ]);
    expect(hunt.kind === 'hazard-hunt' && hunt.required).toBe(1);

    // Questions: one correct answer; at least two answers.
    const q = 'nearest-exit';
    t.setCorrect(env, q, 'blocked', 'wait');
    const c = t.addChoice(env, q, 'blocked');
    t.updateChoice(env, q, 'blocked', c, { en: 'Call 911', fr: 'Appeler le 911' });
    const blocked = t.step(env, q, 'blocked');
    expect(
      blocked.kind === 'question' && blocked.question.choices.filter((x) => x.correct),
    ).toMatchObject([{ id: 'wait' }]);
    t.removeChoice(env, q, 'blocked', 'wait');
    const after = t.step(env, q, 'blocked');
    expect(after.kind === 'question' && after.question.choices[0]!.correct).toBe(true);

    // Removing a step unlinks the checklist item it ticked; the last step stays.
    t.removeStep(env, q, 'exit');
    expect(t.trainingModule(env, q).checklist[0]!.stepId).toBeUndefined();
    expect(() => t.removeStep(env, q, 'blocked')).toThrow(EditError);
    const item = t.addChecklistItem(env, q);
    t.updateChecklistItem(env, q, item, { label: { en: 'Done', fr: 'Fait' }, stepId: 'blocked' });
    expect(t.trainingModule(env, q).checklist.at(-1)).toMatchObject({ stepId: 'blocked' });
    t.removeChecklistItem(env, q, item);
    valid(env);
  });

  it('moves modules and steps, clamps the pass mark, and refuses removing a module in use', () => {
    const env = demoEnvironment();
    t.moveModule(env, 'aed-floor-2', -1);
    expect(env.modules.map((m) => m.id).slice(0, 2)).toEqual(['aed-floor-2', 'nearest-exit']);
    t.moveStep(env, 'aed-floor-2', 'aed-first', -1);
    expect(t.trainingModule(env, 'aed-floor-2').steps.map((s) => s.id)).toEqual([
      'upstairs',
      'aed-first',
      'find-aed',
    ]);
    t.updateModule(env, 'aed-floor-2', {
      passMark: 140,
      startSceneId: null,
      audienceIds: ['staff'],
    });
    expect(t.trainingModule(env, 'aed-floor-2')).toMatchObject({
      passMark: 100,
      audienceIds: ['staff'],
    });
    expect(t.trainingModule(env, 'aed-floor-2').startSceneId).toBeUndefined();
    valid(env);

    env.hotspots.push({
      id: 'start-training',
      sceneId: 'lobby',
      title: { en: 'Training', fr: 'Formation' },
      position: { kind: 'spherical', yaw: 0, pitch: 0 },
      appearance: { kind: 'button', icon: 'start-module' },
      actions: [{ type: 'startModule', moduleId: 'aed-floor-2' }],
      audienceIds: [],
      hidden: false,
    });
    // Refused (the store then discards the draft, as with every edit).
    expect(() => t.removeModule(structuredClone(env), 'aed-floor-2')).toThrow(InUseError);
    t.removeModule(env, 'office-hazards');
    expect(env.modules.map((m) => m.id)).not.toContain('office-hazards');
  });
});
