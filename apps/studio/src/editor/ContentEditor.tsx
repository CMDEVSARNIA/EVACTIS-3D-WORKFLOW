/**
 * Content tab (Phase 6): sounds (spatial ones placed by clicking the preview), PDF
 * documents, photo albums, live layers (e.g. smoke conditions, previewed live) and
 * animated regions drawn on the panorama. Hotspot actions that use them are set in the
 * Tour tab's action editor; timed hotspots in the Tour tab's hotspot inspector.
 */
import {
  localize,
  type Environment,
  type LocalizedText,
  type Spherical,
} from '@evactis-3dworkflow/schema';
import type { Viewer } from '@evactis-3dworkflow/viewer';
import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import {
  api,
  type AssetRecord,
  type ImportEvent,
  type ImportPurpose,
  type ProjectInfo,
} from '../api.ts';
import { describeError } from '../format.ts';
import type { Lang, Strings } from '../i18n.ts';
import * as cx from './contentOps.ts';
import { CONTENT } from './contentStrings.ts';
import { Preview } from './Preview.tsx';
import type { DocumentState, DocumentStore } from './store.ts';
import { refusal } from './useDocument.ts';

type Section = 'sounds' | 'documents' | 'albums' | 'layers' | 'regions';
type Pick = { section: Section; id: string } | null;

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

function Bilingual({
  labels,
  value,
  onChange,
}: {
  labels: [string, string];
  value: LocalizedText | undefined;
  onChange: (v: LocalizedText, lang: 'en' | 'fr') => void;
}) {
  return (
    <>
      {(['en', 'fr'] as const).map((l, i) => (
        <Field key={l} label={labels[i]!}>
          {(id) => (
            <input
              id={id}
              lang={l}
              className="evx-field"
              value={value?.[l] ?? ''}
              onChange={(e) => onChange({ ...(value ?? {}), [l]: e.target.value }, l)}
            />
          )}
        </Field>
      ))}
    </>
  );
}

export function ContentEditor({
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
  const c = t.content;
  const env = doc.env;
  const name = (x: Record<string, string> | undefined) => (x ? localize(x, lang) : '');
  const [section, setSection] = useState<Section>('sounds');
  const [picked, setPicked] = useState<Pick>(null);
  const [sceneId, setSceneId] = useState<string | null>(
    env.initialSceneId ?? env.scenes[0]?.id ?? null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [drawing, setDrawing] = useState<Spherical[] | null>(null);
  const [regionSource, setRegionSource] = useState('media/clips/');
  const [layerState, setLayerState] = useState<string | null>(null);
  const [newLayerKind, setNewLayerKind] = useState<
    'smoke' | 'day-night' | 'before-after' | 'custom'
  >('smoke');
  const viewer = useRef<Viewer | null>(null);
  const resolveAsset = useCallback((p: string) => api.fileUrl(project.root, p), [project.root]);

  const sel = picked?.section === section ? picked.id : null;
  const sound = section === 'sounds' ? env.audio.find((a) => a.id === sel) : undefined;
  const document_ = section === 'documents' ? env.documents.find((d) => d.id === sel) : undefined;
  const album = section === 'albums' ? env.albums.find((a) => a.id === sel) : undefined;
  const layer = section === 'layers' ? env.liveLayers.find((l) => l.id === sel) : undefined;
  const region = section === 'regions' ? env.animatedRegions.find((r) => r.id === sel) : undefined;
  const scene = env.scenes.find((s) => s.id === sceneId);
  const photos = assets.filter((a) => a.kind === 'photo');

  function edit<T>(label: string, fn: (d: Environment) => T, key?: string): T | undefined {
    try {
      setProblem(null);
      return store.edit(label, fn, key);
    } catch (err) {
      setProblem(t.editor.inUse + refusal(err));
      return undefined;
    }
  }

  /** Imports files for a purpose; calls `done` with the assets that came in. */
  async function importFiles(
    purpose: ImportPurpose,
    title: string,
    filter: string,
    done: (imported: AssetRecord[]) => void,
  ) {
    const paths = await api.pickMedia(title, filter, purpose);
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
        if (imported.length) done(imported);
      }
    };
    try {
      await api.importMedia(paths, onEvent, purpose);
    } catch (err) {
      setBusy(false);
      setProblem(describeError(t, err));
    }
  }

  const select = (s: Section, id: string | undefined) => id && setPicked({ section: s, id });

  // ---------------------------------------------------------------- list column
  const listItems: { id: string; label: string }[] =
    section === 'sounds'
      ? env.audio.map((a) => ({ id: a.id, label: `${name(a.name)} · ${c.kinds[a.kind]}` }))
      : section === 'documents'
        ? env.documents.map((d) => ({ id: d.id, label: name(d.title) }))
        : section === 'albums'
          ? env.albums.map((a) => ({ id: a.id, label: `${name(a.name)} · ${a.items.length}` }))
          : section === 'layers'
            ? env.liveLayers.map((l) => ({ id: l.id, label: name(l.name) }))
            : env.animatedRegions.map((r) => ({
                id: r.id,
                label: `${name(env.scenes.find((s) => s.id === r.sceneId)?.name)} · ${c.corners(r.polygon.length)}`,
              }));
  const empty = {
    sounds: c.noSounds,
    documents: c.noDocuments,
    albums: c.noAlbums,
    layers: c.noLayers,
    regions: c.noRegions,
  }[section];

  const add = (
    <div className="grid gap-2">
      {section === 'sounds' && (
        <button
          type="button"
          className="evx-cta evx-cta--small justify-self-start"
          disabled={busy}
          onClick={() =>
            void importFiles('audio', c.importSoundTitle, c.soundFilter, (got) => {
              let last: string | undefined;
              edit(c.labels.addSound, (d) => {
                for (const a of got) last = cx.addSound(d, a, sceneId ?? undefined);
              });
              select('sounds', last);
            })
          }
        >
          {busy ? c.importing : c.importSound}
        </button>
      )}
      {section === 'documents' && (
        <button
          type="button"
          className="evx-cta evx-cta--small justify-self-start"
          disabled={busy}
          onClick={() =>
            void importFiles('document', c.importDocumentTitle, c.documentFilter, (got) => {
              let last: string | undefined;
              edit(c.labels.addDocument, (d) => {
                for (const a of got) last = cx.addDocument(d, a);
              });
              select('documents', last);
            })
          }
        >
          {busy ? c.importing : c.importDocument}
        </button>
      )}
      {section === 'albums' && (
        <button
          type="button"
          className="evx-cta evx-cta--small justify-self-start"
          disabled={busy}
          onClick={() =>
            void importFiles('photo', c.importPhotoTitle, c.photoFilter, (got) =>
              select(
                'albums',
                edit(c.labels.addAlbum, (d) =>
                  cx.addAlbum(d, { en: CONTENT.en.newAlbumName, fr: CONTENT.fr.newAlbumName }, got),
                ),
              ),
            )
          }
        >
          {busy ? c.importing : c.newAlbum}
        </button>
      )}
      {section === 'layers' && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={c.layerKind}>
            {(id) => (
              <select
                id={id}
                className="evx-field evx-field--small"
                value={newLayerKind}
                onChange={(e) => setNewLayerKind(e.target.value as typeof newLayerKind)}
              >
                {Object.entries(c.layerKinds).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button
            type="button"
            className="evx-cta evx-cta--small"
            onClick={() =>
              select(
                'layers',
                edit(c.labels.addLayer, (d) =>
                  cx.addLiveLayer(d, newLayerKind, {
                    en: CONTENT.en.layerKinds[newLayerKind],
                    fr: CONTENT.fr.layerKinds[newLayerKind],
                  }),
                ),
              )
            }
          >
            {c.newLayer}
          </button>
        </div>
      )}
      {section === 'regions' && !drawing && (
        <button
          type="button"
          className="evx-cta evx-cta--small justify-self-start"
          disabled={!scene}
          onClick={() => {
            setDrawing([]);
            setPicked(null);
          }}
        >
          {c.newRegion}
        </button>
      )}
    </div>
  );

  const list = (
    <aside className="evx-editor__scenes evx-panel" aria-label={c.sections[section]}>
      <div className="grid gap-3">
        <h2 className="evx-subheading">{c.sections[section]}</h2>
        {add}
        {listItems.length === 0 && <p className="evx-hint">{empty}</p>}
        <ul className="evx-scene-list" data-testid={`content-list-${section}`}>
          {listItems.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                className="evx-row"
                aria-current={sel === x.id ? 'true' : undefined}
                data-item-id={x.id}
                onClick={() => {
                  select(section, x.id);
                  const r = env.animatedRegions.find((y) => y.id === x.id);
                  if (section === 'regions' && r) setSceneId(r.sceneId);
                  const a = env.audio.find((y) => y.id === x.id);
                  if (section === 'sounds' && a?.sceneIds[0]) setSceneId(a.sceneIds[0]);
                }}
              >
                <span className="evx-row__name">{x.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );

  // ---------------------------------------------------------------- preview column
  const previewLayer = layer && layerState ? { layerId: layer.id, stateId: layerState } : null;
  const middle = (
    <section className="evx-editor__stage" aria-label={c.sections[section]}>
      <div className="evx-toolbar">
        <label className="flex items-center gap-2 text-sm">
          <span>{c.scene}</span>
          <select
            className="evx-field evx-field--small"
            value={sceneId ?? ''}
            disabled={!!drawing}
            onChange={(e) => setSceneId(e.target.value)}
          >
            {env.scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {name(s.name)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {placing && <p className="evx-hint">{c.placeSound}</p>}
      {drawing && (
        <div className="evx-toolbar" role="group" aria-label={c.newRegion}>
          <p className="evx-hint w-full" data-testid="region-hint">
            {c.drawHint(drawing.length)}
          </p>
          <Field label={c.source} hint={c.sourceHint}>
            {(id) => (
              <input
                id={id}
                className="evx-field"
                value={regionSource}
                onChange={(e) => setRegionSource(e.target.value)}
              />
            )}
          </Field>
          <button
            type="button"
            className="evx-cta evx-cta--small"
            disabled={drawing.length < 3 || !sceneId}
            onClick={() => {
              const id = edit(c.labels.addRegion, (d) =>
                cx.addRegion(d, sceneId!, drawing, regionSource),
              );
              if (id) {
                setDrawing(null);
                select('regions', id);
              }
            }}
          >
            {c.finish}
          </button>
          <button
            type="button"
            className="evx-cta evx-cta--ghost evx-cta--small"
            onClick={() => setDrawing(null)}
          >
            {c.cancel}
          </button>
        </div>
      )}
      {scene && sceneId && (
        <Preview
          env={env}
          sceneId={sceneId}
          editing
          selectedHotspot={null}
          lang={lang}
          resolveAsset={resolveAsset}
          viewerRef={(v) => (viewer.current = v)}
          failedText={t.editor.previewFailed}
          liveLayer={previewLayer}
          onPanoramaClick={(at) => {
            if (drawing) setDrawing([...drawing, at]);
            else if (placing && sound) {
              edit(c.labels.editSound, (d) => cx.placeSound(d, sound.id, at));
              setPlacing(false);
            }
          }}
          onSceneChange={() => undefined}
        />
      )}
    </section>
  );

  // ---------------------------------------------------------------- inspector
  let inspector: ReactNode = <p className="evx-hint">{c.pickHint}</p>;
  const removeButton = (label: string, fn: (d: Environment) => void) => (
    <button
      type="button"
      className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
      onClick={() => {
        if (edit(label, (d) => (fn(d), true))) setPicked(null);
      }}
    >
      {c.remove}
    </button>
  );
  const audiences = (value: string[], onChange: (v: string[]) => void) => (
    <fieldset className="grid gap-1">
      <legend className="evx-form-row mb-1 font-semibold">{c.audiences}</legend>
      {env.audiences.map((a) => (
        <label key={a.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.includes(a.id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, a.id] : value.filter((x) => x !== a.id))
            }
          />
          {name(a.name)}
        </label>
      ))}
      <p className="evx-hint">{c.audiencesHint}</p>
    </fieldset>
  );

  if (sound) {
    const up = (patch: Parameters<typeof cx.updateSound>[2], key?: string) =>
      edit(c.labels.editSound, (d) => cx.updateSound(d, sound.id, patch), key);
    inspector = (
      <div className="grid gap-4" data-testid="sound-inspector">
        <h2 className="evx-subheading">{name(sound.name)}</h2>
        <Bilingual
          labels={[c.nameEn, c.nameFr]}
          value={sound.name}
          onChange={(v, l) => up({ name: v }, `sname:${sound.id}:${l}`)}
        />
        <Field label={c.kind}>
          {(id) => (
            <select
              id={id}
              className="evx-field"
              value={sound.kind}
              onChange={(e) => up({ kind: e.target.value as typeof sound.kind })}
            >
              {Object.entries(c.kinds).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          )}
        </Field>
        <fieldset className="grid gap-1">
          <legend className="evx-form-row mb-1 font-semibold">{c.plays}</legend>
          {env.scenes.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sound.sceneIds.includes(s.id)}
                onChange={(e) =>
                  up({
                    sceneIds: e.target.checked
                      ? [...sound.sceneIds, s.id]
                      : sound.sceneIds.filter((x) => x !== s.id),
                  })
                }
              />
              {name(s.name)}
            </label>
          ))}
          {sound.kind === 'background' && <p className="evx-hint">{c.allScenes}</p>}
        </fieldset>
        {sound.kind === 'spatial' && (
          <div className="grid gap-2">
            <p className="text-sm" data-testid="sound-position">
              {c.position}:{' '}
              {sound.position
                ? `${sound.position.yaw.toFixed(0)}°, ${sound.position.pitch.toFixed(0)}°`
                : c.positionUnset}
            </p>
            <button
              type="button"
              className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
              aria-pressed={placing}
              onClick={() => setPlacing(!placing)}
            >
              {placing ? c.placing : c.placeSound}
            </button>
          </div>
        )}
        <Field label={c.volume}>
          {(id) => (
            <input
              id={id}
              type="range"
              min={0}
              max={100}
              value={Math.round(sound.volume * 100)}
              onChange={(e) => up({ volume: Number(e.target.value) / 100 }, `svol:${sound.id}`)}
            />
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sound.loop}
            onChange={(e) => up({ loop: e.target.checked })}
          />
          {c.loop}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sound.autoplay}
            onChange={(e) => up({ autoplay: e.target.checked })}
          />
          {c.autoplay}
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="evx-cta evx-cta--small"
            onClick={() =>
              void viewer.current?.runActions([
                { type: 'playAudio', audioId: sound.id, restart: true },
              ])
            }
          >
            {c.preview}
          </button>
          <button
            type="button"
            className="evx-cta evx-cta--ghost evx-cta--small"
            onClick={() =>
              void viewer.current?.runActions([{ type: 'stopAudio', audioId: sound.id }])
            }
          >
            {c.stopPreview}
          </button>
        </div>
        {removeButton(c.labels.removeSound, (d) => cx.removeSound(d, sound.id))}
      </div>
    );
  }
  if (document_) {
    inspector = (
      <div className="grid gap-4" data-testid="document-inspector">
        <h2 className="evx-subheading">{name(document_.title)}</h2>
        <Bilingual
          labels={[c.titleEn, c.titleFr]}
          value={document_.title}
          onChange={(v, l) =>
            edit(
              c.labels.editDocument,
              (d) => cx.updateDocument(d, document_.id, { title: v }),
              `dtitle:${document_.id}:${l}`,
            )
          }
        />
        {audiences(document_.audienceIds, (v) =>
          edit(c.labels.editDocument, (d) =>
            cx.updateDocument(d, document_.id, { audienceIds: v }),
          ),
        )}
        <button
          type="button"
          className="evx-cta evx-cta--small justify-self-start"
          onClick={() =>
            void viewer.current?.runActions([{ type: 'openDocument', documentId: document_.id }])
          }
        >
          {c.preview}
        </button>
        {removeButton(c.labels.removeDocument, (d) => cx.removeDocument(d, document_.id))}
      </div>
    );
  }
  if (album) {
    inspector = (
      <div className="grid gap-4" data-testid="album-inspector">
        <h2 className="evx-subheading">{name(album.name)}</h2>
        <Bilingual
          labels={[c.nameEn, c.nameFr]}
          value={album.name}
          onChange={(v, l) =>
            edit(
              c.labels.editAlbum,
              (d) => cx.renameAlbum(d, album.id, v),
              `aname:${album.id}:${l}`,
            )
          }
        />
        <h3 className="evx-subheading">{c.photos}</h3>
        <ol className="grid gap-3" data-testid="album-photos">
          {album.items.map((item, i) => (
            <li key={`${item.source}-${i}`} className="evx-action grid gap-2">
              <img
                src={api.fileUrl(project.root, item.source)}
                alt=""
                className="evx-content-thumb"
              />
              <Bilingual
                labels={[c.captionEn, c.captionFr]}
                value={item.caption}
                onChange={(v, l) =>
                  edit(
                    c.labels.editAlbum,
                    (d) => cx.setCaption(d, album.id, i, v),
                    `cap:${album.id}:${i}:${l}`,
                  )
                }
              />
              <span className="flex gap-1">
                <button
                  type="button"
                  className="evx-icon-btn"
                  aria-label={`${c.moveUp}: ${i + 1}`}
                  disabled={i === 0}
                  onClick={() =>
                    edit(c.labels.editAlbum, (d) => cx.movePhoto(d, album.id, i, i - 1))
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="evx-icon-btn"
                  aria-label={`${c.moveDown}: ${i + 1}`}
                  disabled={i === album.items.length - 1}
                  onClick={() =>
                    edit(c.labels.editAlbum, (d) => cx.movePhoto(d, album.id, i, i + 1))
                  }
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="evx-icon-btn"
                  aria-label={`${c.removePhoto}: ${i + 1}`}
                  disabled={album.items.length === 1}
                  onClick={() => edit(c.labels.editAlbum, (d) => cx.removePhoto(d, album.id, i))}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ol>
        {photos.length > 0 && (
          <select
            className="evx-field"
            aria-label={c.fromLibrary}
            value=""
            onChange={(e) => {
              const a = photos.find((p) => p.id === e.target.value);
              if (a) edit(c.labels.editAlbum, (d) => cx.addPhotos(d, album.id, [a]));
            }}
          >
            <option value="">{c.fromLibrary}</option>
            {photos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
          disabled={busy}
          onClick={() =>
            void importFiles('photo', c.importPhotoTitle, c.photoFilter, (got) =>
              edit(c.labels.editAlbum, (d) => cx.addPhotos(d, album.id, got)),
            )
          }
        >
          {busy ? c.importing : c.addPhotos}
        </button>
        <button
          type="button"
          className="evx-cta evx-cta--small justify-self-start"
          onClick={() =>
            void viewer.current?.runActions([{ type: 'openAlbum', albumId: album.id, start: 0 }])
          }
        >
          {c.preview}
        </button>
        {removeButton(c.labels.removeAlbum, (d) => cx.removeAlbum(d, album.id))}
      </div>
    );
  }
  if (layer) {
    const state =
      layerState && layer.states.some((s) => s.id === layerState)
        ? layerState
        : (layer.states[1]?.id ?? layer.defaultStateId);
    const look = sceneId
      ? layer.overrides.find((o) => o.sceneId === sceneId && o.stateId === state)?.lighting
      : undefined;
    const setLook = (l: cx.Lighting | null, key?: string) =>
      sceneId &&
      edit(c.labels.editLayer, (d) => cx.setSceneLook(d, layer.id, state, sceneId, l), key);
    inspector = (
      <div className="grid gap-4" data-testid="layer-inspector">
        <h2 className="evx-subheading">{name(layer.name)}</h2>
        <Bilingual
          labels={[c.nameEn, c.nameFr]}
          value={layer.name}
          onChange={(v, l) =>
            edit(
              c.labels.editLayer,
              (d) => cx.renameLiveLayer(d, layer.id, v),
              `lname:${layer.id}:${l}`,
            )
          }
        />
        <h3 className="evx-subheading">{c.states}</h3>
        {layer.states.map((st) => (
          <Bilingual
            key={st.id}
            labels={[`${c.states} · ${st.id} (EN)`, `${c.states} · ${st.id} (FR)`]}
            value={st.name}
            onChange={(v, l) =>
              edit(
                c.labels.editLayer,
                (d) => cx.renameState(d, layer.id, st.id, v),
                `lstate:${layer.id}:${st.id}:${l}`,
              )
            }
          />
        ))}
        <Field label={c.editState}>
          {(id) => (
            <select
              id={id}
              className="evx-field"
              value={state}
              onChange={(e) => setLayerState(e.target.value)}
            >
              {layer.states.map((st) => (
                <option key={st.id} value={st.id}>
                  {name(st.name)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={layerState === state}
            onChange={(e) => setLayerState(e.target.checked ? state : null)}
          />
          {c.previewState}
        </label>
        <section className="evx-action grid gap-2" aria-label={c.look} data-testid="scene-look">
          <h3 className="evx-subheading">
            {c.look}: {name(scene?.name)}
          </h3>
          {look ? (
            <>
              <Field label={c.exposure}>
                {(id) => (
                  <input
                    id={id}
                    className="evx-field"
                    type="number"
                    step="0.1"
                    min={-4}
                    max={4}
                    value={look.exposure}
                    onChange={(e) =>
                      e.target.value !== '' &&
                      setLook(
                        { ...look, exposure: Number(e.target.value) },
                        `lexp:${layer.id}:${sceneId}`,
                      )
                    }
                  />
                )}
              </Field>
              <Field label={c.visibility}>
                {(id) => (
                  <input
                    id={id}
                    className="evx-field"
                    type="number"
                    step="0.5"
                    min={0.5}
                    value={look.visibilityM ?? ''}
                    onChange={(e) => {
                      const { visibilityM: _v, ...rest } = look;
                      void _v;
                      setLook(
                        e.target.value === ''
                          ? rest
                          : { ...rest, visibilityM: Number(e.target.value) },
                        `lvis:${layer.id}:${sceneId}`,
                      );
                    }}
                  />
                )}
              </Field>
              <Field label={c.hazeColour}>
                {(id) => (
                  <input
                    id={id}
                    type="color"
                    value={look.fogColor ?? '#6f6c66'}
                    onChange={(e) =>
                      setLook({ ...look, fogColor: e.target.value }, `lfog:${layer.id}:${sceneId}`)
                    }
                  />
                )}
              </Field>
              <button
                type="button"
                className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
                onClick={() => setLook(null)}
              >
                {c.clearLook}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm">{c.asCaptured}</p>
              <button
                type="button"
                className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
                onClick={() => setLook({ exposure: 0 })}
              >
                {c.setLook}
              </button>
            </>
          )}
        </section>
        {removeButton(c.labels.removeLayer, (d) => cx.removeLiveLayer(d, layer.id))}
      </div>
    );
  }
  if (region) {
    inspector = (
      <div className="grid gap-4" data-testid="region-inspector">
        <h2 className="evx-subheading">
          {name(env.scenes.find((s) => s.id === region.sceneId)?.name)}
        </h2>
        <p className="text-sm">{c.corners(region.polygon.length)}</p>
        <Field label={c.source} hint={c.sourceHint}>
          {(id) => (
            <input
              id={id}
              className="evx-field"
              value={region.source}
              onChange={(e) =>
                edit(
                  c.labels.editRegion,
                  (d) => cx.updateRegion(d, region.id, { source: e.target.value }),
                  `rsrc:${region.id}`,
                )
              }
            />
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={region.loop}
            onChange={(e) =>
              edit(c.labels.editRegion, (d) =>
                cx.updateRegion(d, region.id, { loop: e.target.checked }),
              )
            }
          />
          {c.loop}
        </label>
        {removeButton(c.labels.removeRegion, (d) => cx.removeRegion(d, region.id))}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="evx-toolbar px-6 pt-4">
        <div className="evx-segmented" role="radiogroup" aria-label={c.sectionsLabel}>
          {(['sounds', 'documents', 'albums', 'layers', 'regions'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={section === s}
              onClick={() => {
                setSection(s);
                setPlacing(false);
                setDrawing(null);
                setLayerState(null);
              }}
            >
              {c.sections[s]}
            </button>
          ))}
        </div>
      </div>
      <div className="evx-editor">
        {list}
        {middle}
        <aside className="evx-editor__inspector evx-panel" aria-label={c.sections[section]}>
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
