import lockupUrl from '@evactis-3dworkflow/brand/product-lockup.svg?url';
import type { AppInfo } from '@evactis-3dworkflow/desktop-bridge';
import { useEffect, useState } from 'react';
import { AboutDialog } from './AboutDialog.tsx';
import { STRINGS, detectLang, type Lang } from './i18n.ts';

type Theme = 'dark' | 'light';

export function App({ info }: { info: AppInfo | null }) {
  const [lang, setLang] = useState<Lang>(() => detectLang());
  const [theme, setTheme] = useState<Theme>('dark');
  const t = STRINGS[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <div className="evx-chrome flex min-h-full flex-col" data-theme={theme}>
      <header className="evx-topbar">
        <img src={lockupUrl} alt="EVACTIS 3DWORKFLOW" className="h-11" />
        <div className="flex gap-3">
          <button
            type="button"
            className="evx-cta evx-cta--ghost text-navy"
            onClick={() => setLang(lang === 'en' ? 'fr' : 'en')}
          >
            {t.language}
          </button>
          <button
            type="button"
            className="evx-cta evx-cta--ghost text-navy"
            aria-pressed={theme === 'light'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {t.theme}
          </button>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 content-center gap-12 px-6 py-16 md:grid-cols-[3fr_2fr]">
        <section>
          <p className="evx-eyebrow">{t.eyebrow}</p>
          <h1 className="evx-heading mt-5 mb-6 text-5xl">{t.heading}</h1>
          <p className="max-w-[46ch] text-lg">{t.lead}</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <button type="button" className="evx-cta" disabled title={t.comingSoon}>
              {t.newProject}
            </button>
            <button type="button" className="evx-cta evx-cta--ghost" disabled title={t.comingSoon}>
              {t.openProject}
            </button>
            <AboutDialog t={t} info={info} />
          </div>
          <p className="mt-3 text-sm opacity-70">{t.comingSoon}</p>
        </section>
        <section aria-labelledby="offline-title">
          <h2 id="offline-title" className="evx-heading text-xl">
            {t.offlineTitle}
          </h2>
          <ul className="evx-bullets mt-4">
            {t.offline.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
