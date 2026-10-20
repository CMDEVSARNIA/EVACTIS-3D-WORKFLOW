/**
 * Completion certificate, loaded only when a learner asks for one: pdf-lib, fontkit and
 * the static Inter weights live in this lazy chunk, outside the core bundle. The fonts
 * and lockup are inlined at build time, so nothing is fetched to make the PDF.
 */
import { certificatePdf as render } from '@evactis-3dworkflow/print';
import regular from '@evactis-3dworkflow/brand/fonts/print/inter-latin-400-normal.woff?inline';
import semibold from '@evactis-3dworkflow/brand/fonts/print/inter-latin-600-normal.woff?inline';
import bold from '@evactis-3dworkflow/brand/fonts/print/inter-latin-700-normal.woff?inline';
import extrabold from '@evactis-3dworkflow/brand/fonts/print/inter-latin-800-normal.woff?inline';
import logo from '@evactis-3dworkflow/brand/generated/print/product-lockup.png?inline';
import type { Environment, LocalizedText, TrainingModule } from '@evactis-3dworkflow/schema';
import { localize } from '@evactis-3dworkflow/schema';
import type { ModuleResult } from './training.ts';

/** Bytes of a base64 data URI. */
function bytes(dataUri: string): Uint8Array {
  const b64 = dataUri.slice(dataUri.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const both = (x: LocalizedText) => ({ en: localize(x, 'en'), fr: localize(x, 'fr') });

export function certificatePdf(
  env: Environment,
  module: TrainingModule,
  result: ModuleResult,
  learner: string,
): Promise<Uint8Array> {
  return render(
    {
      learner,
      module: both(module.title),
      facility: both(env.facility.name),
      score: result.score,
      max: result.max,
      percent: result.percent,
      date: result.finishedAt.slice(0, 10),
    },
    {
      fonts: {
        regular: bytes(regular),
        semibold: bytes(semibold),
        bold: bytes(bold),
        extrabold: bytes(extrabold),
      },
      logo: bytes(logo),
    },
  );
}
