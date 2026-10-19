/**
 * What a hotspot does when clicked: an ordered list of actions: navigation and
 * information (Phase 4), media and live layers (Phase 6), evacuation routes (Phase 5).
 * Training actions arrive with their editors in Phase 8 (existing ones are kept and
 * listed read-only).
 */
import type { Action, Environment } from '@evactis-3dworkflow/schema';
import { useId } from 'react';
import type { Strings } from '../i18n.ts';
import { goTo } from './ops.ts';

const EDITABLE = [
  'goToScene',
  'openPopup',
  'lookAt',
  'showFloorPlan',
  'showRoute',
  'openDocument',
  'openAlbum',
  'playAudio',
  'stopAudio',
  'setLiveLayer',
  'openUrl',
] as const;
type EditableType = (typeof EDITABLE)[number];

const isEditable = (a: Action): a is Extract<Action, { type: EditableType }> =>
  (EDITABLE as readonly string[]).includes(a.type);

/** Action types that need something to point at (a sound, document, album, layer). */
export function available(type: EditableType, env: Environment): boolean {
  switch (type) {
    case 'playAudio':
    case 'stopAudio':
      return env.audio.length > 0;
    case 'openDocument':
      return env.documents.length > 0;
    case 'openAlbum':
      return env.albums.length > 0;
    case 'setLiveLayer':
      return env.liveLayers.length > 0;
    default:
      return true;
  }
}

export function newAction(type: EditableType, env: Environment, currentScene: string): Action {
  switch (type) {
    case 'goToScene':
      return goTo(env.scenes.find((s) => s.id !== currentScene)?.id ?? currentScene);
    case 'openPopup':
      return { type, content: { kind: 'text', body: { en: '', fr: '' } } };
    case 'lookAt':
      return { type, view: { yaw: 0, pitch: 0 } };
    case 'showFloorPlan':
      return { type };
    case 'openUrl':
      return { type, url: 'documents/' };
    case 'showRoute':
      return { type };
    case 'openDocument':
      return { type, documentId: env.documents[0]!.id };
    case 'openAlbum':
      return { type, albumId: env.albums[0]!.id, start: 0 };
    case 'playAudio':
      return { type, audioId: env.audio[0]!.id, restart: true };
    case 'stopAudio':
      return { type, audioId: env.audio[0]!.id };
    case 'setLiveLayer': {
      const l = env.liveLayers[0]!;
      return { type, layerId: l.id, stateId: l.states[1]?.id ?? l.defaultStateId };
    }
  }
}

function Text({
  label,
  value,
  onChange,
  multiline,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="evx-form-row">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          id={id}
          className="evx-field"
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className="evx-field"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && <p className="evx-hint">{hint}</p>}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="evx-form-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="evx-field"
        type="number"
        step="0.1"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n))
            onChange(Math.max(min, Math.min(max, n)));
        }}
      />
    </div>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="evx-form-row">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="evx-field"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ActionEditor({
  t,
  lang,
  env,
  sceneId,
  actions,
  onChange,
  currentView,
}: {
  t: Strings;
  lang: string;
  env: Environment;
  /** The scene the hotspot is in. */
  sceneId: string;
  actions: Action[];
  /** `key` groups typing into one undo step. */
  onChange: (actions: Action[], key?: string) => void;
  currentView: () => { yaw: number; pitch: number } | null;
}) {
  const e = t.editor;
  const name = (n: Record<string, string>) => n[lang] || n.en || Object.values(n)[0] || '';
  const floors = env.buildings.flatMap((b) => b.floors);
  const set = (i: number, a: Action, key?: string) =>
    onChange(
      actions.map((x, j) => (j === i ? a : x)),
      key && `action:${i}:${key}`,
    );
  const move = (i: number, d: -1 | 1) => {
    const next = [...actions];
    const [a] = next.splice(i, 1);
    next.splice(i + d, 0, a!);
    onChange(next);
  };

  return (
    <section aria-labelledby="actions-title" className="grid gap-3">
      <h3 id="actions-title" className="evx-subheading">
        {e.actions}
      </h3>
      {actions.length === 0 && <p className="evx-hint">{e.noActions}</p>}
      <ol className="grid gap-3">
        {actions.map((a, i) => (
          <li key={i} className="evx-action" data-action-type={a.type}>
            <div className="flex items-center justify-between gap-2">
              <strong>{isEditable(a) ? e.actionTypes[a.type] : a.type}</strong>
              <span className="flex gap-1">
                <button
                  type="button"
                  className="evx-icon-btn"
                  aria-label={`${e.moveUp}: ${i + 1}`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="evx-icon-btn"
                  aria-label={`${e.moveDown}: ${i + 1}`}
                  disabled={i === actions.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="evx-icon-btn"
                  aria-label={`${e.removeAction}: ${i + 1}`}
                  onClick={() => onChange(actions.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </span>
            </div>
            {a.type === 'goToScene' && (
              <>
                <Select
                  label={e.scene}
                  value={a.sceneId}
                  options={env.scenes.map((s) => [s.id, name(s.name)])}
                  onChange={(v) => set(i, { ...a, sceneId: v })}
                />
                <Select
                  label={e.transition}
                  value={a.transition.kind}
                  options={(['fade', 'walk', 'zoom', 'cut'] as const).map((k) => [
                    k,
                    e.transitions[k],
                  ])}
                  onChange={(v) => set(i, { ...a, transition: { ...a.transition, kind: v } })}
                />
              </>
            )}
            {a.type === 'openPopup' && a.content.kind === 'text' && (
              <>
                {(['en', 'fr'] as const).map((l) => (
                  <Text
                    key={`t-${l}`}
                    label={l === 'en' ? e.popupTitleEn : e.popupTitleFr}
                    value={a.title?.[l] ?? ''}
                    onChange={(v) =>
                      set(i, { ...a, title: { ...(a.title ?? {}), [l]: v } }, `title-${l}`)
                    }
                  />
                ))}
                {(['en', 'fr'] as const).map((l) => (
                  <Text
                    key={`b-${l}`}
                    multiline
                    label={l === 'en' ? e.bodyEn : e.bodyFr}
                    value={a.content.kind === 'text' ? (a.content.body[l] ?? '') : ''}
                    onChange={(v) =>
                      a.content.kind === 'text' &&
                      set(
                        i,
                        { ...a, content: { ...a.content, body: { ...a.content.body, [l]: v } } },
                        `body-${l}`,
                      )
                    }
                  />
                ))}
              </>
            )}
            {a.type === 'lookAt' && (
              <>
                <NumberField
                  label={e.yaw}
                  value={a.view.yaw}
                  min={-180}
                  max={180}
                  onChange={(v) => set(i, { ...a, view: { ...a.view, yaw: v } }, 'yaw')}
                />
                <NumberField
                  label={e.pitch}
                  value={a.view.pitch}
                  min={-90}
                  max={90}
                  onChange={(v) => set(i, { ...a, view: { ...a.view, pitch: v } }, 'pitch')}
                />
                <button
                  type="button"
                  className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
                  onClick={() => {
                    const v = currentView();
                    if (v)
                      set(i, {
                        ...a,
                        view: {
                          yaw: Math.round(v.yaw * 10) / 10,
                          pitch: Math.round(v.pitch * 10) / 10,
                        },
                      });
                  }}
                >
                  {e.useCurrentView}
                </button>
              </>
            )}
            {a.type === 'showFloorPlan' && (
              <Select
                label={e.whichFloor}
                value={a.floorId ?? ''}
                options={[
                  ['', e.anyFloor],
                  ...floors.map((f): [string, string] => [f.id, name(f.name)]),
                ]}
                onChange={(v) => {
                  const { floorId: _old, ...rest } = a;
                  void _old;
                  set(i, v ? { ...rest, floorId: v } : rest);
                }}
              />
            )}
            {a.type === 'showRoute' && (
              <Select
                label={e.route}
                value={a.routeId ?? ''}
                options={[
                  ['', e.nearestRoute],
                  ...env.routes.map((r): [string, string] => [r.id, name(r.name)]),
                ]}
                onChange={(v) => {
                  const { routeId: _old, ...rest } = a;
                  void _old;
                  set(i, v ? { ...rest, routeId: v } : rest);
                }}
              />
            )}
            {a.type === 'openDocument' && (
              <Select
                label={e.document}
                value={a.documentId}
                options={env.documents.map((d) => [d.id, name(d.title)])}
                onChange={(v) => set(i, { ...a, documentId: v })}
              />
            )}
            {a.type === 'openAlbum' && (
              <>
                <Select
                  label={e.album}
                  value={a.albumId}
                  options={env.albums.map((al) => [al.id, name(al.name)])}
                  onChange={(v) => set(i, { ...a, albumId: v, start: 0 })}
                />
                <NumberField
                  label={e.startPhoto}
                  value={a.start + 1}
                  min={1}
                  max={env.albums.find((al) => al.id === a.albumId)?.items.length ?? 1}
                  onChange={(v) => set(i, { ...a, start: Math.round(v) - 1 }, 'start')}
                />
              </>
            )}
            {(a.type === 'playAudio' || a.type === 'stopAudio') && (
              <Select
                label={e.sound}
                value={a.audioId}
                options={env.audio.map((x) => [x.id, name(x.name)])}
                onChange={(v) => set(i, { ...a, audioId: v })}
              />
            )}
            {a.type === 'setLiveLayer' && (
              <>
                <Select
                  label={e.layer}
                  value={a.layerId}
                  options={env.liveLayers.map((l) => [l.id, name(l.name)])}
                  onChange={(v) => {
                    const l = env.liveLayers.find((x) => x.id === v)!;
                    set(i, { ...a, layerId: v, stateId: l.defaultStateId });
                  }}
                />
                <Select
                  label={e.layerState}
                  value={a.stateId}
                  options={(env.liveLayers.find((l) => l.id === a.layerId)?.states ?? []).map(
                    (st) => [st.id, name(st.name)],
                  )}
                  onChange={(v) => set(i, { ...a, stateId: v })}
                />
              </>
            )}
            {a.type === 'openUrl' && (
              <Text
                label={e.filePath}
                hint={e.filePathHint}
                value={a.url}
                onChange={(v) => set(i, { ...a, url: v || 'documents/' }, 'url')}
              />
            )}
          </li>
        ))}
      </ol>
      <select
        className="evx-field"
        aria-label={e.addAction}
        value=""
        onChange={(ev) => {
          const type = ev.target.value as EditableType;
          if (type) onChange([...actions, newAction(type, env, sceneId)]);
        }}
      >
        <option value="">{e.addAction}</option>
        {EDITABLE.map((type) => (
          <option key={type} value={type} disabled={!available(type, env)}>
            {e.actionTypes[type]}
          </option>
        ))}
      </select>
    </section>
  );
}
