import lockupUrl from '@evactis-3dworkflow/brand/product-lockup.svg?url';
import type { AppInfo } from '@evactis-3dworkflow/desktop-bridge';
import { parseEnvironment } from '@evactis-3dworkflow/schema';
import { useEffect, useState } from 'react';
import { AboutDialog } from './AboutDialog.tsx';
import { api, desktop, type ProjectInfo } from './api.ts';
import { describeError, newProjectManifest } from './format.ts';
import { STRINGS, detectLang, type Lang } from './i18n.ts';
import { Library, type SmokeResult } from './Library.tsx';
import { NewProjectDialog } from './NewProjectDialog.tsx';

type Theme = 'dark' | 'light';

export function App({
  info,
  onSmoke,
}: {
  info: AppInfo | null;
  /** Called when a --smoke-import run has finished (or failed). */
  onSmoke?: (r: SmokeResult) => void;
}) {
  const [lang, setLang] = useState<Lang>(() => detectLang());
  const [theme, setTheme] = useState<Theme>('dark');
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = STRINGS[lang];
  const smokeImport = info?.smokeTest ? info.smokeImport : null;

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  function accept(p: ProjectInfo) {
    let raw: unknown;
    try {
      raw = JSON.parse(p.manifest);
    } catch (e) {
      setError(t.invalidManifest + String(e));
      return;
    }
    const parsed = parseEnvironment(raw);
    if (!parsed.success) {
      setError(t.invalidManifest + parsed.error.message);
      void api.closeProject();
      return;
    }
    setError(null);
    setProject(p);
  }

  async function open(path?: string | null) {
    const target = path ?? (await api.pickProject(t.openProjectTitle, t.projectFilter));
    if (!target) return;
    try {
      accept(await api.openProject(target));
    } catch (e) {
      setError(describeError(t, e));
    }
  }

  // Double-clicked .evxproj (or a project folder passed on the command line).
  useEffect(() => {
    if (info?.openPath && !info.smokeTest) void open(info.openPath);
  }, [info]);

  // Smoke-test import: a scratch project, then the same import path a user takes.
  useEffect(() => {
    if (!smokeImport) return;
    void (async () => {
      try {
        const dir = await api.smokeWorkspace();
        accept(await api.createProject(dir, 'Smoke test', newProjectManifest('Smoke test')));
      } catch (e) {
        onSmoke?.({ checks: [], error: describeError(t, e) });
      }
    })();
  }, [smokeImport]);

  async function close() {
    await api.closeProject();
    setProject(null);
  }

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

      {project ? (
        <Library
          t={t}
          lang={lang}
          project={project}
          onClose={() => void close()}
          initialImport={smokeImport ? [smokeImport] : undefined}
          onSmoke={onSmoke}
        />
      ) : (
        <main className="mx-auto grid w-full max-w-6xl flex-1 content-center gap-12 px-6 py-16 md:grid-cols-[3fr_2fr]">
          <section>
            <p className="evx-eyebrow">{t.eyebrow}</p>
            <h1 className="evx-heading mt-5 mb-6 text-5xl">{t.heading}</h1>
            <p className="max-w-[46ch] text-lg">{t.lead}</p>
            <div className="mt-8 flex flex-wrap gap-4">
              <NewProjectDialog t={t} disabled={!desktop()} onCreated={accept} />
              <button
                type="button"
                className="evx-cta evx-cta--ghost"
                disabled={!desktop()}
                onClick={() => void open()}
              >
                {t.openProject}
              </button>
              <AboutDialog t={t} info={info} />
            </div>
            {!desktop() && <p className="mt-3 text-sm opacity-70">{t.browserOnly}</p>}
            {error && (
              <p role="alert" className="evx-alert mt-4">
                {error}
              </p>
            )}
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
      )}
    </div>
  );
}
