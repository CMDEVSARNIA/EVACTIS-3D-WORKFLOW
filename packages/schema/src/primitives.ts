import { z } from 'zod';

/** Stable identifier used for every entity in an environment. */
export const IdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'IDs use letters, digits, "_", "-" and "." only');
export type Id = z.infer<typeof IdSchema>;

/** BCP 47 language tag, restricted to the simple "xx" / "xx-YY" forms we ship. */
export const LanguageCodeSchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);
export type LanguageCode = z.infer<typeof LanguageCodeSchema>;

/** Languages every EVACTIS 3DWORKFLOW environment supports from day one. */
export const DEFAULT_LANGUAGES = ['en', 'fr'] as const;

/**
 * A user-facing string in one or more languages, e.g. `{ en: "Exit", fr: "Sortie" }`.
 * Missing translations are reported by `findMissingTranslations`, not rejected, so
 * work-in-progress projects stay valid.
 */
export const LocalizedTextSchema = z
  .record(LanguageCodeSchema, z.string())
  .refine((v) => Object.keys(v).length > 0, 'At least one language is required');
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * Path to a file inside the environment package. Always relative, forward slashes,
 * never escaping the package root. This is what keeps the Viewer free of network
 * requests: there is no way to express a remote asset in the document.
 */
export const AssetPathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((p) => !URL_SCHEME.test(p), 'Asset paths must be relative (no URL scheme)')
  .refine((p) => !p.startsWith('/') && !p.startsWith('//'), 'Asset paths must be relative')
  .refine((p) => !p.includes('\\'), 'Use forward slashes in asset paths')
  .refine((p) => !p.split('/').includes('..'), 'Asset paths may not leave the package');
export type AssetPath = z.infer<typeof AssetPathSchema>;

/** ISO calendar date, e.g. 2026-10-14. */
export const IsoDateSchema = z.iso.date();
/** ISO timestamp with offset. */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

/** Direction in a panorama, in degrees. Yaw 0 = scene forward, positive = right. */
export const SphericalSchema = z.object({
  yaw: z.number().min(-180).max(180),
  pitch: z.number().min(-90).max(90),
});
export type Spherical = z.infer<typeof SphericalSchema>;

export const ViewSchema = SphericalSchema.extend({
  fov: z.number().min(10).max(140).default(90),
});
export type View = z.infer<typeof ViewSchema>;

/** Point in floor-plan image pixels (origin top-left). */
export const PlanPointSchema = z.object({ x: z.number(), y: z.number() });
export type PlanPoint = z.infer<typeof PlanPointSchema>;

/** Point in a 3D scene (GLB / splat), metres, Y up. */
export const WorldPointSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });
export type WorldPoint = z.infer<typeof WorldPointSchema>;

/** Records who placed or confirmed safety-critical content. Never set automatically. */
export const HumanConfirmationSchema = z.object({
  by: z.string().min(1),
  at: IsoDateTimeSchema,
});
export type HumanConfirmation = z.infer<typeof HumanConfirmationSchema>;

/** Audience IDs an item is visible to. Empty or omitted = every audience. */
export const AudienceFilterSchema = z.array(IdSchema).default([]);
