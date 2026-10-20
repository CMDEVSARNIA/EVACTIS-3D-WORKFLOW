/**
 * What every delivery package made in Studio carries besides the environment: the
 * producer stamp and the bilingual quick-start PDF (fonts and lockup bundled with Studio).
 */
import type { PackageKind } from '@evactis-3dworkflow/package-format';
import { quickStartPdf } from '@evactis-3dworkflow/print';
import { localize, type Environment } from '@evactis-3dworkflow/schema';
import { loadPrintAssets } from './printAssets.ts';
import pkg from '../../package.json';

export const PRODUCER = `EVACTIS 3DWORKFLOW Studio ${pkg.version}`;

export async function quickStart(
  env: Environment,
  kind: PackageKind,
  createdAt: string,
  encrypted: boolean,
): Promise<Uint8Array> {
  const assets = await loadPrintAssets(env, []);
  return quickStartPdf(
    {
      kind,
      facility: { en: localize(env.facility.name, 'en'), fr: localize(env.facility.name, 'fr') },
      createdAt,
      producer: PRODUCER,
      encrypted,
    },
    { fonts: assets.fonts, logo: assets.logo },
  );
}
