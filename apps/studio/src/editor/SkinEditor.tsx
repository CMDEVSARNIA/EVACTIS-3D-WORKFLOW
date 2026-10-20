/**
 * Skin tab (Phase 7): the Viewer's interface designed per screen (phone, tablet,
 * desktop, kiosk) on the real Viewer at device size. Elements are selected and dragged
 * in the preview or set in the inspector (anchor, offsets, size, visibility; toolbar
 * buttons and direction); theme colours are checked for legibility as they change;
 * the client's logo can sit next to the Evactis lockup.
 */
import {
  ANCHORS,
  SKIN_COMMANDS,
  breakpointFor,
  placementFor,
  type Anchor,
  type Breakpoint,
  type Environment,
  type LocalizedText,
  type Placement,
  type SkinCommand,
} from '@evactis-3dworkflow/schema';
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { api, type AssetRecord, type ImportEvent, type ProjectInfo } from '../api.ts';
import { describeError } from '../format.ts';
import type { Lang, Strings } from '../i18n.ts';
import * as sk from './skinOps.ts';
import { DEVICES, SkinPreview, type Device } from './SkinPreview.tsx';
import type { DocumentState, DocumentStore } from './store.ts';
import { refusal } from './useDocument.ts';

type Pick =
  | { kind: 'element'; id: string }
  | { kind: 'theme' }
  | { kind: 'branding' }
  | { kind: 'widths' };

const PARENT: Record<Breakpoint, Breakpoint | null> = {
  phone: 'tablet',
  tablet: 'desktop',
  kiosk: 'desktop',
  desktop: null,
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="evx-form-row">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="evx-hint">{hint}</p>}
    </div>
  );
}

/** A number typed freely and applied on Enter or leaving the field. */
function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n)) return setText(String(value));
    if (n !== value) onCommit(n);
  };
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type="number"
          className="evx-field"
          min={min}
          max={max}
          step={step}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      )}
    </Field>
  );
}

export function SkinEditor({
  t,
  lang,
  store,
  doc,
  project,
  onAssetsChanged,
}: {
  t: Strings;
  lang: Lang;
  store: DocumentStore;
  doc: DocumentState;
  project: ProjectInfo;
  onAssetsChanged: () => void;
}) {
  const k = t.skin;
  const env = doc.env;
  const skin = useMemo(() => sk.effectiveSkin(env), [env]);
  const [device, setDevice] = useState<Device>('desktop');
  const [trying, setTrying] = useState(false);
  const [pick, setPick] = useState<Pick>({ kind: 'element', id: 'toolbar' });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolveAsset = useCallback((p: string) => api.fileUrl(project.root, p), [project.root]);

  const d = DEVICES[device];
  const bp = breakpointFor(skin, d.width, d.kiosk);
  const parent = PARENT[bp];
  const bpName = (b: Breakpoint) => k.bpNames[b];
  const element = pick.kind === 'element' ? skin.elements.find((e) => e.id === pick.id) : undefined;
  const nameOf = (id: string) => {
    const e = skin.elements.find((x) => x.id === id);
    return e ? k.elements[e.type] : id;
  };

  function edit<T>(label: string, fn: (draft: Environment) => T, key?: string): T | undefined {
    try {
      setProblem(null);
      return store.edit(label, fn, key);
    } catch (err) {
      setProblem(
        err instanceof sk.ContrastError
          ? k.refused(k.contrastWhat[err.what], err.ratio, err.min)
          : refusal(err),
      );
      return undefined;
    }
  }

  const place = (id: string, patch: Placement, key?: string) =>
    edit(k.labels.layout, (x) => sk.setPlacement(x, id, bp, patch), key);

  function move(id: string, dx: number, dy: number, nudge: boolean) {
    const e = skin.elements.find((x) => x.id === id);
    if (!e) return;
    const p = placementFor(e, bp);
    const [v, h] = p.anchor.includes('-') ? p.anchor.split('-') : [p.anchor, p.anchor];
    const patch: Placement = {};
    if (h === 'left') patch.x = p.x + dx;
    if (h === 'right') patch.x = p.x - dx;
    if (v === 'top') patch.y = p.y + dy;
    if (v === 'bottom') patch.y = p.y - dy;
    if (patch.x === undefined && patch.y === undefined) return;
    edit(
      k.labels.move,
      (x) => sk.setPlacement(x, id, bp, patch),
      nudge ? `nudge-${id}` : undefined,
    );
  }

  async function chooseLogo() {
    const paths = await api.pickMedia(k.logoTitle, k.logoFilter, 'photo');
    if (!paths.length) return;
    setBusy(true);
    setProblem(null);
    const imported: AssetRecord[] = [];
    const onEvent = (ev: ImportEvent) => {
      if (ev.event === 'imported') imported.push(ev.asset);
      if (ev.event === 'failed')
        setProblem(describeError(t, { code: ev.code, message: ev.message }));
      if (ev.event === 'finished') {
        setBusy(false);
        onAssetsChanged();
        const logo = imported[0];
        if (logo)
          edit(k.labels.branding, (x) =>
            sk.setBranding(x, { clientLogo: sk.logoPath(logo), coBrand: true }),
          );
      }
    };
    try {
      await api.importMedia(paths.slice(0, 1), onEvent, 'photo');
    } catch (err) {
      setBusy(false);
      setProblem(describeError(t, err));
    }
  }

  // ---------------------------------------------------------------- list column
  const listButton = (key: string, current: boolean, onClick: () => void, children: ReactNode) => (
    <li key={key}>
      <button
        type="button"
        className="evx-skin-list__item"
        aria-current={current}
        onClick={onClick}
      >
        {children}
      </button>
    </li>
  );
  const list = (
    <nav className="evx-editor__scenes evx-panel" aria-label={k.listLabel}>
      <ul className="evx-skin-list">
        {skin.elements.map((e) => {
          const hidden = placementFor(e, bp).hidden;
          return listButton(
            e.id,
            pick.kind === 'element' && pick.id === e.id,
            () => setPick({ kind: 'element', id: e.id }),
            <>
              <span>{k.elements[e.type]}</span>
              {hidden && <span className="evx-hint">{k.hiddenHere}</span>}
            </>,
          );
        })}
      </ul>
      <hr className="evx-skin-list__rule" />
      <ul className="evx-skin-list">
        {listButton('theme', pick.kind === 'theme', () => setPick({ kind: 'theme' }), k.theme)}
        {listButton(
          'branding',
          pick.kind === 'branding',
          () => setPick({ kind: 'branding' }),
          k.branding,
        )}
        {listButton('widths', pick.kind === 'widths', () => setPick({ kind: 'widths' }), k.widths)}
      </ul>
    </nav>
  );

  // ---------------------------------------------------------------- inspector
  let inspector: ReactNode = null;
  if (element) {
    const p = placementFor(element, bp);
    const own = element.layout[bp];
    const buttons = p.buttons ?? [...SKIN_COMMANDS];
    const setButtons = (b: SkinCommand[]) =>
      edit(k.labels.buttons, (x) => sk.setToolbarButtons(x, element.id, bp, b));
    inspector = (
      <div className="grid gap-3">
        <h2 className="evx-subheading">{k.elements[element.type]}</h2>
        <p className="evx-hint" data-testid="skin-layout-note">
          <strong>{k.layoutOn(bpName(bp))}.</strong>{' '}
          {!parent ? k.desktopBase : own ? k.overridden : k.inherits(bpName(parent))}
        </p>
        {parent && own && (
          <button
            type="button"
            className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
            onClick={() => edit(k.labels.inherit, (x) => sk.inherit(x, element.id, bp))}
          >
            {k.useInherited(bpName(parent))}
          </button>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!p.hidden}
            onChange={(e) => place(element.id, { hidden: !e.target.checked })}
          />
          {k.visible}
        </label>
        <fieldset className="grid gap-1">
          <legend className="evx-form-row mb-1 font-semibold">{k.position}</legend>
          <div className="evx-anchor-grid" role="radiogroup" aria-label={k.position}>
            {ANCHORS.map((a: Anchor) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={p.anchor === a}
                aria-label={k.anchors[a]}
                title={k.anchors[a]}
                onClick={() => place(element.id, { anchor: a })}
              />
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={k.offsetX}
            value={p.x}
            min={0}
            max={400}
            onCommit={(v) => place(element.id, { x: v })}
          />
          <NumberField
            label={k.offsetY}
            value={p.y}
            min={0}
            max={400}
            onCommit={(v) => place(element.id, { y: v })}
          />
        </div>
        <NumberField
          label={k.size}
          value={Math.round(p.scale * 100)}
          min={50}
          max={250}
          step={5}
          onCommit={(v) => place(element.id, { scale: v / 100 })}
        />
        {element.type === 'toolbar' && (
          <>
            <div className="evx-form-row">
              <span id="skin-orientation">{k.orientation}</span>
              <div className="evx-segmented" role="radiogroup" aria-labelledby="skin-orientation">
                {(['horizontal', 'vertical'] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    role="radio"
                    aria-checked={(p.orientation ?? 'horizontal') === o}
                    onClick={() => place(element.id, { orientation: o })}
                  >
                    {k[o]}
                  </button>
                ))}
              </div>
            </div>
            <fieldset className="grid gap-1">
              <legend className="evx-form-row mb-1 font-semibold">{k.buttons}</legend>
              <p className="evx-hint">{k.buttonsHint}</p>
              <ol className="evx-skin-buttons">
                {[...buttons, ...SKIN_COMMANDS.filter((c) => !buttons.includes(c))].map((c) => {
                  const on = buttons.includes(c);
                  const i = buttons.indexOf(c);
                  const fixed = c === 'menu' || c === 'evac-route';
                  const swap = (j: number) => {
                    const next = [...buttons];
                    [next[i], next[j]] = [next[j]!, next[i]!];
                    setButtons(next);
                  };
                  return (
                    <li key={c} data-command={c}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={fixed}
                          onChange={(e) =>
                            setButtons(
                              e.target.checked ? [...buttons, c] : buttons.filter((b) => b !== c),
                            )
                          }
                        />
                        {k.commands[c]}
                      </label>
                      {on && (
                        <span className="evx-skin-buttons__order">
                          <button
                            type="button"
                            className="evx-icon-btn"
                            aria-label={k.moveUp(k.commands[c])}
                            disabled={i === 0}
                            onClick={() => swap(i - 1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="evx-icon-btn"
                            aria-label={k.moveDown(k.commands[c])}
                            disabled={i === buttons.length - 1}
                            onClick={() => swap(i + 1)}
                          >
                            ↓
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </fieldset>
          </>
        )}
        <p className="evx-hint">{k.dragHint}</p>
      </div>
    );
  } else if (pick.kind === 'theme') {
    const report = sk.contrastReport(skin);
    const colours = (Object.keys(sk.THEME_TOKENS) as sk.ThemeToken[]).filter(
      (n) => n !== '--evx-btn-radius',
    );
    inspector = (
      <div className="grid gap-3">
        <h2 className="evx-subheading">{k.theme}</h2>
        <Field label={k.skinName}>
          {(id) => (
            <input
              id={id}
              className="evx-field"
              value={skin.name}
              onChange={(e) =>
                e.target.value.trim() &&
                edit(k.labels.rename, (x) => sk.renameSkin(x, e.target.value), 'skin-name')
              }
            />
          )}
        </Field>
        {colours.map((n) => {
          const changed = skin.tokens[n] !== undefined;
          return (
            <Field key={n} label={k.tokens[n]}>
              {(id) => (
                <div className="flex items-center gap-2">
                  <input
                    id={id}
                    type="color"
                    className="evx-color"
                    data-token={n}
                    value={sk.tokenValue(skin, n).toLowerCase()}
                    onChange={(e) =>
                      edit(k.labels.token, (x) => sk.setToken(x, n, e.target.value), `token-${n}`)
                    }
                  />
                  <code>{sk.tokenValue(skin, n).toUpperCase()}</code>
                  {changed && (
                    <button
                      type="button"
                      className="evx-cta evx-cta--ghost evx-cta--small"
                      onClick={() => edit(k.labels.token, (x) => sk.setToken(x, n, null))}
                    >
                      {k.brandValue}
                    </button>
                  )}
                </div>
              )}
            </Field>
          );
        })}
        <Field label={k.tokens['--evx-btn-radius']}>
          {(id) => (
            <select
              id={id}
              className="evx-field"
              value={sk.tokenValue(skin, '--evx-btn-radius')}
              onChange={(e) =>
                edit(k.labels.token, (x) =>
                  sk.setToken(
                    x,
                    '--evx-btn-radius',
                    e.target.value === '18%' ? null : e.target.value,
                  ),
                )
              }
            >
              {Object.entries(k.radiusOptions).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <p className="evx-hint">{k.safetyNote}</p>
        <h3 className="evx-subheading">{k.contrastTitle}</h3>
        <ul className="evx-skin-contrast" data-testid="skin-contrast">
          {report.map((r) => (
            <li key={r.what} data-ok={r.ratio >= r.min}>
              <span>{k.contrastWhat[r.what]}</span>
              <span>{k.ratio(r.ratio, r.min)}</span>
            </li>
          ))}
        </ul>
        {env.skin ? (
          <button
            type="button"
            className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
            onClick={() => edit(k.labels.reset, (x) => sk.resetSkin(x))}
          >
            {k.reset}
          </button>
        ) : (
          <p className="evx-hint">{k.isDefault}</p>
        )}
      </div>
    );
  } else if (pick.kind === 'branding') {
    const b = env.settings.branding;
    const setName = (v: LocalizedText) =>
      edit(k.labels.branding, (x) => sk.setBranding(x, { clientName: v }), 'client-name');
    inspector = (
      <div className="grid gap-3">
        <h2 className="evx-subheading">{k.branding}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={b.coBrand}
            onChange={(e) =>
              edit(k.labels.branding, (x) => sk.setBranding(x, { coBrand: e.target.checked }))
            }
          />
          {k.coBrand}
        </label>
        {(['en', 'fr'] as const).map((l) => (
          <Field key={l} label={l === 'en' ? k.clientNameEn : k.clientNameFr}>
            {(id) => (
              <input
                id={id}
                lang={l}
                className="evx-field"
                value={b.clientName?.[l] ?? ''}
                onChange={(e) => setName({ ...(b.clientName ?? {}), [l]: e.target.value })}
              />
            )}
          </Field>
        ))}
        <div className="evx-form-row">
          <span>{k.clientLogo}</span>
          {b.clientLogo ? (
            <img
              className="evx-skin-logo"
              src={resolveAsset(b.clientLogo)}
              alt={k.clientLogo}
              data-testid="client-logo"
            />
          ) : (
            <p className="evx-hint">{k.noLogo}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="evx-cta evx-cta--small"
              disabled={busy}
              onClick={() => void chooseLogo()}
            >
              {busy ? t.content.importing : k.chooseLogo}
            </button>
            {b.clientLogo && (
              <button
                type="button"
                className="evx-cta evx-cta--ghost evx-cta--small"
                onClick={() =>
                  edit(k.labels.branding, (x) => sk.setBranding(x, { clientLogo: null }))
                }
              >
                {k.removeLogo}
              </button>
            )}
          </div>
          <p className="evx-hint">{k.logoHint}</p>
        </div>
      </div>
    );
  } else if (pick.kind === 'widths') {
    inspector = (
      <div className="grid gap-3">
        <h2 className="evx-subheading">{k.widths}</h2>
        <NumberField
          label={k.phoneUpTo}
          value={skin.breakpoints.phone}
          min={320}
          max={1200}
          onCommit={(v) => edit(k.labels.widths, (x) => sk.setBreakpoints(x, { phone: v }))}
        />
        <NumberField
          label={k.tabletUpTo}
          value={skin.breakpoints.tablet}
          min={480}
          max={2000}
          onCommit={(v) => edit(k.labels.widths, (x) => sk.setBreakpoints(x, { tablet: v }))}
        />
        <p className="evx-hint">{k.widthsHint}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="evx-toolbar px-6 pt-4">
        <div className="evx-segmented" role="radiogroup" aria-label={k.devicesLabel}>
          {(Object.keys(DEVICES) as Device[]).map((dv) => (
            <button
              key={dv}
              type="button"
              role="radio"
              aria-checked={device === dv}
              onClick={() => setDevice(dv)}
            >
              {k.devices[dv]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="evx-cta evx-cta--ghost evx-cta--small"
          aria-pressed={trying}
          title={k.tryHint}
          onClick={() => setTrying((v) => !v)}
        >
          {k.tryIt}
        </button>
      </div>
      <div className="evx-editor">
        {list}
        <div className="evx-editor__stage">
          <SkinPreview
            env={env}
            skin={skin}
            device={device}
            lang={lang}
            resolveAsset={resolveAsset}
            selected={element?.id ?? null}
            trying={trying}
            label={k.previewLabel(k.devices[device])}
            failedText={t.editor.previewFailed}
            elementName={nameOf}
            onSelect={(id) => setPick({ kind: 'element', id })}
            onMove={move}
          />
          {trying && <p className="evx-hint">{k.tryHint}</p>}
        </div>
        <aside className="evx-editor__inspector evx-panel" aria-label={k.listLabel}>
          {problem && (
            <p role="alert" className="evx-alert mb-4">
              {problem}
            </p>
          )}
          {inspector}
        </aside>
      </div>
    </div>
  );
}
