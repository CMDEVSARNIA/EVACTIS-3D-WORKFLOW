import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  desktop,
  type AssetRecord,
  type ImportEvent,
  type MediaTools,
  type ProjectInfo,
  type Stage,
} from './api.ts';
import { describeError, describeWarning, formatBytes, formatNumber } from './format.ts';
import type { Lang, Strings } from './i18n.ts';

interface QueueItem {
  path: string;
  name: string;
  status: 'queued' | 'active' | 'done' | 'failed';
  stage?: Stage;
  done: number;
  total: number;
  message?: string;
}

export interface SmokeResult {
  checks: string[];
  error?: string;
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function Library({
  t,
  lang,
  project,
  onClose,
  initialImport,
  onSmoke,
}: {
  t: Strings;
  lang: Lang;
  project: ProjectInfo;
  onClose: () => void;
  /** Smoke-test runs: files to import as soon as the library opens. */
  initialImport?: string[];
  onSmoke?: (r: SmokeResult) => void;
}) {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [job, setJob] = useState<number | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [tools, setTools] = useState<MediaTools | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const smoke = useRef<{ started: number; imported?: AssetRecord; failure?: string } | null>(null);

  const refresh = useCallback(async () => {
    const l = await api.listLibrary();
    setAssets(l.assets);
    setProblems(l.problems);
  }, []);

  useEffect(() => {
    void refresh();
    void api.mediaTools().then(setTools);
  }, [refresh]);

  const onEvent = useCallback(
    (e: ImportEvent) => {
      const patch = (index: number, p: Partial<QueueItem>) =>
        setQueue((q) => q.map((item, i) => (i === index ? { ...item, ...p } : item)));
      switch (e.event) {
        case 'started':
          patch(e.index, { status: 'active', done: 0, total: 0 });
          break;
        case 'progress':
          patch(e.index, { stage: e.stage, done: e.done, total: e.total });
          break;
        case 'imported':
          patch(e.index, { status: 'done' });
          setAssets((a) => [...a, e.asset]);
          setSelected(e.asset.id);
          if (smoke.current) smoke.current.imported = e.asset;
          break;
        case 'failed': {
          const message = describeError(t, { code: e.code, message: e.message });
          patch(e.index, { status: 'failed', message });
          if (smoke.current) smoke.current.failure = `${e.code}: ${e.message}`;
          break;
        }
        case 'finished':
          setJob(null);
          setSummary(e.cancelled ? t.importCancelled : t.importSummary(e.imported, e.failed));
          void refresh();
          if (smoke.current && !smoke.current.imported)
            onSmoke?.({ checks: [], error: smoke.current.failure ?? 'nothing was imported' });
          break;
      }
    },
    [t, refresh, onSmoke],
  );

  const startImport = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0 || job !== null) return;
      setSummary(null);
      setQueue(
        paths.map((path) => ({ path, name: baseName(path), status: 'queued', done: 0, total: 0 })),
      );
      try {
        setJob(await api.importMedia(paths, onEvent));
      } catch (err) {
        setSummary(describeError(t, err));
      }
    },
    [job, onEvent, t],
  );

  // Files dropped on the window arrive through Tauri with their real paths.
  useEffect(() => {
    if (!desktop()) return;
    let unlisten: (() => void) | undefined;
    let gone = false;
    void api
      .onFileDrop((e) => {
        setDragOver(e.type === 'over');
        if (e.type === 'drop') void startImport(e.paths);
      })
      .then((u) => (gone ? u() : (unlisten = u)));
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [startImport]);

  const autoStarted = useRef(false);
  useEffect(() => {
    if (initialImport?.length && !autoStarted.current) {
      autoStarted.current = true;
      smoke.current = { started: performance.now() };
      void startImport(initialImport);
    }
  }, [initialImport, startImport]);

  // Smoke runs finish once the imported item's thumbnail has rendered in the library.
  const thumbLoaded = (a: AssetRecord) => {
    const s = smoke.current;
    if (!s?.imported || s.imported.id !== a.id) return;
    smoke.current = null;
    const seconds = ((performance.now() - s.started) / 1000).toFixed(1);
    const levels = a.tiles?.levels.map((l) => l.size).join('/') ?? 'none';
    onSmoke?.({
      checks: [
        `imported ${a.originalFileName} (${a.width}x${a.height}) as ${a.id} in ${seconds} s`,
        `tile levels ${levels}, tile size ${a.tiles?.tileSize ?? 0}`,
        `thumbnail rendered in the library from ${a.thumbnail}`,
      ],
    });
  };

  const thumbFailed = (a: AssetRecord) => {
    if (smoke.current?.imported?.id !== a.id) return;
    smoke.current = null;
    onSmoke?.({ checks: [], error: `thumbnail did not load: ${thumb(a) ?? 'none'}` });
  };

  async function pick() {
    void startImport(await api.pickMedia(t.importTitle, t.mediaFilter));
  }

  async function remove(id: string) {
    try {
      await api.removeAsset(id);
      setSelected(null);
      setConfirmRemove(false);
      await refresh();
    } catch (err) {
      setSummary(describeError(t, err));
    }
  }

  const current = assets.find((a) => a.id === selected) ?? null;
  const thumb = (a: AssetRecord) => (a.thumbnail ? api.fileUrl(project.root, a.thumbnail) : null);

  return (
    <div className="mx-auto grid w-full max-w-7xl flex-1 content-start gap-8 px-6 py-10">
      <section className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="evx-eyebrow">{t.libraryEyebrow}</p>
          <h1 className="evx-heading mt-4 text-4xl" data-testid="project-name">
            {project.name}
          </h1>
          <p className="mt-3 max-w-[60ch] opacity-80">{t.libraryLead}</p>
          <p className="mt-1 text-sm break-all opacity-60">{project.root}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="evx-cta" onClick={pick} disabled={job !== null}>
            {t.importMedia}
          </button>
          <button type="button" className="evx-cta evx-cta--ghost" onClick={onClose}>
            {t.closeProject}
          </button>
        </div>
      </section>

      <div
        className={`evx-dropzone${dragOver ? ' evx-dropzone--active' : ''}`}
        aria-hidden={!dragOver}
      >
        <p className="font-semibold">{t.dropHere}</p>
        <p className="mt-1 text-sm opacity-75">{t.dropHint}</p>
      </div>

      {tools && !tools.ffmpegVersion && (
        <p role="note" className="evx-alert">
          {t.noFfmpeg}
        </p>
      )}

      {queue.length > 0 && (
        <section aria-label={t.importing} className="evx-panel grid gap-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="evx-heading text-lg">{t.importing}</h2>
            {job !== null && (
              <button
                type="button"
                className="evx-cta evx-cta--ghost"
                onClick={() => void api.cancelImport(job)}
              >
                {t.cancelImport}
              </button>
            )}
          </div>
          <ul className="grid gap-3">
            {queue.map((q, i) => (
              <li key={i} className="grid gap-1 text-sm" data-status={q.status}>
                <div className="flex justify-between gap-4">
                  <span className="truncate font-semibold">{q.name}</span>
                  <span className="shrink-0 opacity-80">
                    {q.status === 'queued' && t.queued}
                    {q.status === 'active' && (q.stage ? t.stages[q.stage] : t.stages.validating)}
                    {q.status === 'done' && t.imported}
                    {q.status === 'failed' && t.failed}
                  </span>
                </div>
                {q.status === 'active' && (
                  <div
                    className="evx-progress"
                    role="progressbar"
                    aria-label={q.name}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={q.total ? Math.round((q.done / q.total) * 100) : 0}
                  >
                    <span style={{ inlineSize: `${q.total ? (q.done / q.total) * 100 : 0}%` }} />
                  </div>
                )}
                {q.message && (
                  <p role="alert" className="evx-alert">
                    {q.message}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {summary && (
            <p role="status" className="text-sm">
              {summary}
            </p>
          )}
        </section>
      )}
      {queue.length === 0 && summary && (
        <p role="alert" className="evx-alert">
          {summary}
        </p>
      )}

      {problems.map((p) => (
        <p key={p} role="note" className="evx-alert">
          {p}
        </p>
      ))}

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        {assets.length === 0 ? (
          <p className="evx-panel opacity-80">{t.emptyLibrary}</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] content-start gap-4">
            {assets.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="evx-asset"
                  aria-pressed={a.id === selected}
                  data-asset-id={a.id}
                  onClick={() => {
                    setSelected(a.id);
                    setConfirmRemove(false);
                  }}
                >
                  {thumb(a) ? (
                    <img
                      src={thumb(a)!}
                      alt=""
                      loading="lazy"
                      onLoad={() => thumbLoaded(a)}
                      onError={() => thumbFailed(a)}
                    />
                  ) : (
                    <span className="evx-asset__placeholder">{t.kinds[a.kind]}</span>
                  )}
                  <span className="evx-asset__name">{a.name}</span>
                  <span className="evx-asset__meta">
                    {t.kinds[a.kind]}
                    {a.width ? ` · ${a.width} × ${a.height}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {current && (
          <aside className="evx-panel self-start" aria-label={t.details}>
            <h2 className="evx-heading text-lg break-words">{current.name}</h2>
            {current.preview && (
              <img
                className="mt-4 w-full rounded-md"
                src={api.fileUrl(project.root, current.preview)}
                alt=""
              />
            )}
            <dl className="evx-details mt-4">
              <dt>{t.originalFile}</dt>
              <dd className="break-all">{current.originalFileName}</dd>
              {current.width && (
                <>
                  <dt>{t.resolution}</dt>
                  <dd>
                    {formatNumber(current.width, lang)} × {formatNumber(current.height ?? 0, lang)}
                    {current.hdr ? ' · HDR' : ''}
                  </dd>
                </>
              )}
              {current.capture.captureDate && (
                <>
                  <dt>{t.captured}</dt>
                  <dd>
                    {current.capture.captureDate} {current.capture.captureTime ?? ''}
                  </dd>
                </>
              )}
              {current.capture.camera && (
                <>
                  <dt>{t.camera}</dt>
                  <dd>{current.capture.camera}</dd>
                </>
              )}
              {current.capture.gps && (
                <>
                  <dt>{t.position}</dt>
                  <dd>
                    {current.capture.gps.lat.toFixed(5)}, {current.capture.gps.lon.toFixed(5)}
                  </dd>
                </>
              )}
              {current.tiles && (
                <>
                  <dt>{t.tileLevels}</dt>
                  <dd>{current.tiles.levels.map((l) => l.size).join(' · ')}</dd>
                </>
              )}
              {current.durationSec !== undefined && (
                <>
                  <dt>{t.duration}</dt>
                  <dd>
                    {current.durationSec.toFixed(1)} {t.seconds}
                  </dd>
                </>
              )}
              {current.points !== undefined && (
                <>
                  <dt>{t.points}</dt>
                  <dd>{formatNumber(current.points, lang)}</dd>
                </>
              )}
              <dt>{t.fileSize}</dt>
              <dd>{formatBytes(current.bytes, lang)}</dd>
              <dt>{t.importedOn}</dt>
              <dd>{current.importedAt.replace('T', ' ').replace('Z', ' UTC')}</dd>
            </dl>
            {current.warnings.length > 0 && (
              <>
                <h3 className="mt-4 text-sm font-semibold">{t.warnings}</h3>
                <ul className="evx-bullets mt-2 text-sm">
                  {current.warnings.map((w) => (
                    <li key={w}>{describeWarning(t, w, lang)}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              {confirmRemove ? (
                <>
                  <p className="text-sm">{t.removeConfirm}</p>
                  <button type="button" className="evx-cta" onClick={() => void remove(current.id)}>
                    {t.remove}
                  </button>
                  <button
                    type="button"
                    className="evx-cta evx-cta--ghost"
                    onClick={() => setConfirmRemove(false)}
                  >
                    {t.cancel}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="evx-cta evx-cta--ghost"
                  onClick={() => setConfirmRemove(true)}
                >
                  {t.remove}
                </button>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
