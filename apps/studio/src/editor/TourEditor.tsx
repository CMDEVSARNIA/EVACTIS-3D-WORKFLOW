/**
 * Tour editing: scenes on the left, the live preview in the middle (click to place
 * hotspots, drag to move them), and the inspector for the selected scene or hotspot on
 * the right, including link suggestions the author can accept one by one.
 */
import * as Dialog from '@radix-ui/react-dialog';
import type { Environment, Hotspot, Scene } from '@evactis-3dworkflow/schema';
import type { Viewer } from '@evactis-3dworkflow/viewer';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api, type AssetRecord, type ProjectInfo } from '../api.ts';
import type { Lang, Strings } from '../i18n.ts';
import { ActionEditor } from './ActionEditor.tsx';
import { suggestLinks, type LinkSuggestion } from './autolink.ts';
import * as ops from './ops.ts';
import { Preview } from './Preview.tsx';
import type { DocumentState, DocumentStore } from './store.ts';
import { refusal } from './useDocument.ts';

type Mode = 'select' | 'link' | 'info';

/** Library asset ID from a project media path (`media/<id>/…`). */
export const assetIdOf = (path: string) => /^media\/([^/]+)\//.exec(path)?.[1] ?? null;

/** When an asset was captured (falls back to import time): sorts scenes in capture order. */
const captureKey = (a: AssetRecord | undefined) =>
  a
    ? a.capture.captureDate
      ? `${a.capture.captureDate}T${a.capture.captureTime ?? '00:00:00'}`
      : a.importedAt
    : '9999';

export function captureOrder(scenes: Scene[], assets: AssetRecord[]): string[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const key = (s: Scene) => captureKey(byId.get(assetIdOf(s.media.source) ?? ''));
  return scenes
    .map((s, i) => ({ s, i, k: key(s) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i))
    .map((x) => x.s.id);
}

const APPEARANCES = {
  next: { kind: 'button', icon: 'next' },
  info: { kind: 'marker', marker: 'info' },
  'evac-route': { kind: 'marker', marker: 'evac-route' },
  home: { kind: 'button', icon: 'home' },
  help: { kind: 'button', icon: 'help' },
} as const satisfies Record<string, Hotspot['appearance']>;
type AppearanceKey = keyof typeof APPEARANCES;

const appearanceKey = (a: Hotspot['appearance']): AppearanceKey | null =>
  (Object.keys(APPEARANCES) as AppearanceKey[]).find(
    (k) => JSON.stringify(APPEARANCES[k]) === JSON.stringify(a),
  ) ?? null;

function LocalizedInputs({
  labels,
  value,
  onChange,
}: {
  labels: [string, string];
  value: Record<string, string>;
  onChange: (lang: 'en' | 'fr', v: string) => void;
}) {
  const id = useId();
  return (
    <>
      {(['en', 'fr'] as const).map((l, i) => (
        <div className="evx-form-row" key={l}>
          <label htmlFor={`${id}-${l}`}>{labels[i]}</label>
          <input
            id={`${id}-${l}`}
            className="evx-field"
            lang={l}
            value={value[l] ?? ''}
            onChange={(e) => onChange(l, e.target.value)}
          />
        </div>
      ))}
    </>
  );
}

function AddScenesDialog({
  t,
  env,
  assets,
  thumb,
  onAdd,
  onOpenMedia,
}: {
  t: Strings;
  env: Environment;
  assets: AssetRecord[];
  thumb: (path: string) => string;
  onAdd: (assets: AssetRecord[]) => void;
  onOpenMedia: () => void;
}) {
  const e = t.editor;
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const used = new Set(env.scenes.map((s) => assetIdOf(s.media.source)));
  const usable = assets.filter((a) => a.kind !== 'floor-plan');
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setPicked(new Set());
      }}
    >
      <Dialog.Trigger className="evx-cta evx-cta--small">{e.addScenes}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="evx-chrome fixed top-1/2 left-1/2 grid max-h-[86vh] w-[min(94vw,52rem)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_1fr_auto] gap-4 rounded-xl border border-white/10 p-6 shadow-2xl">
          <Dialog.Title className="evx-heading text-xl">{e.addScenesTitle}</Dialog.Title>
          <Dialog.Description className="sr-only">{e.addScenesTitle}</Dialog.Description>
          {usable.length === 0 ? (
            <div className="grid gap-3">
              <p>{e.noSceneMedia}</p>
              <button
                type="button"
                className="evx-cta evx-cta--ghost justify-self-start"
                onClick={() => {
                  setOpen(false);
                  onOpenMedia();
                }}
              >
                {e.goToMedia}
              </button>
            </div>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3 overflow-auto p-1">
              {usable.map((a) => {
                const inTour = used.has(a.id);
                return (
                  <li key={a.id}>
                    <label className="evx-asset evx-asset--check" data-asset-id={a.id}>
                      <input
                        type="checkbox"
                        disabled={inTour}
                        checked={picked.has(a.id)}
                        onChange={(ev) => {
                          const next = new Set(picked);
                          if (ev.target.checked) next.add(a.id);
                          else next.delete(a.id);
                          setPicked(next);
                        }}
                      />
                      {a.thumbnail ? (
                        <img src={thumb(a.thumbnail)} alt="" loading="lazy" />
                      ) : (
                        <span className="evx-asset__placeholder">{t.kinds[a.kind]}</span>
                      )}
                      <span className="evx-asset__name">{a.name}</span>
                      <span className="evx-asset__meta">{inTour ? e.inTour : t.kinds[a.kind]}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              className="evx-cta"
              disabled={picked.size === 0}
              onClick={() => {
                onAdd(usable.filter((a) => picked.has(a.id)));
                setOpen(false);
              }}
            >
              {e.addSelected(picked.size)}
            </button>
            <Dialog.Close className="evx-cta evx-cta--ghost">{t.cancel}</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function TourEditor({
  t,
  lang,
  store,
  doc,
  project,
  assets,
  onOpenMedia,
}: {
  t: Strings;
  lang: Lang;
  store: DocumentStore;
  doc: DocumentState;
  project: ProjectInfo;
  assets: AssetRecord[];
  onOpenMedia: () => void;
}) {
  const e = t.editor;
  const env = doc.env;
  const [sceneId, setSceneId] = useState<string | null>(
    env.initialSceneId ?? env.scenes[0]?.id ?? null,
  );
  const [hotspotId, setHotspotId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('select');
  const [linkTarget, setLinkTarget] = useState('');
  const [testing, setTesting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const viewer = useRef<Viewer | null>(null);

  // Keep the selection pointing at things that exist (after undo, removal, restore).
  const scene = env.scenes.find((s) => s.id === sceneId) ?? null;
  useEffect(() => {
    if (!scene) setSceneId(env.initialSceneId ?? env.scenes[0]?.id ?? null);
  }, [scene, env]);
  const hotspot = env.hotspots.find((h) => h.id === hotspotId && h.sceneId === sceneId) ?? null;
  useEffect(() => {
    if (hotspotId && !hotspot) setHotspotId(null);
  }, [hotspotId, hotspot]);

  const name = (n: Record<string, string>) => n[lang] || n.en || Object.values(n)[0] || '';
  const resolveAsset = useCallback((p: string) => api.fileUrl(project.root, p), [project.root]);
  const order = useMemo(() => captureOrder(env.scenes, assets), [env.scenes, assets]);
  const suggestions = useMemo(
    () => (sceneId && scene ? suggestLinks(env, sceneId, { order }) : []),
    [env, sceneId, scene, order],
  );
  const floors = env.buildings.flatMap((b) =>
    b.floors.map((f) => ({
      ...f,
      label: env.buildings.length > 1 ? `${name(b.name)} · ${name(f.name)}` : name(f.name),
    })),
  );

  function edit<T>(label: string, fn: (d: Environment) => T, key?: string): T | undefined {
    try {
      setProblem(null);
      return store.edit(label, fn, key);
    } catch (err) {
      setProblem(e.inUse + refusal(err));
      return undefined;
    }
  }

  const view = () => viewer.current?.getView() ?? null;

  function place(at: { yaw: number; pitch: number }) {
    if (!sceneId || mode === 'select') return;
    const kind = mode;
    const id = edit(e.labels.addHotspot, (d) =>
      ops.addHotspot(
        d,
        sceneId,
        at,
        kind,
        kind === 'link' && linkTarget ? { target: linkTarget } : {},
      ),
    );
    if (id) setHotspotId(id);
    setMode('select');
  }

  function accept(s: LinkSuggestion) {
    if (!sceneId) return;
    // Direction unknown (capture order): place it where the author is looking.
    const at = { yaw: s.yaw ?? view()?.yaw ?? 0, pitch: s.pitch };
    const id = edit(e.labels.addLink, (d) =>
      ops.addHotspot(d, sceneId, at, 'link', { target: s.targetId }),
    );
    // Show where it landed, and stay on the scene so more suggestions can be added.
    if (id) void viewer.current?.lookAt({ yaw: at.yaw, pitch: at.pitch }, 500);
  }

  function addScenes(list: AssetRecord[]) {
    const byOrder = [...list].sort((a, b) => (captureKey(a) < captureKey(b) ? -1 : 1));
    const ids = edit(e.labels.addScenes, (d) => byOrder.map((a) => ops.addScene(d, a)));
    if (ids?.[0]) {
      setSceneId(ids[0]);
      setHotspotId(null);
    }
  }

  const sceneIndex = scene ? env.scenes.indexOf(scene) : -1;

  return (
    <div className="evx-editor">
      <aside className="evx-editor__scenes evx-panel" aria-labelledby="scenes-title">
        <div className="flex items-center justify-between gap-2">
          <h2 id="scenes-title" className="evx-subheading">
            {e.scenes}
          </h2>
          <AddScenesDialog
            t={t}
            env={env}
            assets={assets}
            thumb={resolveAsset}
            onAdd={addScenes}
            onOpenMedia={onOpenMedia}
          />
        </div>
        {env.scenes.length === 0 ? (
          <p className="evx-hint mt-3">{e.noScenes}</p>
        ) : (
          <ol className="evx-scene-list mt-3" aria-label={e.scenes}>
            {env.scenes.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="evx-scene"
                  aria-current={s.id === sceneId ? 'true' : undefined}
                  data-scene-id={s.id}
                  onClick={() => {
                    setSceneId(s.id);
                    setHotspotId(null);
                    setConfirmRemove(false);
                  }}
                >
                  {s.thumbnail ? <img src={resolveAsset(s.thumbnail)} alt="" /> : <span />}
                  <span className="evx-scene__name">{name(s.name)}</span>
                  {env.initialSceneId === s.id && <span className="evx-badge">{e.startScene}</span>}
                </button>
              </li>
            ))}
          </ol>
        )}
      </aside>

      <section className="evx-editor__stage" aria-label={e.preview}>
        {scene && sceneId ? (
          <>
            <div className="evx-toolbar" role="toolbar" aria-label={e.preview}>
              {testing ? (
                <>
                  <p className="text-sm">{e.testing}</p>
                  <button
                    type="button"
                    className="evx-cta evx-cta--small"
                    onClick={() => setTesting(false)}
                  >
                    {e.backToEditing}
                  </button>
                </>
              ) : (
                <>
                  <div className="evx-segmented" role="radiogroup" aria-label={e.preview}>
                    {(['select', 'link', 'info'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={mode === m}
                        onClick={() => setMode(m)}
                      >
                        {m === 'select' ? e.modeSelect : m === 'link' ? e.modeLink : e.modeInfo}
                      </button>
                    ))}
                  </div>
                  {mode === 'link' && (
                    <label className="flex items-center gap-2 text-sm">
                      <span>{e.destination}</span>
                      <select
                        className="evx-field evx-field--small"
                        value={linkTarget}
                        onChange={(ev) => setLinkTarget(ev.target.value)}
                      >
                        <option value="">{e.chooseDestination}</option>
                        {env.scenes
                          .filter((s) => s.id !== sceneId)
                          .map((s) => (
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
                    onClick={() => {
                      setMode('select');
                      setTesting(true);
                    }}
                  >
                    {e.testTour}
                  </button>
                </>
              )}
            </div>
            <Preview
              env={env}
              sceneId={sceneId}
              editing={!testing}
              selectedHotspot={hotspotId}
              lang={lang}
              resolveAsset={resolveAsset}
              viewerRef={(v) => (viewer.current = v)}
              failedText={e.previewFailed}
              onPanoramaClick={place}
              onHotspotClick={(id) => {
                // Equipment signs are edited in the Safety tab.
                if (id.startsWith('equipment:')) return;
                setHotspotId(id);
                setMode('select');
              }}
              onHotspotMove={(id, at) => {
                if (!id.startsWith('equipment:'))
                  edit(e.labels.moveHotspot, (d) => ops.moveHotspot(d, id, at), `move:${id}`);
              }}
              onSceneChange={(id) => {
                if (testing && id !== sceneId) {
                  setSceneId(id);
                  setHotspotId(null);
                }
              }}
            />
            {!testing && <p className="evx-hint">{e.placeHint[mode]}</p>}
          </>
        ) : (
          <div className="evx-panel evx-editor__empty">
            <p>{e.noScenes}</p>
          </div>
        )}
      </section>

      <aside
        className="evx-editor__inspector evx-panel"
        aria-label={hotspot ? e.hotspot : e.sceneName}
      >
        {problem && (
          <p role="alert" className="evx-alert mb-4">
            {problem}
          </p>
        )}
        {hotspot && sceneId ? (
          <div className="grid gap-4" data-testid="hotspot-inspector">
            <div className="flex items-center justify-between gap-2">
              <h2 className="evx-subheading">{e.hotspot}</h2>
              <button
                type="button"
                className="evx-cta evx-cta--ghost evx-cta--small"
                onClick={() => setHotspotId(null)}
              >
                {e.deselect}
              </button>
            </div>
            <LocalizedInputs
              labels={[e.titleEn, e.titleFr]}
              value={hotspot.title}
              onChange={(l, v) =>
                edit(
                  e.labels.editHotspot,
                  (d) => ops.setHotspotTitle(d, hotspot.id, l, v),
                  `title:${hotspot.id}:${l}`,
                )
              }
            />
            <div className="evx-form-row">
              <label htmlFor="hotspot-appearance">{e.appearance}</label>
              <select
                id="hotspot-appearance"
                className="evx-field"
                value={appearanceKey(hotspot.appearance) ?? 'custom'}
                onChange={(ev) => {
                  const k = ev.target.value as AppearanceKey;
                  if (k in APPEARANCES)
                    edit(e.labels.editHotspot, (d) =>
                      ops.setHotspotAppearance(d, hotspot.id, structuredClone(APPEARANCES[k])),
                    );
                }}
              >
                {(Object.keys(APPEARANCES) as AppearanceKey[]).map((k) => (
                  <option key={k} value={k}>
                    {e.appearances[k]}
                  </option>
                ))}
                {!appearanceKey(hotspot.appearance) && (
                  <option value="custom" disabled>
                    {hotspot.appearance.kind}
                  </option>
                )}
              </select>
            </div>
            {hotspot.position.kind === 'spherical' && (
              <p className="text-sm">
                <span className="evx-dt">{e.direction}</span> {e.degrees(hotspot.position.yaw)} ·{' '}
                {e.degrees(hotspot.position.pitch)}
              </p>
            )}
            <ActionEditor
              t={t}
              lang={lang}
              env={env}
              sceneId={sceneId}
              actions={hotspot.actions}
              currentView={view}
              onChange={(actions, key) =>
                edit(
                  e.labels.editActions,
                  (d) => ops.setActions(d, hotspot.id, actions),
                  key && `${hotspot.id}:${key}`,
                )
              }
            />
            <button
              type="button"
              className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
              onClick={() => {
                edit(e.labels.removeHotspot, (d) => ops.removeHotspot(d, hotspot.id));
                setHotspotId(null);
              }}
            >
              {e.removeHotspot}
            </button>
          </div>
        ) : scene && sceneId ? (
          <div className="grid gap-4" data-testid="scene-inspector">
            <h2 className="evx-subheading">{name(scene.name)}</h2>
            <LocalizedInputs
              labels={[e.nameEn, e.nameFr]}
              value={scene.name}
              onChange={(l, v) =>
                edit(
                  e.labels.renameScene,
                  (d) => ops.renameScene(d, sceneId, l, v),
                  `rename:${sceneId}:${l}`,
                )
              }
            />
            <div className="flex flex-wrap gap-2">
              {env.initialSceneId === sceneId ? (
                <span className="evx-badge">{e.startScene}</span>
              ) : (
                <button
                  type="button"
                  className="evx-cta evx-cta--ghost evx-cta--small"
                  onClick={() => edit(e.labels.startScene, (d) => ops.setStartScene(d, sceneId))}
                >
                  {e.makeStart}
                </button>
              )}
              <button
                type="button"
                className="evx-icon-btn"
                aria-label={e.moveUp}
                disabled={sceneIndex <= 0}
                onClick={() =>
                  edit(e.labels.reorder, (d) => ops.moveScene(d, sceneId, sceneIndex - 1))
                }
              >
                ↑
              </button>
              <button
                type="button"
                className="evx-icon-btn"
                aria-label={e.moveDown}
                disabled={sceneIndex >= env.scenes.length - 1}
                onClick={() =>
                  edit(e.labels.reorder, (d) => ops.moveScene(d, sceneId, sceneIndex + 1))
                }
              >
                ↓
              </button>
            </div>

            <dl className="evx-details">
              <dt>{e.initialView}</dt>
              <dd data-testid="initial-view">
                {e.degrees(scene.initialView.yaw)} · {e.degrees(scene.initialView.pitch)}
              </dd>
              <dt>{e.north}</dt>
              <dd data-testid="north">{e.degrees(scene.northOffsetDeg)}</dd>
              {scene.captureDate && (
                <>
                  <dt>{e.capture}</dt>
                  <dd>
                    {scene.captureDate}
                    {scene.gps ? ` · ${scene.gps.lat.toFixed(5)}, ${scene.gps.lon.toFixed(5)}` : ''}
                  </dd>
                </>
              )}
            </dl>
            <div className="grid gap-2">
              <button
                type="button"
                className="evx-cta evx-cta--ghost evx-cta--small"
                disabled={testing}
                onClick={() => {
                  const v = view();
                  if (v) edit(e.labels.startView, (d) => ops.setInitialView(d, sceneId, v));
                }}
              >
                {e.setInitialView}
              </button>
              <button
                type="button"
                className="evx-cta evx-cta--ghost evx-cta--small"
                disabled={testing}
                onClick={() => {
                  const v = view();
                  if (v) edit(e.labels.north, (d) => ops.setNorth(d, sceneId, v.yaw));
                }}
              >
                {e.setNorth}
              </button>
              <p className="evx-hint">{e.northHint}</p>
            </div>

            <div className="evx-form-row">
              <label htmlFor="scene-floor">{e.floor}</label>
              <select
                id="scene-floor"
                className="evx-field"
                value={scene.floorId ?? ''}
                onChange={(ev) => {
                  const f = ev.target.value;
                  edit(e.labels.sceneFloor, (d) =>
                    f ? ops.placeScene(d, sceneId, f) : ops.unplaceScene(d, sceneId),
                  );
                }}
              >
                <option value="">{e.noFloor}</option>
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              {scene.floorId && !scene.planPosition && <p className="evx-hint">{e.placeOnPlan}</p>}
            </div>

            <section aria-labelledby="suggest-title" className="grid gap-2">
              <h3 id="suggest-title" className="evx-subheading">
                {e.suggestions}
              </h3>
              <p className="evx-hint">{e.suggestionsHint}</p>
              {suggestions.length === 0 ? (
                <p className="text-sm">{e.noSuggestions}</p>
              ) : (
                <ul className="grid gap-2" data-testid="suggestions">
                  {suggestions.map((s) => {
                    const target = env.scenes.find((x) => x.id === s.targetId)!;
                    return (
                      <li key={s.targetId} className="evx-suggestion" data-target={s.targetId}>
                        <span>
                          <strong>{name(target.name)}</strong>
                          <span className="evx-hint block">
                            {e.reason[s.reason]}
                            {s.distanceM !== undefined && ` · ${e.metres(s.distanceM)}`}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="evx-cta evx-cta--small"
                          disabled={testing}
                          onClick={() => accept(s)}
                        >
                          {e.addLink}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <div className="flex flex-wrap items-center gap-2">
              {confirmRemove ? (
                <>
                  <p className="text-sm">{e.removeSceneConfirm}</p>
                  <button
                    type="button"
                    className="evx-cta evx-cta--small"
                    onClick={() => {
                      edit(e.labels.removeScene, (d) => ops.removeScene(d, sceneId));
                      setConfirmRemove(false);
                    }}
                  >
                    {e.removeScene}
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
                  {e.removeScene}
                </button>
              )}
            </div>
          </div>
        ) : (
          <p className="evx-hint">{e.selectScene}</p>
        )}
      </aside>
    </div>
  );
}
