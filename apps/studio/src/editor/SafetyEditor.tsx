/**
 * Safety tab: equipment placed in scenes and on plans (selecting in one view selects in
 * the other), evacuation routes drawn on plans with their scenes and directions, plan
 * postings for "You are here" sheets, the audience lock, and printing/export.
 *
 * Nothing here is generated without the author: suggestions (route scenes, directions)
 * are applied by a click, and every item and route needs a named confirmation before it
 * prints or reaches the delivered Viewer's routes.
 */
import {
  equipmentTypeInfo,
  BUILT_IN_TYPES,
  localize,
  type Environment,
  type LocalizedText,
  type PlanPoint,
} from '@evactis-3dworkflow/schema';
import type { Viewer } from '@evactis-3dworkflow/viewer';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { api, type ProjectInfo } from '../api.ts';
import type { Lang, Strings } from '../i18n.ts';
import { Preview } from './Preview.tsx';
import { SafetyExports } from './SafetyExportsBar.tsx';
import { SafetyPlan, type Pick } from './SafetyPlan.tsx';
import * as so from './safetyOps.ts';
import type { DocumentState, DocumentStore } from './store.ts';
import { refusal } from './useDocument.ts';

type Mode = 'equipment' | 'routes' | 'postings' | 'package';
type Tool = 'select' | 'scene' | 'plan';
const EQ = 'equipment:';
const NAME_KEY = 'evx.confirmName';

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveName(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* private mode: the name is just not remembered */
  }
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="evx-form-row">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

function Bilingual({
  labels,
  value,
  onChange,
  multiline,
}: {
  labels: [string, string];
  value: LocalizedText | undefined;
  onChange: (v: LocalizedText | undefined, lang: 'en' | 'fr') => void;
  multiline?: boolean;
}) {
  return (
    <>
      {(['en', 'fr'] as const).map((l, i) => (
        <Field key={l} label={labels[i]!}>
          {(id) => {
            const props = {
              id,
              className: 'evx-field',
              lang: l,
              value: value?.[l] ?? '',
              onChange: (e: { target: { value: string } }) => {
                const next = { ...(value ?? {}), [l]: e.target.value };
                const empty = Object.values(next).every((x) => !x);
                onChange(empty ? undefined : next, l);
              },
            };
            return multiline ? <textarea rows={3} {...props} /> : <input {...props} />;
          }}
        </Field>
      ))}
    </>
  );
}

/** Who-sees-it checkboxes: none ticked means everyone. */
function Audiences({
  t,
  lang,
  env,
  value,
  onChange,
}: {
  t: Strings;
  lang: Lang;
  env: Environment;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="grid gap-1">
      <legend className="evx-form-row mb-1 font-semibold">{t.safety.audiences}</legend>
      {env.audiences.map((a) => (
        <label key={a.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.includes(a.id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, a.id] : value.filter((x) => x !== a.id))
            }
          />
          {localize(a.name, lang)}
        </label>
      ))}
      <p className="evx-hint">{t.safety.audiencesHint}</p>
    </fieldset>
  );
}

function Confirmation({
  t,
  confirmed,
  name,
  setName,
  onConfirm,
  onWithdraw,
}: {
  t: Strings;
  confirmed: { by: string; at: string } | undefined;
  name: string;
  setName: (n: string) => void;
  onConfirm: () => void;
  onWithdraw: () => void;
}) {
  const s = t.safety;
  return (
    <section
      className="evx-confirm grid gap-2"
      data-confirmed={!!confirmed}
      aria-label={s.confirmation}
    >
      <h3 className="evx-subheading">{s.confirmation}</h3>
      {confirmed ? (
        <p className="text-sm" data-testid="confirmed">
          {s.confirmedBy(confirmed.by, confirmed.at.slice(0, 10))}
        </p>
      ) : (
        <p className="text-sm" data-testid="not-confirmed">
          {s.notConfirmed}
        </p>
      )}
      <Field label={s.yourName}>
        {(id) => (
          <input
            id={id}
            className="evx-field"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <p className="evx-hint">{s.confirmHint}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="evx-cta evx-cta--small"
          disabled={!name.trim()}
          onClick={onConfirm}
        >
          {s.confirm}
        </button>
        {confirmed && (
          <button
            type="button"
            className="evx-cta evx-cta--ghost evx-cta--small"
            onClick={onWithdraw}
          >
            {s.unconfirm}
          </button>
        )}
      </div>
    </section>
  );
}

export function SafetyEditor({
  t,
  lang,
  store,
  doc,
  project,
}: {
  t: Strings;
  lang: Lang;
  store: DocumentStore;
  doc: DocumentState;
  project: ProjectInfo;
}) {
  const s = t.safety;
  const env = doc.env;
  const ids = useId();
  const name = (x: Record<string, string> | undefined) => (x ? localize(x, lang) : '');
  const floors = env.buildings.flatMap((b) => b.floors);
  const planFloors = floors.filter((f) => f.plan);

  const [mode, setMode] = useState<Mode>('equipment');
  const [tool, setTool] = useState<Tool>('select');
  const [floorId, setFloorId] = useState<string | null>(planFloors[0]?.id ?? floors[0]?.id ?? null);
  const [sceneId, setSceneId] = useState<string | null>(
    env.initialSceneId ?? env.scenes[0]?.id ?? null,
  );
  const [selected, setSelected] = useState<Pick | null>(null);
  const [draft, setDraft] = useState<{
    target: 'new' | string;
    floorId: string;
    points: PlanPoint[];
  } | null>(null);
  const [newRoute, setNewRoute] = useState<{
    name: LocalizedText;
    priority: 'primary' | 'secondary';
    ap: string;
  } | null>(null);
  const [addingPosting, setAddingPosting] = useState(false);
  const [newType, setNewType] = useState<{
    en: string;
    fr: string;
    category: string;
    symbol: string;
  } | null>(null);
  const [confirmName, setConfirmName] = useState(readName);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const viewer = useRef<Viewer | null>(null);
  const pendingLook = useRef<{ sceneId: string; yaw: number; pitch: number } | null>(null);

  const resolveAsset = useCallback((p: string) => api.fileUrl(project.root, p), [project.root]);
  const floor = floors.find((f) => f.id === floorId) ?? null;
  const scene = env.scenes.find((x) => x.id === sceneId) ?? null;
  const item =
    selected?.kind === 'equipment'
      ? (env.equipment.find((e) => e.id === selected.id) ?? null)
      : null;
  const route =
    selected?.kind === 'route' ? (env.routes.find((r) => r.id === selected.id) ?? null) : null;
  const posting =
    selected?.kind === 'posting' ? (env.postings.find((p) => p.id === selected.id) ?? null) : null;
  const assemblyPoints = env.equipment.filter((e) => e.typeId === 'assembly-point');

  // Selection that no longer exists (undo, removal) is dropped.
  useEffect(() => {
    if (selected && !item && !route && !posting) setSelected(null);
  }, [selected, item, route, posting]);
  useEffect(() => setConfirmRemove(false), [selected]);

  function edit<T>(label: string, fn: (d: Environment) => T, key?: string): T | undefined {
    try {
      setProblem(null);
      return store.edit(label, fn, key);
    } catch (err) {
      setProblem(t.editor.inUse + refusal(err));
      return undefined;
    }
  }
  const setName = (n: string) => {
    setConfirmName(n);
    saveName(n);
  };
  const confirmation = () => ({ by: confirmName, at: new Date().toISOString() });

  /** Selecting an item brings its scene and floor into view in both panes. */
  function selectEquipment(id: string, from: 'list' | 'scene' | 'plan') {
    setSelected({ kind: 'equipment', id });
    const e = env.equipment.find((x) => x.id === id);
    if (!e) return;
    if (from !== 'plan' && e.floorId) setFloorId(e.floorId);
    if (from === 'scene') return;
    const p = e.placements.find((x) => x.sceneId === sceneId) ?? e.placements[0];
    if (p?.position.kind !== 'spherical') return;
    const look = { sceneId: p.sceneId, yaw: p.position.yaw, pitch: p.position.pitch };
    if (p.sceneId === sceneId)
      void viewer.current?.lookAt({ yaw: look.yaw, pitch: look.pitch }, 400);
    else {
      pendingLook.current = look;
      setSceneId(p.sceneId);
    }
  }

  function onPlanPoint(p: PlanPoint) {
    if (!floorId) return;
    if (draft) {
      setDraft({
        ...draft,
        floorId,
        points: [...(draft.floorId === floorId ? draft.points : []), p],
      });
      return;
    }
    if (mode === 'equipment' && tool === 'plan' && item)
      edit(s.labels.placeEquipment, (d) => so.placeEquipmentOnPlan(d, item.id, floorId, p));
    if (mode === 'postings' && addingPosting) {
      const id = edit(s.labels.addPosting, (d) =>
        so.addPosting(d, floorId, p, { en: s.newPosting, fr: t.safety.newPosting }),
      );
      if (id) setSelected({ kind: 'posting', id });
      setAddingPosting(false);
    }
  }

  function finishLine() {
    if (!draft || draft.points.length < 2) return;
    if (draft.target === 'new' && newRoute) {
      const id = edit(s.labels.addRoute, (d) =>
        so.addRoute(d, {
          name: newRoute.name,
          priority: newRoute.priority,
          assemblyPointId: newRoute.ap,
          floorId: draft.floorId,
          points: draft.points,
        }),
      );
      if (id) {
        setSelected({ kind: 'route', id });
        setNewRoute(null);
      }
    } else if (draft.target !== 'new')
      edit(s.labels.editRoute, (d) =>
        so.setRouteSegment(d, draft.target, null, draft.floorId, draft.points),
      );
    setDraft(null);
  }

  const crosshair =
    !!draft ||
    (mode === 'equipment' && tool === 'plan' && !!item) ||
    (mode === 'postings' && addingPosting);
  const typeOptions = [
    ...Object.keys(BUILT_IN_TYPES).map((id) => ({ id, name: name(BUILT_IN_TYPES[id]!.name) })),
    ...env.equipmentTypes.map((x) => ({ id: x.id, name: name(x.name) })),
  ];

  // ---------------------------------------------------------------- left column
  const list = (
    <aside className="evx-editor__scenes evx-panel" aria-label={s.modes[mode]}>
      {mode === 'equipment' && (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="evx-subheading">{s.equipment}</h2>
            <select
              className="evx-field evx-field--small"
              aria-label={s.addEquipment}
              value=""
              disabled={!floors.length}
              onChange={(e) => {
                const typeId = e.target.value;
                if (!typeId || !floorId) return;
                const id = edit(s.labels.addEquipment, (d) => so.addEquipment(d, typeId, floorId));
                if (id) {
                  setSelected({ kind: 'equipment', id });
                  setTool('scene');
                }
              }}
            >
              <option value="">{`+ ${s.addEquipment}`}</option>
              {typeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          {!newType ? (
            <button
              type="button"
              className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
              onClick={() => setNewType({ en: '', fr: '', category: 'custom', symbol: '' })}
            >
              {s.newType}
            </button>
          ) : (
            <form
              className="evx-action grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                edit(s.labels.addType, (d) =>
                  so.addEquipmentType(d, {
                    name: { en: newType.en, fr: newType.fr || newType.en },
                    category: newType.category as never,
                    ...(newType.symbol && { symbol: newType.symbol }),
                  }),
                );
                setNewType(null);
              }}
            >
              <Field label={s.newTypeName}>
                {(id) => (
                  <input
                    id={id}
                    className="evx-field"
                    required
                    value={newType.en}
                    onChange={(e) => setNewType({ ...newType, en: e.target.value })}
                  />
                )}
              </Field>
              <Field label={s.newTypeNameFr}>
                {(id) => (
                  <input
                    id={id}
                    className="evx-field"
                    value={newType.fr}
                    onChange={(e) => setNewType({ ...newType, fr: e.target.value })}
                  />
                )}
              </Field>
              <Field label={s.category}>
                {(id) => (
                  <select
                    id={id}
                    className="evx-field"
                    value={newType.category}
                    onChange={(e) => setNewType({ ...newType, category: e.target.value })}
                  >
                    {Object.entries(s.categories).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={s.newTypeSymbol}>
                {(id) => (
                  <input
                    id={id}
                    className="evx-field"
                    maxLength={4}
                    value={newType.symbol}
                    onChange={(e) => setNewType({ ...newType, symbol: e.target.value })}
                  />
                )}
              </Field>
              <div className="flex gap-2">
                <button type="submit" className="evx-cta evx-cta--small">
                  {s.createType}
                </button>
                <button
                  type="button"
                  className="evx-cta evx-cta--ghost evx-cta--small"
                  onClick={() => setNewType(null)}
                >
                  {s.cancel}
                </button>
              </div>
            </form>
          )}
          {env.equipment.length === 0 && <p className="evx-hint">{s.noEquipment}</p>}
          {floors.map((f) => {
            const items = env.equipment.filter((e) => e.floorId === f.id);
            if (!items.length) return null;
            return (
              <div key={f.id} className="grid gap-1">
                <p className="text-sm font-semibold">{name(f.name)}</p>
                <ul className="evx-scene-list" data-testid={`equipment-list-${f.id}`}>
                  {items.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        className="evx-row"
                        aria-current={
                          selected?.kind === 'equipment' && selected.id === e.id
                            ? 'true'
                            : undefined
                        }
                        data-equipment-id={e.id}
                        onClick={() => selectEquipment(e.id, 'list')}
                      >
                        <span className="evx-row__name">
                          {e.tag ? `${e.tag} · ` : ''}
                          {name(e.label ?? equipmentTypeInfo(env, e.typeId).name)}
                        </span>
                        <span className={e.confirmed ? 'evx-badge' : 'evx-badge evx-badge--warn'}>
                          {e.confirmed ? '✓' : '!'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      {mode === 'routes' && (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="evx-subheading">{s.routes}</h2>
            <button
              type="button"
              className="evx-cta evx-cta--small"
              disabled={!assemblyPoints.length || !!newRoute}
              onClick={() => {
                setNewRoute({
                  name: { en: '', fr: '' },
                  priority: 'primary',
                  ap: assemblyPoints[0]!.id,
                });
                setSelected(null);
              }}
            >
              {s.newRoute}
            </button>
          </div>
          {!assemblyPoints.length && <p className="evx-hint">{s.needAssemblyPoint}</p>}
          {env.routes.length === 0 && <p className="evx-hint">{s.noRoutes}</p>}
          <ul className="evx-scene-list">
            {env.routes.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="evx-row"
                  aria-current={route?.id === r.id ? 'true' : undefined}
                  data-route-id={r.id}
                  onClick={() => {
                    setSelected({ kind: 'route', id: r.id });
                    setNewRoute(null);
                    setDraft(null);
                    // Show the route where it starts, unless this scene is on it.
                    if (!sceneId || !r.sceneSequence.includes(sceneId)) {
                      const first = r.sceneSequence[0];
                      if (first) setSceneId(first);
                    }
                    const seg = r.segments.find((x) => x.floorId === floorId) ?? r.segments[0];
                    if (seg) setFloorId(seg.floorId);
                  }}
                >
                  <span className="evx-row__name">
                    {name(r.name)} · {s.priorities[r.priority]}
                  </span>
                  <span className={r.confirmed ? 'evx-badge' : 'evx-badge evx-badge--warn'}>
                    {r.confirmed ? '✓' : '!'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mode === 'postings' && (
        <div className="grid gap-3">
          <h2 className="evx-subheading">{s.postings}</h2>
          <p className="evx-hint">{s.postingsHint}</p>
          <button
            type="button"
            className="evx-cta evx-cta--small justify-self-start"
            aria-pressed={addingPosting}
            disabled={!floor?.plan}
            onClick={() => setAddingPosting(!addingPosting)}
          >
            {s.addPosting}
          </button>
          {env.postings.length === 0 && <p className="evx-hint">{s.noPostings}</p>}
          <ul className="evx-scene-list">
            {env.postings.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="evx-row"
                  aria-current={posting?.id === p.id ? 'true' : undefined}
                  onClick={() => {
                    setSelected({ kind: 'posting', id: p.id });
                    setFloorId(p.floorId);
                  }}
                >
                  <span className="evx-row__name">{name(p.name)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mode === 'package' && (
        <div className="grid gap-3">
          <h2 className="evx-subheading">{s.packageTitle}</h2>
          <p className="text-sm">{s.packageLead}</p>
        </div>
      )}
    </aside>
  );

  // ---------------------------------------------------------------- middle: preview + plan
  const planPicker = (
    <div className="evx-toolbar">
      <label className="flex items-center gap-2 text-sm">
        <span>{s.floor}</span>
        <select
          className="evx-field evx-field--small"
          value={floorId ?? ''}
          onChange={(e) => setFloorId(e.target.value)}
        >
          {floors.map((f) => (
            <option key={f.id} value={f.id}>
              {name(f.name)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span>{s.scene}</span>
        <select
          className="evx-field evx-field--small"
          value={sceneId ?? ''}
          onChange={(e) => setSceneId(e.target.value)}
        >
          {env.scenes.map((x) => (
            <option key={x.id} value={x.id}>
              {name(x.name)}
            </option>
          ))}
        </select>
      </label>
      {mode === 'equipment' && (
        <div className="evx-segmented" role="radiogroup" aria-label={s.modes.equipment}>
          {(['select', 'scene', 'plan'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={tool === k}
              onClick={() => setTool(k)}
            >
              {s.tools[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
  const middle = (
    <section className="evx-editor__stage evx-safety-stage" aria-label={s.modes[mode]}>
      {planPicker}
      {mode === 'equipment' && <p className="evx-hint">{s.toolHint[tool]}</p>}
      <div className="evx-safety-views">
        {scene && sceneId && mode !== 'package' && (
          <Preview
            env={env}
            sceneId={sceneId}
            editing
            selectedHotspot={item ? `${EQ}${item.id}` : null}
            lang={lang}
            resolveAsset={resolveAsset}
            viewerRef={(v) => (viewer.current = v)}
            failedText={t.editor.previewFailed}
            routeId={route?.id ?? null}
            onPanoramaClick={(at) => {
              if (mode === 'equipment' && tool === 'scene' && item)
                edit(s.labels.placeEquipment, (d) =>
                  so.placeEquipmentInScene(d, item.id, sceneId, at),
                );
            }}
            onHotspotClick={(id) => {
              if (id.startsWith(EQ)) selectEquipment(id.slice(EQ.length), 'scene');
            }}
            onHotspotMove={(id, at) => {
              if (id.startsWith(EQ))
                edit(
                  s.labels.placeEquipment,
                  (d) => so.placeEquipmentInScene(d, id.slice(EQ.length), sceneId, at),
                  `move:${id}`,
                );
            }}
            onSceneChange={(id) => {
              const look = pendingLook.current;
              if (look?.sceneId === id) {
                pendingLook.current = null;
                void viewer.current?.lookAt({ yaw: look.yaw, pitch: look.pitch }, 0);
              }
            }}
          />
        )}
        <div className="grid content-start gap-3">
          {draft && (
            <div className="evx-toolbar" role="group" aria-label={s.draw}>
              <p className="evx-hint w-full" data-testid="draw-hint">
                {s.drawHint(draft.points.length)}
              </p>
              <button
                type="button"
                className="evx-cta evx-cta--ghost evx-cta--small"
                disabled={!draft.points.length}
                onClick={() => setDraft({ ...draft, points: draft.points.slice(0, -1) })}
              >
                {s.undoPoint}
              </button>
              <button
                type="button"
                className="evx-cta evx-cta--small"
                disabled={draft.points.length < 2}
                onClick={finishLine}
              >
                {draft.target === 'new' ? s.createRoute : s.finishLine}
              </button>
              <button
                type="button"
                className="evx-cta evx-cta--ghost evx-cta--small"
                onClick={() => setDraft(null)}
              >
                {s.cancel}
              </button>
            </div>
          )}
          {floorId && floor?.plan ? (
            <SafetyPlan
              env={env}
              floorId={floorId}
              lang={lang}
              image={api.fileUrl(project.root, floor.plan.image)}
              selected={selected}
              draft={draft && draft.floorId === floorId ? draft.points : null}
              highlightRoute={route?.id ?? null}
              crosshair={crosshair}
              onPoint={onPlanPoint}
              onPick={(p) => {
                if (draft || crosshair) return;
                if (p.kind === 'equipment') selectEquipment(p.id, 'plan');
                else setSelected(p);
              }}
            />
          ) : (
            <p className="evx-panel evx-hint">{s.noPlanFloor}</p>
          )}
        </div>
      </div>
    </section>
  );

  // ---------------------------------------------------------------- inspector
  let inspector: ReactNode = <p className="evx-hint">{s.pickHint[mode]}</p>;
  if (mode === 'equipment' && item) {
    const info = equipmentTypeInfo(env, item.typeId);
    inspector = (
      <div className="grid gap-4" data-testid="equipment-inspector">
        <h2 className="evx-subheading">{name(item.label ?? info.name)}</h2>
        <Field label={s.type}>
          {(id) => (
            <select
              id={id}
              className="evx-field"
              value={item.typeId}
              onChange={(e) =>
                edit(s.labels.editEquipment, (d) => so.setEquipmentType(d, item.id, e.target.value))
              }
            >
              {typeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={s.tag}>
          {(id) => (
            <input
              id={id}
              className="evx-field"
              maxLength={64}
              value={item.tag ?? ''}
              onChange={(e) =>
                edit(
                  s.labels.editEquipment,
                  (d) => so.updateEquipment(d, item.id, { tag: e.target.value }),
                  `tag:${item.id}`,
                )
              }
            />
          )}
        </Field>
        <Bilingual
          labels={[s.labelEn, s.labelFr]}
          value={item.label}
          onChange={(v, l) =>
            edit(
              s.labels.editEquipment,
              (d) => so.updateEquipment(d, item.id, { label: v }),
              `label:${item.id}:${l}`,
            )
          }
        />
        <Bilingual
          multiline
          labels={[s.descriptionEn, s.descriptionFr]}
          value={item.description}
          onChange={(v, l) =>
            edit(
              s.labels.editEquipment,
              (d) => so.updateEquipment(d, item.id, { description: v }),
              `desc:${item.id}:${l}`,
            )
          }
        />
        <Field label={s.floor}>
          {(id) => (
            <select
              id={id}
              className="evx-field"
              value={item.floorId}
              onChange={(e) =>
                edit(s.labels.placeEquipment, (d) =>
                  so.placeEquipmentOnPlan(d, item.id, e.target.value),
                )
              }
            >
              {floors.map((f) => (
                <option key={f.id} value={f.id}>
                  {name(f.name)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <p className="text-sm" data-testid="plan-status">
          {item.planPosition ? `${s.onPlan}: ${s.placed}` : s.notOnPlan}
        </p>
        <div>
          <h3 className="evx-subheading">{s.placements}</h3>
          {item.placements.length === 0 && <p className="evx-hint">{s.noPlacements}</p>}
          <ul className="grid gap-1 text-sm" data-testid="placements">
            {item.placements.map((p) => (
              <li key={p.sceneId} className="flex flex-wrap items-center justify-between gap-2">
                <span>{name(env.scenes.find((x) => x.id === p.sceneId)?.name)}</span>
                <button
                  type="button"
                  className="evx-icon-btn"
                  aria-label={`${s.removeFromScene}: ${p.sceneId}`}
                  onClick={() =>
                    edit(s.labels.placeEquipment, (d) => so.removePlacement(d, item.id, p.sceneId))
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
        {(['lastInspection', 'nextInspection'] as const).map((k) => (
          <Field key={k} label={s[k]}>
            {(id) => (
              <input
                id={id}
                type="date"
                className="evx-field"
                value={item[k] ?? ''}
                onChange={(e) =>
                  edit(s.labels.editEquipment, (d) =>
                    so.updateEquipment(d, item.id, { [k]: e.target.value }),
                  )
                }
              />
            )}
          </Field>
        ))}
        <Field label={s.responsible}>
          {(id) => (
            <input
              id={id}
              className="evx-field"
              maxLength={200}
              value={item.responsiblePerson ?? ''}
              onChange={(e) =>
                edit(
                  s.labels.editEquipment,
                  (d) => so.updateEquipment(d, item.id, { responsiblePerson: e.target.value }),
                  `resp:${item.id}`,
                )
              }
            />
          )}
        </Field>
        <Audiences
          t={t}
          lang={lang}
          env={env}
          value={item.audienceIds}
          onChange={(v) =>
            edit(s.labels.editEquipment, (d) => so.updateEquipment(d, item.id, { audienceIds: v }))
          }
        />
        <Confirmation
          t={t}
          confirmed={item.confirmed}
          name={confirmName}
          setName={setName}
          onConfirm={() =>
            edit(s.labels.confirm, (d) => so.confirmEquipment(d, item.id, confirmation()))
          }
          onWithdraw={() => edit(s.labels.unconfirm, (d) => so.unconfirm(d, 'equipment', item.id))}
        />
        {confirmRemove ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm">{s.removeConfirm}</p>
            <button
              type="button"
              className="evx-cta evx-cta--small"
              onClick={() => edit(s.labels.removeEquipment, (d) => so.removeEquipment(d, item.id))}
            >
              {s.remove}
            </button>
            <button
              type="button"
              className="evx-cta evx-cta--ghost evx-cta--small"
              onClick={() => setConfirmRemove(false)}
            >
              {s.cancel}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
            onClick={() => setConfirmRemove(true)}
          >
            {s.remove}
          </button>
        )}
      </div>
    );
  }
  if (mode === 'routes' && newRoute) {
    inspector = (
      <div className="grid gap-4" data-testid="new-route">
        <h2 className="evx-subheading">{s.newRoute}</h2>
        <Bilingual
          labels={[s.routeNameEn, s.routeNameFr]}
          value={newRoute.name}
          onChange={(v) => setNewRoute({ ...newRoute, name: v ?? { en: '' } })}
        />
        <Field label={s.priority}>
          {(id) => (
            <select
              id={id}
              className="evx-field"
              value={newRoute.priority}
              onChange={(e) =>
                setNewRoute({ ...newRoute, priority: e.target.value as 'primary' | 'secondary' })
              }
            >
              <option value="primary">{s.priorities.primary}</option>
              <option value="secondary">{s.priorities.secondary}</option>
            </select>
          )}
        </Field>
        <Field label={s.assemblyPoint}>
          {(id) => (
            <select
              id={id}
              className="evx-field"
              value={newRoute.ap}
              onChange={(e) => setNewRoute({ ...newRoute, ap: e.target.value })}
            >
              {assemblyPoints.map((a) => (
                <option key={a.id} value={a.id}>
                  {name(a.label ?? equipmentTypeInfo(env, a.typeId).name)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <button
          type="button"
          className="evx-cta evx-cta--small justify-self-start"
          disabled={!newRoute.name.en?.trim() || !floor?.plan}
          onClick={() => floorId && setDraft({ target: 'new', floorId, points: [] })}
        >
          {s.draw}
        </button>
        <button
          type="button"
          className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
          onClick={() => {
            setNewRoute(null);
            setDraft(null);
          }}
        >
          {s.cancel}
        </button>
      </div>
    );
  } else if (mode === 'routes' && route) {
    const suggestedScenes = so.suggestRouteScenes(env, route);
    const differs = JSON.stringify(suggestedScenes) !== JSON.stringify(route.sceneSequence);
    inspector = (
      <div className="grid gap-4" data-testid="route-inspector">
        <h2 className="evx-subheading">{name(route.name)}</h2>
        <Bilingual
          labels={[s.routeNameEn, s.routeNameFr]}
          value={route.name}
          onChange={(v, l) =>
            v &&
            edit(
              s.labels.editRoute,
              (d) => so.updateRoute(d, route.id, { name: v }),
              `rname:${route.id}:${l}`,
            )
          }
        />
        <Field label={s.priority}>
          {(id) => (
            <select
              id={id}
              className="evx-field"
              value={route.priority}
              onChange={(e) =>
                edit(s.labels.editRoute, (d) =>
                  so.updateRoute(d, route.id, {
                    priority: e.target.value as 'primary' | 'secondary',
                  }),
                )
              }
            >
              <option value="primary">{s.priorities.primary}</option>
              <option value="secondary">{s.priorities.secondary}</option>
            </select>
          )}
        </Field>
        <Field label={s.assemblyPoint}>
          {(id) => (
            <select
              id={id}
              className="evx-field"
              value={route.assemblyPointId}
              onChange={(e) =>
                edit(s.labels.editRoute, (d) =>
                  so.updateRoute(d, route.id, { assemblyPointId: e.target.value }),
                )
              }
            >
              {assemblyPoints.map((a) => (
                <option key={a.id} value={a.id}>
                  {name(a.label ?? equipmentTypeInfo(env, a.typeId).name)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="grid gap-2">
          <h3 className="evx-subheading">{s.lines}</h3>
          <ul className="grid gap-1 text-sm" data-testid="route-lines">
            {route.segments.map((seg, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {name(floors.find((f) => f.id === seg.floorId)?.name)} ·{' '}
                  {s.points(seg.points.length)}
                </span>
                <button
                  type="button"
                  className="evx-icon-btn"
                  aria-label={`${s.removeLine} ${i + 1}`}
                  disabled={route.segments.length < 2}
                  onClick={() =>
                    edit(s.labels.editRoute, (d) => so.removeRouteSegment(d, route.id, i))
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
            disabled={!floor?.plan || !!draft}
            onClick={() => floorId && setDraft({ target: route.id, floorId, points: [] })}
          >
            {s.draw}
          </button>
        </div>
        <div className="grid gap-2">
          <h3 className="evx-subheading">{s.sceneSequence}</h3>
          {route.sceneSequence.length === 0 && <p className="evx-hint">{s.noScenes}</p>}
          <ol className="grid gap-1 text-sm" data-testid="route-scenes">
            {route.sceneSequence.map((id) => {
              const h = route.starts.find((x) => x.sceneId === id)?.heading;
              return (
                <li key={id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {name(env.scenes.find((x) => x.id === id)?.name)} ·{' '}
                    {h ? s.heading(h.yaw) : s.noHeading}
                  </span>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      className="evx-cta evx-cta--ghost evx-cta--small"
                      onClick={() => {
                        if (sceneId !== id) setSceneId(id);
                        else {
                          const v = viewer.current?.getView();
                          if (v)
                            edit(s.labels.editRoute, (d) =>
                              so.setRouteHeading(d, route.id, id, { yaw: v.yaw, pitch: -12 }),
                            );
                        }
                      }}
                    >
                      {sceneId === id ? s.useView : s.preview}
                    </button>
                    <button
                      type="button"
                      className="evx-icon-btn"
                      aria-label={`${s.removeLine}: ${id}`}
                      onClick={() =>
                        edit(s.labels.editRoute, (d) =>
                          so.setRouteScenes(
                            d,
                            route.id,
                            route.sceneSequence.filter((x) => x !== id),
                          ),
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          {differs && suggestedScenes.length > 0 && (
            <div className="evx-suggestion grid" data-testid="suggested-scenes">
              <span className="text-sm">
                {s.suggested}:{' '}
                {suggestedScenes
                  .map((id) => name(env.scenes.find((x) => x.id === id)?.name))
                  .join(' → ')}
              </span>
              <button
                type="button"
                className="evx-cta evx-cta--small justify-self-start"
                onClick={() =>
                  edit(s.labels.editRoute, (d) => so.setRouteScenes(d, route.id, suggestedScenes))
                }
              >
                {s.applySuggested}
              </button>
            </div>
          )}
          {route.sceneSequence.length > 0 && (
            <button
              type="button"
              className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
              onClick={() =>
                edit(s.labels.editRoute, (d) => {
                  for (const id of route.sceneSequence) {
                    const h = so.suggestHeading(d, route, id);
                    if (h) so.setRouteHeading(d, route.id, id, h);
                  }
                })
              }
            >
              {s.useSuggestedHeadings}
            </button>
          )}
        </div>
        <Audiences
          t={t}
          lang={lang}
          env={env}
          value={route.audienceIds}
          onChange={(v) =>
            edit(s.labels.editRoute, (d) => so.updateRoute(d, route.id, { audienceIds: v }))
          }
        />
        <Confirmation
          t={t}
          confirmed={route.confirmed}
          name={confirmName}
          setName={setName}
          onConfirm={() =>
            edit(s.labels.confirm, (d) => so.confirmRoute(d, route.id, confirmation()))
          }
          onWithdraw={() => edit(s.labels.unconfirm, (d) => so.unconfirm(d, 'route', route.id))}
        />
        <button
          type="button"
          className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
          onClick={() => edit(s.labels.removeRoute, (d) => so.removeRoute(d, route.id))}
        >
          {s.removeRoute}
        </button>
      </div>
    );
  }
  if (mode === 'postings' && posting) {
    inspector = (
      <div className="grid gap-4" data-testid="posting-inspector">
        <h2 className="evx-subheading">{name(posting.name)}</h2>
        <Bilingual
          labels={[s.postingNameEn, s.postingNameFr]}
          value={posting.name}
          onChange={(v, l) =>
            v &&
            edit(
              s.labels.editPosting,
              (d) => so.updatePosting(d, posting.id, { name: v }),
              `pname:${posting.id}:${l}`,
            )
          }
        />
        <Field label={s.facing}>
          {(id) => (
            <input
              id={id}
              className="evx-field"
              type="number"
              step="15"
              value={posting.facingDeg ?? ''}
              onChange={(e) =>
                edit(
                  s.labels.editPosting,
                  (d) =>
                    so.updatePosting(d, posting.id, {
                      facingDeg: e.target.value === '' ? null : Number(e.target.value),
                    }),
                  `pface:${posting.id}`,
                )
              }
            />
          )}
        </Field>
        <Field label={s.scene}>
          {(id) => (
            <select
              id={id}
              className="evx-field"
              value={posting.sceneId ?? ''}
              onChange={(e) =>
                edit(s.labels.editPosting, (d) =>
                  so.updatePosting(d, posting.id, { sceneId: e.target.value || null }),
                )
              }
            >
              <option value="">—</option>
              {env.scenes.map((x) => (
                <option key={x.id} value={x.id}>
                  {name(x.name)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <button
          type="button"
          className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
          onClick={() => edit(s.labels.removePosting, (d) => so.removePosting(d, posting.id))}
        >
          {s.removePosting}
        </button>
      </div>
    );
  }
  if (mode === 'package') {
    inspector = (
      <div className="grid gap-4" data-testid="package-inspector">
        <Field label={s.defaultAudience}>
          {(id) => (
            <select
              id={id}
              className="evx-field"
              value={env.settings.defaultAudienceId ?? ''}
              onChange={(e) =>
                edit(s.labels.lock, (d) =>
                  so.setAudienceLock(d, d.settings.lockAudience, e.target.value),
                )
              }
            >
              {env.audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {name(a.name)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={env.settings.lockAudience}
            onChange={(e) => edit(s.labels.lock, (d) => so.setAudienceLock(d, e.target.checked))}
          />
          {s.lock}
        </label>
        <p className="evx-hint">{s.lockHint}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="evx-toolbar px-6 pt-4">
        <div
          className="evx-segmented"
          role="radiogroup"
          aria-label={s.modesLabel}
          id={`${ids}-modes`}
        >
          {(['equipment', 'routes', 'postings', 'package'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m);
                setSelected(null);
                setDraft(null);
                setNewRoute(null);
                setAddingPosting(false);
              }}
            >
              {s.modes[m]}
            </button>
          ))}
        </div>
        <SafetyExports t={t} lang={lang} env={env} />
      </div>
      <div className="evx-editor">
        {list}
        {middle}
        <aside className="evx-editor__inspector evx-panel" aria-label={s.modes[mode]}>
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
