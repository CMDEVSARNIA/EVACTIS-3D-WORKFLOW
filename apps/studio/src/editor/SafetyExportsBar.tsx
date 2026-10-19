import type { Environment } from '@evactis-3dworkflow/schema';
import type { Lang, Strings } from '../i18n.ts';
import { PrintDialog, RegisterDialog } from './SafetyExports.tsx';

/** The print and export buttons beside the Safety sections. */
export function SafetyExports({ t, lang, env }: { t: Strings; lang: Lang; env: Environment }) {
  return (
    <div className="ml-auto flex flex-wrap gap-2">
      <PrintDialog t={t} lang={lang} env={env} />
      <RegisterDialog t={t} lang={lang} env={env} />
    </div>
  );
}
