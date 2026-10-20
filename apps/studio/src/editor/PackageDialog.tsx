/**
 * The Package dialog: pick a package type, name, options (kiosk, passphrase, SCORM
 * version) and a folder, then make it (packageDelivery.ts). Kinds this Studio cannot
 * make (no bundled Viewer or NSIS) are shown with the reason; a single HTML file that
 * would be too large needs an explicit "make it anyway".
 */
import { safeName, type ScormVersion } from '@evactis-3dworkflow/packaging';
import type { PackageKind } from '@evactis-3dworkflow/package-format';
import { localize, type Environment } from '@evactis-3dworkflow/schema';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useId, useState } from 'react';
import { api, isCommandError, type PackageTools } from '../api.ts';
import { describeError, formatBytes } from '../format.ts';
import type { Lang, Strings } from '../i18n.ts';
import {
  estimateSingleFile,
  KINDS,
  makePackage,
  missingTool,
  SINGLE_FILE_WARN_BYTES,
  unconfirmedSafety,
} from './packageDelivery.ts';

const MIN_PASSPHRASE = 8;

export function PackageDialog({ t, lang, env }: { t: Strings; lang: Lang; env: Environment }) {
  const p = t.packaging;
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [tools, setTools] = useState<PackageTools | null>(null);
  const [kind, setKind] = useState<PackageKind>('evx');
  const [name, setName] = useState('');
  const [kiosk, setKiosk] = useState(false);
  const [scormVersion, setScormVersion] = useState<ScormVersion>('2004');
  const [encrypt, setEncrypt] = useState(false);
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [dir, setDir] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [anyway, setAnyway] = useState(false);
  const [progress, setProgress] = useState<{ text: string; ratio: number } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const facility = localize(env.facility.name, lang) || localize(env.title, lang);
  useEffect(() => {
    if (!open) return;
    setName((n) => n || safeName(facility));
    void api.packageTools().then(setTools);
  }, [open, facility]);

  useEffect(() => {
    setEstimate(null);
    setAnyway(false);
    if (!open || kind !== 'single-file') return;
    let live = true;
    void estimateSingleFile(env, api.mediaSizes).then(
      (n) => live && setEstimate(n),
      () => live && setEstimate(-1),
    );
    return () => void (live = false);
  }, [open, kind, env]);

  const missing = tools ? missingTool(kind, tools) : null;
  const passProblem = !encrypt
    ? null
    : pass.normalize('NFC').length < MIN_PASSPHRASE
      ? p.tooShort
      : pass !== again
        ? p.noMatch
        : null;
  const tooLarge = kind === 'single-file' && (estimate ?? 0) > SINGLE_FILE_WARN_BYTES;
  const cleanName = safeName(name);
  const busy = progress !== null;
  const ready =
    !!tools && !missing && !!dir && !!name.trim() && !passProblem && (!tooLarge || anyway) && !busy;
  const unconfirmed = unconfirmedSafety(env);

  async function chooseFolder() {
    const d = await api.pickExportFolder(p.folderTitle);
    if (d) setDir(d);
  }

  async function make() {
    if (!ready || !dir || !tools) return;
    setProblem(null);
    setDone(null);
    setProgress({ text: p.steps.files(0, 0), ratio: 0 });
    try {
      const path = await makePackage(api, {
        env,
        kind,
        name: cleanName,
        dir,
        passphrase: encrypt ? pass : undefined,
        kiosk,
        scormVersion,
        tools,
        onProgress: (step, d, n) =>
          setProgress({ text: p.steps[step](d, n), ratio: n ? d / n : 0 }),
      });
      setDone(path);
    } catch (e) {
      setProblem(
        isCommandError(e) && e.code === 'exists'
          ? p.exists(e.message)
          : isCommandError(e)
            ? p.failed + describeError(t, e)
            : p.failed + (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setProgress(null);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        setOpen(o);
        setProblem(null);
        setDone(null);
      }}
    >
      <Dialog.Trigger className="evx-cta evx-cta--small" data-testid="package-open">
        {p.open}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          className="evx-chrome fixed top-1/2 left-1/2 max-h-[92vh] w-[min(94vw,44rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-white/10 p-8 shadow-2xl"
          aria-describedby={`${ids}-lead`}
        >
          <Dialog.Title className="evx-heading text-xl">{p.title}</Dialog.Title>
          <p id={`${ids}-lead`} className="mt-2 text-sm opacity-80">
            {p.lead}
          </p>
          <form
            className="mt-6 grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void make();
            }}
          >
            <fieldset className="grid gap-2" disabled={busy}>
              <legend className="mb-2 text-sm font-semibold">{p.kindLabel}</legend>
              {KINDS.map((k) => {
                const lacking = tools ? missingTool(k, tools) : null;
                return (
                  <label
                    key={k}
                    className="evx-package-kind"
                    data-selected={kind === k || undefined}
                    data-unavailable={lacking ? true : undefined}
                  >
                    <input
                      type="radio"
                      name={`${ids}-kind`}
                      value={k}
                      checked={kind === k}
                      onChange={() => setKind(k)}
                      aria-describedby={`${ids}-${k}-hint`}
                    />
                    <span className="grid gap-0.5">
                      <span className="font-semibold">{p.kinds[k].name}</span>
                      <span id={`${ids}-${k}-hint`} className="text-sm opacity-80">
                        {lacking ? p.missing[lacking] : p.kinds[k].hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <label className="grid gap-2 text-sm">
              <span className="font-semibold">{p.name}</span>
              <input
                className="evx-field"
                value={name}
                maxLength={80}
                required
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                aria-describedby={`${ids}-name-hint`}
              />
              <span id={`${ids}-name-hint`} className="evx-hint">
                {p.nameHint}
              </span>
            </label>

            {kind === 'scorm' && (
              <label className="grid gap-2 text-sm">
                <span className="font-semibold">{p.scormVersion}</span>
                <select
                  className="evx-field"
                  value={scormVersion}
                  disabled={busy}
                  onChange={(e) => setScormVersion(e.target.value as ScormVersion)}
                >
                  <option value="2004">SCORM 2004 (4th edition)</option>
                  <option value="1.2">SCORM 1.2</option>
                </select>
              </label>
            )}
            {kind !== 'scorm' && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={kiosk}
                  disabled={busy}
                  onChange={(e) => setKiosk(e.target.checked)}
                />
                {p.kiosk}
              </label>
            )}

            <div className="grid gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={encrypt}
                  disabled={busy}
                  onChange={(e) => setEncrypt(e.target.checked)}
                />
                <span className="font-semibold">{p.encrypt}</span>
              </label>
              {encrypt && (
                <>
                  <p className="evx-hint">{p.encryptHint}</p>
                  <label className="grid gap-1">
                    <span>{p.passphrase}</span>
                    <input
                      className="evx-field"
                      type="password"
                      autoComplete="new-password"
                      value={pass}
                      disabled={busy}
                      onChange={(e) => setPass(e.target.value)}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span>{p.passphraseAgain}</span>
                    <input
                      className="evx-field"
                      type="password"
                      autoComplete="new-password"
                      value={again}
                      disabled={busy}
                      onChange={(e) => setAgain(e.target.value)}
                    />
                  </label>
                  {passProblem && (pass || again) && (
                    <p className="evx-hint" role="status" data-testid="passphrase-problem">
                      {passProblem}
                    </p>
                  )}
                </>
              )}
            </div>

            {kind === 'single-file' && (
              <div className="grid gap-2 text-sm" data-testid="single-file-size">
                {estimate === null ? (
                  <p className="evx-hint">{p.estimating}</p>
                ) : estimate < 0 ? null : tooLarge ? (
                  <>
                    <p role="alert" className="evx-alert">
                      {p.tooLarge(formatBytes(estimate, lang))}
                    </p>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={anyway}
                        disabled={busy}
                        onChange={(e) => setAnyway(e.target.checked)}
                      />
                      {p.anyway}
                    </label>
                  </>
                ) : (
                  <p className="evx-hint">{p.estimate(formatBytes(estimate, lang))}</p>
                )}
              </div>
            )}

            <div className="grid gap-2 text-sm">
              <span className="font-semibold">{p.folder}</span>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="evx-cta evx-cta--ghost evx-cta--small"
                  disabled={busy}
                  onClick={() => void chooseFolder()}
                >
                  {p.chooseFolder}
                </button>
                <span className="break-all opacity-80" data-testid="package-folder">
                  {dir ?? p.noFolder}
                </span>
              </div>
            </div>

            {unconfirmed > 0 && (
              <p className="evx-hint" data-testid="package-unconfirmed">
                {p.unconfirmed(unconfirmed)}
              </p>
            )}

            {progress && (
              <div className="grid gap-2">
                <p role="status" className="evx-hint">
                  {progress.text}
                </p>
                <div
                  className="evx-progress"
                  role="progressbar"
                  aria-label={p.title}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress.ratio * 100)}
                >
                  <span style={{ inlineSize: `${progress.ratio * 100}%` }} />
                </div>
              </div>
            )}
            {done && (
              <div role="status" className="grid gap-1 text-sm" data-testid="package-done">
                <p className="break-all">{p.done(done)}</p>
                {kind === 'installer' && <p className="evx-hint">{p.unsigned}</p>}
              </div>
            )}
            {problem && (
              <p role="alert" className="evx-alert break-words">
                {problem}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-3">
              <Dialog.Close className="evx-cta evx-cta--ghost" disabled={busy}>
                {p.close}
              </Dialog.Close>
              <button type="submit" className="evx-cta" disabled={!ready}>
                {p.make}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
