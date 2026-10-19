/**
 * An open project: the document store (undo/redo, autosave), the project header and
 * the four sections — Tour, Floors, Media and Versions.
 */
import type { Environment } from '@evactis-3dworkflow/schema';
import { useEffect, useState } from 'react';
import { api, type AssetRecord, type ProjectInfo } from './api.ts';
import { FloorsEditor } from './editor/FloorsEditor.tsx';
import { DocumentStore } from './editor/store.ts';
import { TourEditor } from './editor/TourEditor.tsx';
import { useDocument } from './editor/useDocument.ts';
import { Versions } from './editor/Versions.tsx';
import type { Lang, Strings } from './i18n.ts';
import { Library, type SmokeResult } from './Library.tsx';

type Tab = 'tour' | 'floors' | 'media' | 'versions';
const TABS: Tab[] = ['tour', 'floors', 'media', 'versions'];

/** Text fields keep their own undo (Ctrl+Z while typing undoes typing). */
function isTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

export function Workspace({
  t,
  lang,
  project,
  environment,
  onClose,
  initialImport,
  onSmoke,
}: {
  t: Strings;
  lang: Lang;
  project: ProjectInfo;
  environment: Environment;
  onClose: () => void;
  initialImport?: string[];
  onSmoke?: (r: SmokeResult) => void;
}) {
  const e = t.editor;
  const [store] = useState(
    () =>
      new DocumentStore(environment, {
        save: (json) => api.saveProject(json),
        snapshot: () => api.snapshot('Autosave', true),
      }),
  );
  const doc = useDocument(store);
  const [tab, setTab] = useState<Tab>(() =>
    initialImport?.length || environment.scenes.length === 0 ? 'media' : 'tour',
  );
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [closing, setClosing] = useState(false);

  useEffect(() => () => store.dispose(), [store]);
  useEffect(() => {
    void api.listLibrary().then((l) => setAssets(l.assets));
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || isTextField(ev.target)) return;
      const k = ev.key.toLowerCase();
      if (k === 'z' && !ev.shiftKey) store.undo();
      else if (k === 'y' || (k === 'z' && ev.shiftKey)) store.redo();
      else return;
      ev.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  async function close() {
    setClosing(true);
    try {
      await store.flush();
    } finally {
      setClosing(false);
    }
    // An unsaved (invalid or failed) document stays open so nothing is lost silently.
    if (store.getState().status === 'saved') onClose();
  }

  const statusText =
    doc.status === 'invalid' || doc.status === 'error'
      ? e.status[doc.status] + (doc.problem ?? '')
      : e.status[doc.status];

  return (
    <div className="flex flex-1 flex-col">
      <div className="evx-projectbar">
        <div className="min-w-0">
          <h1 className="evx-heading truncate text-2xl" data-testid="project-name">
            {project.name}
          </h1>
          <p
            role="status"
            className={`evx-save evx-save--${doc.status}`}
            data-testid="save-status"
            data-status={doc.status}
          >
            {statusText}
          </p>
        </div>
        <div className="evx-tabs" role="tablist" aria-label={e.tabsLabel}>
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-controls={`panel-${id}`}
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(ev) => {
                const d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
                if (!d) return;
                const next = TABS[(TABS.indexOf(id) + d + TABS.length) % TABS.length]!;
                setTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }}
            >
              {e.tabs[id]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="evx-cta evx-cta--ghost evx-cta--small"
            disabled={!doc.undoLabel}
            title={doc.undoLabel ? e.undoWhat(doc.undoLabel) : e.nothingToUndo}
            aria-keyshortcuts="Control+Z"
            onClick={() => store.undo()}
          >
            {e.undo}
          </button>
          <button
            type="button"
            className="evx-cta evx-cta--ghost evx-cta--small"
            disabled={!doc.redoLabel}
            title={doc.redoLabel ? e.redoWhat(doc.redoLabel) : e.nothingToRedo}
            aria-keyshortcuts="Control+Y"
            onClick={() => store.redo()}
          >
            {e.redo}
          </button>
          <button
            type="button"
            className="evx-cta evx-cta--ghost evx-cta--small"
            disabled={closing}
            onClick={() => void close()}
          >
            {t.closeProject}
          </button>
        </div>
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="flex flex-1 flex-col"
      >
        {tab === 'tour' && (
          <TourEditor
            t={t}
            lang={lang}
            store={store}
            doc={doc}
            project={project}
            assets={assets}
            onOpenMedia={() => setTab('media')}
          />
        )}
        {tab === 'floors' && (
          <FloorsEditor
            t={t}
            lang={lang}
            store={store}
            doc={doc}
            project={project}
            assets={assets}
            onAssetsChanged={() => void api.listLibrary().then((l) => setAssets(l.assets))}
          />
        )}
        {tab === 'media' && (
          <Library
            t={t}
            lang={lang}
            project={project}
            onChange={setAssets}
            initialImport={initialImport}
            onSmoke={onSmoke}
          />
        )}
        {tab === 'versions' && <Versions t={t} lang={lang} store={store} />}
      </div>
    </div>
  );
}
