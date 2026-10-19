/**
 * Print evacuation plans (one PDF per floor, plus a "You are here" sheet per posting)
 * and export the equipment register (CSV, XLSX or PDF). Generated in Studio, written
 * only where the author chose; the print code loads on first use.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { forAudience, localize, type Environment } from '@evactis-3dworkflow/schema';
import { useId, useState } from 'react';
import { api } from '../api.ts';
import { describeError } from '../format.ts';
import type { Lang, Strings } from '../i18n.ts';
import { loadPrintAssets } from './printAssets.ts';

const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** File names keep letters (accents too), digits, spaces and a few separators. */
const fileSafe = (s: string) =>
  s
    .split('')
    .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

function Shell({
  t,
  title,
  trigger,
  open,
  setOpen,
  children,
}: {
  t: Strings;
  title: string;
  trigger: string;
  open: boolean;
  setOpen: (o: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="evx-cta evx-cta--ghost evx-cta--small">{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="evx-chrome fixed top-1/2 left-1/2 grid max-h-[88vh] w-[min(94vw,38rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-auto rounded-xl border border-white/10 p-6 shadow-2xl">
          <Dialog.Title className="evx-heading text-xl">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          {children}
          <Dialog.Close className="evx-cta evx-cta--ghost evx-cta--small justify-self-start">
            {t.close}
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function PrintDialog({ t, lang, env }: { t: Strings; lang: Lang; env: Environment }) {
  const s = t.safety;
  const id = useId();
  const floors = env.buildings.flatMap((b) => b.floors).filter((f) => f.plan);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(floors.map((f) => f.id)));
  const [postings, setPostings] = useState(true);
  const [paper, setPaper] = useState<'letter' | 'tabloid'>('letter');
  const [audience, setAudience] = useState(env.settings.defaultAudienceId ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const name = (x: Record<string, string>) => localize(x, lang);
  const aud = audience || null;
  const unconfirmed =
    env.equipment.filter(
      (e) =>
        picked.has(e.floorId) && e.planPosition && !e.confirmed && forAudience(e.audienceIds, aud),
    ).length +
    env.routes.filter(
      (r) =>
        !r.confirmed &&
        forAudience(r.audienceIds, aud) &&
        r.segments.some((x) => picked.has(x.floorId)),
    ).length;

  async function run() {
    setMessage(null);
    const folder = await api.pickExportFolder(s.printTitle);
    if (!folder) return;
    setBusy(true);
    try {
      const { evacuationPlanPdf } = await import('@evactis-3dworkflow/print');
      const assets = await loadPrintAssets(env, [...picked]);
      const printedOn = today();
      let written = 0;
      for (const f of floors.filter((x) => picked.has(x.id))) {
        const variants = [
          null,
          ...(postings ? env.postings.filter((p) => p.floorId === f.id) : []),
        ];
        for (const posting of variants) {
          const { bytes } = await evacuationPlanPdf(env, assets, {
            floorId: f.id,
            ...(posting && { postingId: posting.id }),
            paper,
            printedOn,
            audience: aud,
          });
          const file = fileSafe(
            s.planFile(name(f.name), posting ? name(posting.name) : null, paper),
          );
          await api.writeExport(api.joinPath(folder, file), bytes);
          written++;
        }
      }
      setMessage({ text: s.written(written), error: false });
    } catch (e) {
      setMessage({ text: s.printFailed + describeError(t, e), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell t={t} title={s.printTitle} trigger={s.print} open={open} setOpen={setOpen}>
      <fieldset className="grid gap-2">
        <legend className="evx-subheading mb-2">{s.printFloors}</legend>
        {floors.map((f) => (
          <label key={f.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={picked.has(f.id)}
              onChange={(e) => {
                const next = new Set(picked);
                if (e.target.checked) next.add(f.id);
                else next.delete(f.id);
                setPicked(next);
              }}
            />
            {name(f.name)}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={postings} onChange={(e) => setPostings(e.target.checked)} />
        {s.printPostings}
      </label>
      <fieldset className="grid gap-2">
        <legend className="evx-subheading mb-2">{s.paper}</legend>
        {(['letter', 'tabloid'] as const).map((p) => (
          <label key={p} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-paper`}
              checked={paper === p}
              onChange={() => setPaper(p)}
            />
            {s.papers[p]}
          </label>
        ))}
      </fieldset>
      <div className="evx-form-row">
        <label htmlFor={`${id}-aud`}>{s.printAudience}</label>
        <select
          id={`${id}-aud`}
          className="evx-field"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
        >
          {env.audiences.map((a) => (
            <option key={a.id} value={a.id}>
              {name(a.name)}
            </option>
          ))}
        </select>
      </div>
      {unconfirmed > 0 && (
        <p role="note" className="evx-alert">
          {s.unconfirmedWarning(unconfirmed)}
        </p>
      )}
      <button
        type="button"
        className="evx-cta evx-cta--small justify-self-start"
        disabled={busy || picked.size === 0}
        onClick={() => void run()}
      >
        {busy ? s.printing : s.choose}
      </button>
      {message && (
        <p
          role={message.error ? 'alert' : 'status'}
          className={message.error ? 'evx-alert' : 'text-sm'}
        >
          {message.text}
        </p>
      )}
    </Shell>
  );
}

export function RegisterDialog({ t, lang, env }: { t: Strings; lang: Lang; env: Environment }) {
  const s = t.safety;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<'csv' | 'xlsx' | 'pdf'>('xlsx');
  const [audience, setAudience] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function run() {
    setMessage(null);
    const path = await api.pickSave(
      s.registerTitle,
      `${s.registerFile}.${format}`,
      s.formats[format],
      format,
    );
    if (!path) return;
    setBusy(true);
    try {
      const print = await import('@evactis-3dworkflow/print');
      const rows = print.registerRows(env, audience ? { audience } : {});
      const bytes =
        format === 'csv'
          ? new TextEncoder().encode(print.registerCsv(rows))
          : format === 'xlsx'
            ? print.registerXlsx(rows)
            : (
                await print.registerPdf(env, rows, (await loadPrintAssets(env, [])).fonts, {
                  printedOn: today(),
                })
              ).bytes;
      setMessage({ text: s.saved(await api.writeExport(path, bytes)), error: false });
    } catch (e) {
      setMessage({ text: describeError(t, e), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell t={t} title={s.registerTitle} trigger={s.register} open={open} setOpen={setOpen}>
      <fieldset className="grid gap-2">
        <legend className="evx-subheading mb-2">{s.format}</legend>
        {(['xlsx', 'csv', 'pdf'] as const).map((f) => (
          <label key={f} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-fmt`}
              checked={format === f}
              onChange={() => setFormat(f)}
            />
            {s.formats[f]}
          </label>
        ))}
      </fieldset>
      <div className="evx-form-row">
        <label htmlFor={`${id}-aud`}>{s.registerAudience}</label>
        <select
          id={`${id}-aud`}
          className="evx-field"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
        >
          <option value="">{s.everyone}</option>
          {env.audiences.map((a) => (
            <option key={a.id} value={a.id}>
              {localize(a.name, lang)}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="evx-cta evx-cta--small justify-self-start"
        disabled={busy}
        onClick={() => void run()}
      >
        {s.exportRegister}
      </button>
      {message && (
        <p
          role={message.error ? 'alert' : 'status'}
          className={message.error ? 'evx-alert' : 'text-sm'}
        >
          {message.text}
        </p>
      )}
    </Shell>
  );
}
