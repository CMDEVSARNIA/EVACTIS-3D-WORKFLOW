/**
 * Project versions: local copies of the project file in `<project>/.evx-history`
 * (evx-core::history). Restoring first saves the current state as a version, so a
 * restore can itself be undone by restoring that one.
 */
import { parseEnvironment } from '@evactis-3dworkflow/schema';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Snapshot } from '../api.ts';
import { describeError } from '../format.ts';
import type { Lang, Strings } from '../i18n.ts';
import type { DocumentStore } from './store.ts';

export function Versions({ t, lang, store }: { t: Strings; lang: Lang; store: DocumentStore }) {
  const e = t.editor;
  const [list, setList] = useState<Snapshot[] | null>(null);
  const [label, setLabel] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setList(await api.snapshots());
    } catch (err) {
      setMessage({ text: describeError(t, err), error: true });
    }
  }, [t]);
  useEffect(() => void refresh(), [refresh]);

  const when = (iso: string) =>
    new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    try {
      // The version copies the file on disk, so write pending edits first.
      await store.flush();
      await api.snapshot(label.trim() || e.kinds.manual, false);
      setLabel('');
      setMessage({ text: e.versionSaved, error: false });
      await refresh();
    } catch (err) {
      setMessage({ text: describeError(t, err), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function restore(id: string) {
    setBusy(true);
    setConfirm(null);
    try {
      await store.flush();
      // Validate before anything is replaced.
      const parsed = parseEnvironment(JSON.parse(await api.readSnapshot(id)));
      if (!parsed.success) {
        setMessage({ text: e.versionInvalid + parsed.error.message, error: true });
        return;
      }
      await api.restoreSnapshot(id, e.beforeRestore);
      store.reset(parsed.environment);
      setMessage({ text: e.restored, error: false });
      await refresh();
    } catch (err) {
      setMessage({ text: e.versionInvalid + describeError(t, err), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 px-6 py-8">
      <section className="grid gap-3">
        <p className="evx-eyebrow">{e.tabs.versions}</p>
        <h2 className="evx-heading text-3xl">{e.versionsTitle}</h2>
        <p className="max-w-[70ch] opacity-80">{e.versionsLead}</p>
      </section>
      <form className="evx-panel flex flex-wrap items-end gap-3" onSubmit={(ev) => void save(ev)}>
        <label className="grid flex-1 gap-2 text-sm">
          <span className="font-semibold">{e.versionLabel}</span>
          <input
            className="evx-field"
            value={label}
            maxLength={120}
            placeholder={e.versionLabelPlaceholder}
            onChange={(ev) => setLabel(ev.target.value)}
          />
        </label>
        <button type="submit" className="evx-cta" disabled={busy}>
          {e.saveVersion}
        </button>
      </form>
      {message && (
        <p
          role={message.error ? 'alert' : 'status'}
          className={message.error ? 'evx-alert' : 'text-sm'}
        >
          {message.text}
        </p>
      )}
      {list && list.length === 0 && <p className="evx-hint">{e.noVersions}</p>}
      {list && list.length > 0 && (
        <ol className="grid gap-2" data-testid="versions">
          {list.map((s) => (
            <li key={s.id} className="evx-panel evx-version" data-kind={s.kind}>
              <div>
                <p className="font-semibold">{s.kind === 'manual' ? s.label : e.kinds[s.kind]}</p>
                <p className="evx-hint">
                  {when(s.createdAt)}
                  {s.kind === 'manual' ? ` · ${e.kinds.manual}` : ''}
                </p>
              </div>
              {confirm === s.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="max-w-[40ch] text-sm">{e.restoreConfirm}</p>
                  <button
                    type="button"
                    className="evx-cta evx-cta--small"
                    disabled={busy}
                    onClick={() => void restore(s.id)}
                  >
                    {e.restore}
                  </button>
                  <button
                    type="button"
                    className="evx-cta evx-cta--ghost evx-cta--small"
                    onClick={() => setConfirm(null)}
                  >
                    {t.cancel}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="evx-cta evx-cta--ghost evx-cta--small"
                  disabled={busy}
                  onClick={() => setConfirm(s.id)}
                >
                  {e.restore}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
