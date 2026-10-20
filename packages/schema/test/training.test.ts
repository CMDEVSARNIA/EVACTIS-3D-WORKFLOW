import { describe, expect, it } from 'vitest';
import { EnvironmentSchema, checkReferences, type EnvironmentInput } from '../src/index.ts';

const T = (en: string, fr: string) => ({ en, fr });

function env(modules: unknown[]): EnvironmentInput {
  return {
    schemaVersion: 1,
    id: 'site',
    title: T('Site', 'Site'),
    facility: { name: T('Site', 'Site') },
    createdAt: '2026-10-01T09:00:00-04:00',
    updatedAt: '2026-10-01T09:00:00-04:00',
    scenes: [
      { id: 'lobby', name: T('Lobby', 'Hall'), media: { type: 'equirect', source: 'm/a.jpg' } },
    ],
    modules: modules as EnvironmentInput['modules'],
  };
}

const parse = (m: unknown[]) => EnvironmentSchema.parse(env(m));

describe('training modules', () => {
  it('accepts every step kind with points and hints, and checklist items linked to steps', () => {
    const e = parse([
      {
        id: 'm1',
        title: T('Exit', 'Sortie'),
        startSceneId: 'lobby',
        steps: [
          { id: 's1', kind: 'navigate', sceneId: 'lobby', instruction: T('Go', 'Allez') },
          { id: 's2', kind: 'reach-exit', instruction: T('Exit', 'Sortez'), hint: T('h', 'i') },
          {
            id: 's3',
            kind: 'hazard-hunt',
            instruction: T('Find', 'Trouvez'),
            points: 2,
            hazards: [
              {
                id: 'h1',
                sceneId: 'lobby',
                position: { yaw: 10, pitch: -5 },
                label: T('Box', 'Boîte'),
              },
            ],
          },
          {
            id: 's4',
            kind: 'question',
            question: {
              prompt: T('Q', 'Q'),
              choices: [
                { id: 'a', label: T('A', 'A'), correct: true },
                { id: 'b', label: T('B', 'B') },
              ],
            },
          },
        ],
        checklist: [
          { id: 'c1', label: T('Done', 'Fait'), stepId: 's2' },
          { id: 'c2', label: T('I know', 'Je sais') },
        ],
      },
    ]);
    const m = e.modules[0]!;
    expect(m.steps.map((s) => s.kind)).toEqual([
      'navigate',
      'reach-exit',
      'hazard-hunt',
      'question',
    ]);
    expect(m.steps[0]).toMatchObject({ points: 1 });
    expect(m.steps[2]).toMatchObject({ points: 2, hazards: [{ radius: 10 }] });
    expect(m).toMatchObject({ passMark: 80, certificate: true });
    expect(checkReferences(e)).toEqual([]);
  });

  it('reports unknown scenes, steps and duplicate step ids', () => {
    const r = EnvironmentSchema.safeParse(
      env([
        {
          id: 'm1',
          title: T('M', 'M'),
          startSceneId: 'nowhere',
          steps: [
            { id: 's1', kind: 'navigate', sceneId: 'lobby', instruction: T('a', 'b') },
            {
              id: 's1',
              kind: 'hazard-hunt',
              instruction: T('a', 'b'),
              required: 3,
              hazards: [
                { id: 'h', sceneId: 'attic', position: { yaw: 0, pitch: 0 }, label: T('x', 'y') },
              ],
            },
          ],
          checklist: [{ id: 'c', label: T('x', 'y'), stepId: 'missing' }],
        },
      ]),
    );
    expect(r.success).toBe(false);
    const msgs = r.error!.issues.map((i) => i.message);
    expect(msgs).toEqual(
      expect.arrayContaining([
        'Unknown scene "nowhere"',
        'Duplicate step id "s1"',
        'Unknown scene "attic"',
        'More hazards required than there are',
        'Unknown step "missing"',
      ]),
    );
  });
});
