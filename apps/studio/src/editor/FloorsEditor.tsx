/**
 * Buildings, floors and floor plans: import a plan image, set its scale by clicking two
 * points of known distance, set its north, and place scenes where they were captured.
 * Plan positions drive link suggestions and, later, the Viewer's mini-map and routes.
 */
import type { Environment, PlanPoint } from '@evactis-3dworkflow/schema';
import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { api, type AssetRecord, type ImportEvent, type ProjectInfo } from '../api.ts';
import { describeError } from '../format.ts';
import type { Lang, Strings } from '../i18n.ts';
import * as ops from './ops.ts';
import type { DocumentState, DocumentStore } from './store.ts';
import { refusal } from './useDocument.ts';

type Mode = 'none' | 'place' | 'calibrate';

/** A scene name on the plan, on a white tag sized to the text so walls do not show through. */
function PlanLabel({
  x,
  y,
  size,
  maxX,
  children,
}: {
  x: number;
  y: number;
  size: number;
  /** Plan width: a label that would run past it goes on the marker's left instead. */
  maxX: number;
  children: string;
}) {
  const text = useRef<SVGTextElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const b = text.current?.getBBox?.();
    if (b) setBox({ w: b.width, h: b.height });
  }, [children, size]);
  const pad = size * 0.3;
  // `x` is just right of the marker; on the left, mirror it around the marker centre.
  if (box && x + box.w + pad > maxX) x = x - size * 2 - box.w;
  return (
    <>
      {box && (
        <rect
          className="evx-plan__tag"
          x={x - pad}
          y={y - box.h / 2 - pad / 2}
          width={box.w + pad * 2}
          height={box.h + pad}
          rx={pad}
        />
      )}
      <text ref={text} x={x} y={y} fontSize={size} dominantBaseline="central">
        {children}
      </text>
    </>
  );
}

function PlanCanvas({
  env,
  floorId,
  image,
  width,
  height,
  mode,
  placing,
  points,
  label,
  onPoint,
}: {
  env: Environment;
  floorId: string;
  image: string;
  width: number;
  height: number;
  mode: Mode;
  placing: string | null;
  points: PlanPoint[];
  label: (id: string) => string;
  onPoint: (p: PlanPoint) => void;
}) {
  const r = Math.max(width, height) / 90;
  const click = (ev: MouseEvent<SVGSVGElement>) => {
    if (mode === 'none') return;
    const box = ev.currentTarget.getBoundingClientRect();
    onPoint({
      x: Math.round(((ev.clientX - box.left) / box.width) * width * 10) / 10,
      y: Math.round(((ev.clientY - box.top) / box.height) * height * 10) / 10,
    });
  };
  const placed = env.scenes.filter((s) => s.floorId === floorId && s.planPosition);
  return (
    // As wide as the column allows while the whole plan stays on screen, so a click maps
    // straight to plan pixels.
    <div
      className="evx-plan"
      style={{
        aspectRatio: `${width} / ${height}`,
        inlineSize: `min(100%, calc((100vh - 16rem) * ${width / height}))`,
      }}
    >
      <img src={image} alt="" draggable={false} />
      <svg
        viewBox={`0 0 ${width} ${height}`}
        data-testid="plan-canvas"
        data-mode={mode}
        onClick={click}
        aria-hidden="true"
      >
        {placed.map((s) => (
          <g key={s.id} data-scene-id={s.id} className={s.id === placing ? 'evx-plan__active' : ''}>
            <circle cx={s.planPosition!.x} cy={s.planPosition!.y} r={r} />
            <PlanLabel
              x={s.planPosition!.x + r * 1.5}
              y={s.planPosition!.y}
              size={r * 1.5}
              maxX={width}
            >
              {label(s.id)}
            </PlanLabel>
          </g>
        ))}
        {points.length === 2 && (
          <line
            className="evx-plan__scale"
            x1={points[0]!.x}
            y1={points[0]!.y}
            x2={points[1]!.x}
            y2={points[1]!.y}
            strokeWidth={r / 3}
          />
        )}
        {points.map((p, i) => (
          <circle key={i} className="evx-plan__scale" cx={p.x} cy={p.y} r={r * 0.6} />
        ))}
      </svg>
    </div>
  );
}

export function FloorsEditor({
  t,
  lang,
  store,
  doc,
  project,
  assets,
  onAssetsChanged,
}: {
  t: Strings;
  lang: Lang;
  store: DocumentStore;
  doc: DocumentState;
  project: ProjectInfo;
  assets: AssetRecord[];
  onAssetsChanged: () => void;
}) {
  const e = t.editor;
  const env = doc.env;
  const allFloors = env.buildings.flatMap((b) => b.floors);
  const [floorId, setFloorId] = useState<string | null>(allFloors[0]?.id ?? null);
  const [mode, setMode] = useState<Mode>('none');
  const [placing, setPlacing] = useState<string | null>(null);
  const [points, setPoints] = useState<PlanPoint[]>([]);
  const [distance, setDistance] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const ids = useId();

  const floor = allFloors.find((f) => f.id === floorId) ?? null;
  useEffect(() => {
    if (!floor && allFloors[0]) setFloorId(allFloors[0].id);
  }, [floor, allFloors]);
  useEffect(() => {
    setMode('none');
    setPoints([]);
    setConfirmRemove(false);
  }, [floorId]);

  const name = (n: Record<string, string>) => n[lang] || n.en || Object.values(n)[0] || '';
  const sceneName = (id: string) => {
    const s = env.scenes.find((x) => x.id === id);
    return s ? name(s.name) : id;
  };
  const plans = assets.filter((a) => a.kind === 'floor-plan');

  function edit<T>(label: string, fn: (d: Environment) => T, key?: string): T | undefined {
    try {
      setProblem(null);
      return store.edit(label, fn, key);
    } catch (err) {
      setProblem(e.inUse + refusal(err));
      return undefined;
    }
  }

  function addBuilding() {
    const id = edit(e.labels.addBuilding, (d) => {
      const b = ops.addBuilding(d, { en: t.editor.newBuilding, fr: t.editor.newBuilding });
      return ops.addFloor(d, b, { en: e.newFloor(0), fr: e.newFloor(0) }, 0);
    });
    if (id) setFloorId(id);
  }

  function addFloor(buildingId: string) {
    const b = env.buildings.find((x) => x.id === buildingId)!;
    const level = b.floors.length ? Math.max(...b.floors.map((f) => f.level)) + 1 : 0;
    const id = edit(e.labels.addFloor, (d) =>
      ops.addFloor(d, buildingId, { en: e.newFloor(level), fr: e.newFloor(level) }, level),
    );
    if (id) setFloorId(id);
  }

  async function importPlan() {
    if (!floor) return;
    const target = floor.id;
    const paths = await api.pickMedia(e.importPlanTitle, e.planFilter, 'floor-plan');
    if (!paths.length) return;
    setBusy(true);
    setProblem(null);
    const onEvent = (ev: ImportEvent) => {
      if (ev.event === 'imported')
        edit(e.labels.setPlan, (d) => ops.setFloorPlan(d, target, ev.asset));
      if (ev.event === 'failed')
        setProblem(describeError(t, { code: ev.code, message: ev.message }));
      if (ev.event === 'finished') {
        setBusy(false);
        onAssetsChanged();
      }
    };
    try {
      await api.importMedia(paths.slice(0, 1), onEvent, 'floor-plan');
    } catch (err) {
      setBusy(false);
      setProblem(describeError(t, err));
    }
  }

  function onPoint(p: PlanPoint) {
    if (!floor) return;
    if (mode === 'place' && placing) {
      edit(e.labels.placeScene, (d) => ops.placeScene(d, placing, floor.id, p));
      // Next unplaced scene on this floor, so a whole floor is placed click by click.
      const next = env.scenes.find(
        (s) => s.id !== placing && s.floorId === floor.id && !s.planPosition,
      );
      setPlacing(next?.id ?? placing);
    }
    if (mode === 'calibrate') setPoints(points.length >= 2 ? [p] : [...points, p]);
  }

  const onFloor = floor ? env.scenes.filter((s) => s.floorId === floor.id) : [];
  const elsewhere = floor ? env.scenes.filter((s) => s.floorId !== floor.id) : [];

  return (
    <div className="evx-editor">
      <aside className="evx-editor__scenes evx-panel" aria-labelledby={`${ids}-b`}>
        <div className="flex items-center justify-between gap-2">
          <h2 id={`${ids}-b`} className="evx-subheading">
            {e.buildings}
          </h2>
          <button type="button" className="evx-cta evx-cta--small" onClick={addBuilding}>
            {e.addBuilding}
          </button>
        </div>
        {env.buildings.length === 0 && <p className="evx-hint mt-3">{e.noBuildings}</p>}
        {env.buildings.map((b) => (
          <div key={b.id} className="mt-4 grid gap-2">
            <p className="text-sm font-semibold">{name(b.name)}</p>
            <ol className="evx-scene-list" aria-label={name(b.name)}>
              {[...b.floors].reverse().map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="evx-scene"
                    aria-current={f.id === floorId ? 'true' : undefined}
                    data-floor-id={f.id}
                    onClick={() => setFloorId(f.id)}
                  >
                    <span className="evx-scene__level">{f.level}</span>
                    <span className="evx-scene__name">{name(f.name)}</span>
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
              onClick={() => addFloor(b.id)}
            >
              {e.addFloor}
            </button>
          </div>
        ))}
      </aside>

      <section className="evx-editor__stage" aria-label={e.plan}>
        {floor ? (
          floor.plan ? (
            <>
              <div className="evx-toolbar" role="toolbar" aria-label={e.plan}>
                <div className="evx-segmented" role="radiogroup" aria-label={e.plan}>
                  {(['none', 'place', 'calibrate'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={mode === m}
                      onClick={() => {
                        setMode(m);
                        setPoints([]);
                        // Start with the first scene of this floor still to place.
                        if (m === 'place')
                          setPlacing(
                            (onFloor.find((s) => !s.planPosition) ?? onFloor[0] ?? env.scenes[0])
                              ?.id ?? null,
                          );
                      }}
                    >
                      {e.planModes[m]}
                    </button>
                  ))}
                </div>
                {mode === 'place' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span>{e.placeWhich}</span>
                    <select
                      className="evx-field evx-field--small"
                      value={placing ?? ''}
                      onChange={(ev) => setPlacing(ev.target.value)}
                    >
                      {env.scenes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {name(s.name)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className="evx-cta evx-cta--ghost evx-cta--small ml-auto"
                  disabled={busy}
                  onClick={() => void importPlan()}
                >
                  {busy ? e.importingPlan : e.replacePlan}
                </button>
              </div>
              <PlanCanvas
                env={env}
                floorId={floor.id}
                image={api.fileUrl(project.root, floor.plan.image)}
                width={floor.plan.widthPx}
                height={floor.plan.heightPx}
                mode={mode}
                placing={mode === 'place' ? placing : null}
                points={mode === 'calibrate' ? points : []}
                label={sceneName}
                onPoint={onPoint}
              />
              {mode === 'place' && <p className="evx-hint">{e.planPlaceHint}</p>}
              {mode === 'calibrate' && (
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    const m = Number(distance.replace(',', '.'));
                    if (points.length !== 2) return;
                    const ok = edit(e.labels.setScale, (d) => {
                      ops.calibrate(d, floor.id, points[0]!, points[1]!, m);
                      return true;
                    });
                    if (ok) {
                      setMode('none');
                      setPoints([]);
                      setDistance('');
                    }
                  }}
                >
                  <p className="evx-hint w-full">{e.calibrateHint(points.length)}</p>
                  {points.length === 2 && (
                    <>
                      <label className="grid gap-1 text-sm">
                        <span>{e.distance}</span>
                        <input
                          className="evx-field evx-field--small"
                          inputMode="decimal"
                          value={distance}
                          onChange={(ev) => setDistance(ev.target.value)}
                          required
                        />
                      </label>
                      <button type="submit" className="evx-cta evx-cta--small">
                        {e.applyScale}
                      </button>
                      <button
                        type="button"
                        className="evx-cta evx-cta--ghost evx-cta--small"
                        onClick={() => setPoints([])}
                      >
                        {e.restartScale}
                      </button>
                    </>
                  )}
                </form>
              )}
            </>
          ) : (
            <div className="evx-panel grid gap-4">
              <p>{e.noPlan}</p>
              <p className="evx-hint">{e.planHint}</p>
              <button
                type="button"
                className="evx-cta justify-self-start"
                disabled={busy}
                onClick={() => void importPlan()}
              >
                {busy ? e.importingPlan : e.importPlan}
              </button>
              {plans.length > 0 && (
                <label className="grid gap-2 text-sm">
                  <span>{e.usePlan}</span>
                  <select
                    className="evx-field"
                    value=""
                    onChange={(ev) => {
                      const a = plans.find((p) => p.id === ev.target.value);
                      if (a) edit(e.labels.setPlan, (d) => ops.setFloorPlan(d, floor.id, a));
                    }}
                  >
                    <option value="">{e.choosePlan}</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )
        ) : (
          <div className="evx-panel evx-editor__empty">
            <p>{e.noBuildings}</p>
          </div>
        )}
        {problem && (
          <p role="alert" className="evx-alert">
            {problem}
          </p>
        )}
      </section>

      <aside className="evx-editor__inspector evx-panel" aria-label={e.floor}>
        {floor && (
          <div className="grid gap-4" data-testid="floor-inspector">
            <h2 className="evx-subheading">{name(floor.name)}</h2>
            {(['en', 'fr'] as const).map((l) => (
              <div className="evx-form-row" key={l}>
                <label htmlFor={`${ids}-n-${l}`}>{l === 'en' ? e.nameEn : e.nameFr}</label>
                <input
                  id={`${ids}-n-${l}`}
                  className="evx-field"
                  lang={l}
                  value={floor.name[l] ?? ''}
                  onChange={(ev) =>
                    edit(
                      e.labels.editFloor,
                      (d) =>
                        ops.updateFloor(d, floor.id, {
                          name: { ...floor.name, [l]: ev.target.value },
                        }),
                      `floor-name:${floor.id}:${l}`,
                    )
                  }
                />
              </div>
            ))}
            <div className="evx-form-row">
              <label htmlFor={`${ids}-level`}>{e.level}</label>
              <input
                id={`${ids}-level`}
                className="evx-field"
                type="number"
                step="1"
                value={floor.level}
                onChange={(ev) => {
                  const n = Number(ev.target.value);
                  if (ev.target.value !== '' && Number.isInteger(n))
                    edit(
                      e.labels.editFloor,
                      (d) => ops.updateFloor(d, floor.id, { level: n }),
                      `floor-level:${floor.id}`,
                    );
                }}
              />
            </div>
            {floor.plan && (
              <>
                <dl className="evx-details">
                  <dt>{e.scale}</dt>
                  <dd data-testid="plan-scale">
                    {floor.plan.pixelsPerMetre
                      ? e.pxPerMetre(floor.plan.pixelsPerMetre)
                      : e.notCalibrated}
                  </dd>
                </dl>
                <div className="evx-form-row">
                  <label htmlFor={`${ids}-north`}>{e.planNorth}</label>
                  <input
                    id={`${ids}-north`}
                    className="evx-field"
                    type="number"
                    step="1"
                    min={0}
                    max={359}
                    value={floor.plan.northDeg}
                    onChange={(ev) => {
                      const n = Number(ev.target.value);
                      if (ev.target.value !== '' && Number.isFinite(n))
                        edit(
                          e.labels.planNorth,
                          (d) => ops.setPlanNorth(d, floor.id, n),
                          `plan-north:${floor.id}`,
                        );
                    }}
                  />
                </div>
              </>
            )}
            <section className="grid gap-2" aria-labelledby={`${ids}-sof`}>
              <h3 id={`${ids}-sof`} className="evx-subheading">
                {e.scenesOnFloor}
              </h3>
              <ul className="grid gap-1 text-sm" data-testid="floor-scenes">
                {onFloor.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span>
                      {name(s.name)}
                      {!s.planPosition && floor.plan && (
                        <span className="evx-hint"> · {e.notPlaced}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="evx-icon-btn"
                      aria-label={`${e.unplace}: ${name(s.name)}`}
                      onClick={() => edit(e.labels.unplaceScene, (d) => ops.unplaceScene(d, s.id))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              {elsewhere.length > 0 && (
                <select
                  className="evx-field"
                  aria-label={e.placeWhich}
                  value=""
                  onChange={(ev) => {
                    const id = ev.target.value;
                    if (id) edit(e.labels.sceneFloor, (d) => ops.placeScene(d, id, floor.id));
                  }}
                >
                  <option value="">{`+ ${e.scene}…`}</option>
                  {elsewhere.map((s) => (
                    <option key={s.id} value={s.id}>
                      {name(s.name)}
                    </option>
                  ))}
                </select>
              )}
            </section>
            <div className="flex flex-wrap items-center gap-2">
              {confirmRemove ? (
                <>
                  <p className="text-sm">{e.removeFloorConfirm}</p>
                  <button
                    type="button"
                    className="evx-cta evx-cta--small"
                    onClick={() => {
                      edit(e.labels.removeFloor, (d) => ops.removeFloor(d, floor.id));
                      setConfirmRemove(false);
                    }}
                  >
                    {e.removeFloor}
                  </button>
                  <button
                    type="button"
                    className="evx-cta evx-cta--ghost evx-cta--small"
                    onClick={() => setConfirmRemove(false)}
                  >
                    {t.cancel}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="evx-cta evx-cta--ghost evx-cta--small"
                  onClick={() => setConfirmRemove(true)}
                >
                  {e.removeFloor}
                </button>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
