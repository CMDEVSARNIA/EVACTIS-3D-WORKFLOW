import { z } from 'zod';
import {
  AssetPathSchema,
  IdSchema,
  LocalizedTextSchema,
  SphericalSchema,
  ViewSchema,
} from './primitives.ts';

// ---------------------------------------------------------------------------
// Conditions (training logic, conditional hotspots)
// ---------------------------------------------------------------------------

export type ComparisonOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { variable: string; op: ComparisonOp; value: string | number | boolean }
  | { visited: string }
  | { audience: string };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ConditionSchema).min(1) }).strict(),
    z.object({ any: z.array(ConditionSchema).min(1) }).strict(),
    z.object({ not: ConditionSchema }).strict(),
    z
      .object({
        variable: IdSchema,
        op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
        value: z.union([z.string(), z.number(), z.boolean()]),
      })
      .strict(),
    z.object({ visited: IdSchema }).strict(),
    z.object({ audience: IdSchema }).strict(),
  ]),
);

export const VariableSchema = z.discriminatedUnion('kind', [
  z.object({ id: IdSchema, kind: z.literal('boolean'), initial: z.boolean().default(false) }),
  z.object({ id: IdSchema, kind: z.literal('number'), initial: z.number().default(0) }),
  z.object({ id: IdSchema, kind: z.literal('string'), initial: z.string().default('') }),
]);
export type Variable = z.infer<typeof VariableSchema>;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const TransitionSchema = z.object({
  kind: z.enum(['cut', 'fade', 'zoom', 'walk']).default('fade'),
  durationMs: z.number().int().min(0).max(10_000).default(800),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const QuizChoiceSchema = z.object({
  id: IdSchema,
  label: LocalizedTextSchema,
  correct: z.boolean().default(false),
});

export const QuizQuestionSchema = z.object({
  prompt: LocalizedTextSchema,
  choices: z.array(QuizChoiceSchema).min(2),
  points: z.number().min(0).default(1),
  feedbackCorrect: LocalizedTextSchema.optional(),
  feedbackIncorrect: LocalizedTextSchema.optional(),
});
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const PopupContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), body: LocalizedTextSchema }),
  z.object({ kind: z.literal('image'), source: AssetPathSchema, alt: LocalizedTextSchema }),
  z.object({ kind: z.literal('video'), source: AssetPathSchema }),
  z.object({ kind: z.literal('pdf'), documentId: IdSchema }),
  z.object({ kind: z.literal('model3d'), source: AssetPathSchema }),
]);

const base = { condition: ConditionSchema.optional() };

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('goToScene'),
    sceneId: IdSchema,
    transition: TransitionSchema.default({ kind: 'fade', durationMs: 800 }),
    view: ViewSchema.optional(),
  }),
  z.object({
    ...base,
    type: z.literal('openPopup'),
    title: LocalizedTextSchema.optional(),
    content: PopupContentSchema,
  }),
  z.object({
    ...base,
    type: z.literal('openUrl'),
    /**
     * Local package file by default. External (http/https) URLs are blocked by the
     * Viewer unless `settings.offlineLinkPolicy` is `allow-external`.
     */
    url: z.string().min(1),
  }),
  z.object({ ...base, type: z.literal('openDocument'), documentId: IdSchema }),
  z.object({
    ...base,
    type: z.literal('playAudio'),
    audioId: IdSchema,
    restart: z.boolean().default(true),
  }),
  z.object({ ...base, type: z.literal('stopAudio'), audioId: IdSchema }),
  z.object({
    ...base,
    type: z.literal('setVisibility'),
    targetIds: z.array(IdSchema).min(1),
    visible: z.union([z.boolean(), z.literal('toggle')]),
  }),
  z.object({
    ...base,
    type: z.literal('setVariable'),
    variable: IdSchema,
    op: z.enum(['set', 'add', 'toggle']).default('set'),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  }),
  z.object({ ...base, type: z.literal('askQuestion'), question: QuizQuestionSchema }),
  z.object({ ...base, type: z.literal('startModule'), moduleId: IdSchema }),
  z.object({ ...base, type: z.literal('showFloorPlan'), floorId: IdSchema.optional() }),
  z.object({
    ...base,
    type: z.literal('showRoute'),
    /** Omit to show the nearest primary route from the current scene. */
    routeId: IdSchema.optional(),
  }),
  z.object({
    ...base,
    type: z.literal('setLiveLayer'),
    layerId: IdSchema,
    stateId: IdSchema,
  }),
  z.object({ ...base, type: z.literal('lookAt'), view: SphericalSchema }),
]);
export type Action = z.infer<typeof ActionSchema>;
export type ActionType = Action['type'];
