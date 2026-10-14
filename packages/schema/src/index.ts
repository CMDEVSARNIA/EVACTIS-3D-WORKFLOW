import type { z } from 'zod';
import { EnvironmentObjectSchema, type Environment } from './environment.ts';
import { migrateEnvironment } from './migrations.ts';
import { checkReferences } from './references.ts';

export * from './primitives.ts';
export * from './kit.ts';
export * from './actions.ts';
export * from './environment.ts';
export * from './references.ts';
export * from './translations.ts';
export * from './migrations.ts';

/** Full validator: field shapes plus unique IDs and reference integrity. */
export const EnvironmentSchema = EnvironmentObjectSchema.superRefine((env, ctx) => {
  for (const issue of checkReferences(env))
    ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
});

export type ParseResult =
  | { success: true; environment: Environment }
  | { success: false; error: z.ZodError | Error };

/** Migrates then validates an environment loaded from disk. Never throws. */
export function parseEnvironment(raw: unknown): ParseResult {
  try {
    const migrated = migrateEnvironment(raw);
    const result = EnvironmentSchema.safeParse(migrated);
    return result.success
      ? { success: true, environment: result.data }
      : { success: false, error: result.error };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** A minimal valid environment for new projects. */
export function createEmptyEnvironment(
  id: string,
  title: { en: string; fr: string },
  now: Date = new Date(),
): Environment {
  const stamp = now.toISOString();
  return EnvironmentSchema.parse({
    schemaVersion: 1,
    id,
    title,
    facility: { name: title },
    createdAt: stamp,
    updatedAt: stamp,
    audiences: [
      { id: 'staff', name: { en: 'Staff', fr: 'Personnel' } },
      { id: 'contractors', name: { en: 'Contractors', fr: 'Entrepreneurs' } },
      { id: 'leadership', name: { en: 'Leadership', fr: 'Direction' } },
      { id: 'first-responders', name: { en: 'First Responders', fr: 'Premiers intervenants' } },
    ],
    settings: { defaultAudienceId: 'staff' },
  });
}
