/**
 * What packages/print needs, gathered in Studio: the brand's static Inter weights, sign
 * and lockup images (bundled with the app), and the project's plan images (read through
 * the media-scoped Rust command). Nothing is fetched from outside the app or project.
 */
import type { Environment, SafetySignName } from '@evactis-3dworkflow/schema';
import regular from '@evactis-3dworkflow/brand/fonts/print/inter-latin-400-normal.woff?url';
import semibold from '@evactis-3dworkflow/brand/fonts/print/inter-latin-600-normal.woff?url';
import bold from '@evactis-3dworkflow/brand/fonts/print/inter-latin-700-normal.woff?url';
import extrabold from '@evactis-3dworkflow/brand/fonts/print/inter-latin-800-normal.woff?url';
import logo from '@evactis-3dworkflow/brand/generated/print/product-lockup.png?url';
import aed from '@evactis-3dworkflow/brand/generated/print/sign-aed.png?url';
import assembly from '@evactis-3dworkflow/brand/generated/print/sign-assembly-point.png?url';
import exit from '@evactis-3dworkflow/brand/generated/print/sign-emergency-exit.png?url';
import alarm from '@evactis-3dworkflow/brand/generated/print/sign-fire-alarm.png?url';
import extinguisher from '@evactis-3dworkflow/brand/generated/print/sign-fire-extinguisher.png?url';
import firstAid from '@evactis-3dworkflow/brand/generated/print/sign-first-aid.png?url';
import warning from '@evactis-3dworkflow/brand/generated/print/sign-warning.png?url';
import type { PlanAssets } from '@evactis-3dworkflow/print';
import { api } from '../api.ts';

const bytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());

const SIGNS: Record<SafetySignName, string> = {
  aed,
  'assembly-point': assembly,
  'emergency-exit': exit,
  'fire-alarm': alarm,
  'fire-extinguisher': extinguisher,
  'first-aid': firstAid,
  warning,
};

/** Loads everything once; plan images for the given floors are read up front. */
export async function loadPrintAssets(env: Environment, floorIds: string[]): Promise<PlanAssets> {
  const [r, s, b, x, l] = await Promise.all([regular, semibold, bold, extrabold, logo].map(bytes));
  const signs = Object.fromEntries(
    await Promise.all(Object.entries(SIGNS).map(async ([k, u]) => [k, await bytes(u)] as const)),
  ) as Record<SafetySignName, Uint8Array>;
  const plans = new Map<string, Uint8Array>();
  for (const f of env.buildings.flatMap((bd) => bd.floors))
    if (floorIds.includes(f.id) && f.plan) plans.set(f.id, await api.readMedia(f.plan.image));
  return {
    fonts: { regular: r!, semibold: s!, bold: b!, extrabold: x! },
    signs,
    logo: l!,
    planImage: (id) => plans.get(id),
  };
}
