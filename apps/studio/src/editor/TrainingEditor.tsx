/**
 * Training tab (Phase 8): modules for each audience, their steps — go somewhere, find an
 * item, find the nearest exit, hazard hunts placed in the preview, questions — and the
 * checklist learners confirm. "Test the module" runs it in the real Viewer; "Export
 * SCORM package…" packs the environment for the client's own LMS.
 */
import {
  localize,
  type Environment,
  type LocalizedText,
  type ModuleStep,
  type Spherical,
} from '@evactis-3dworkflow/schema';
import type { ScormVersion } from '@evactis-3dworkflow/packaging';
import type { Viewer } from '@evactis-3dworkflow/viewer';
import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type ProjectInfo } from '../api.ts';
import { describeError } from '../format.ts';
import type { Lang, Strings } from '../i18n.ts';
import { Preview } from './Preview.tsx';
import { buildScorm } from './scormExport.ts';
import type { DocumentState, DocumentStore } from './store.ts';
import * as tr from './trainingOps.ts';
import { refusal } from './useDocument.ts';

type Section = 'module' | 'steps' | 'checklist';
const HAZARD_PREFIX = 'preview-hazard-';

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

/** English and French inputs for one text; empty values allowed while typing. */
function Bilingual({
  labels,
  value,
  onChange,
  multiline,
  hint,
}: {
  labels: [string, string];
  value: LocalizedText | undefined;
  onChange: (v: LocalizedText) => void;
  multiline?: boolean;
  hint?: string;
}) {
  return (
    <>
      {(['en', 'fr'] as const).map((l, i) => (
        <Field key={l} label={labels[i]!} hint={i === 1 ? hint : undefined}>
          {(id) =>
            multiline ? (
              <textarea
                id={id}
                lang={l}
                rows={2}
                className="evx-field"
                value={value?.[l] ?? ''}
                onChange={(e) => onChange({ ...(value ?? {}), [l]: e.target.value })}
              />
            ) : (
              <input
                id={id}
                lang={l}
                className="evx-field"
                value={value?.[l] ?? ''}
                onChange={(e) => onChange({ ...(value ?? {}), [l]: e.target.value })}
              />
            )
          }
        </Field>
      ))}
    </>
  );
}

/** The document plus the selected hunt's hazards as labels the author can drag. */
function withHazards(env: Environment, s: ModuleStep | undefined, lang: string): Environment {
  if (s?.kind !== 'hazard-hunt') return env;
  return {
    ...env,
    hotspots: [
      ...env.hotspots,
      ...s.hazards.map((h) => ({
        id: `${HAZARD_PREFIX}${h.id}`,
        sceneId: h.sceneId,
        title: h.label,
        position: { kind: 'spherical' as const, ...h.position },
        appearance: { kind: 'label' as const, text: { [lang]: `⚠ ${localize(h.label, lang)}` } },
        actions: [],
        audienceIds: [],
        hidden: false,
      })),
    ],
  };
}

export function TrainingEditor({
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
  const k = t.training;
  const env = doc.env;
  const L = (x: LocalizedText | undefined) => (x ? localize(x, lang) : '');
  const [moduleId, setModuleId] = useState<string | null>(env.modules[0]?.id ?? null);
  const [section, setSection] = useState<Section>('module');
  const [stepId, setStepId] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<tr.StepKind>('reach-exit');
  const [sceneId, setSceneId] = useState<string | null>(
    env.initialSceneId ?? env.scenes[0]?.id ?? null,
  );
  const [placing, setPlacing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [version, setVersion] = useState<ScormVersion>('2004');
  const [exporting, setExporting] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const viewer = useRef<Viewer | null>(null);
  const resolveAsset = useCallback((p: string) => api.fileUrl(project.root, p), [project.root]);

  const mod = env.modules.find((m) => m.id === moduleId);
  const step = mod?.steps.find((s) => s.id === stepId);
  const previewEnv = useMemo(() => withHazards(env, step, lang), [env, step, lang]);

  function edit<T>(label: string, fn: (d: Environment) => T, key?: string): T | undefined {
    try {
      setProblem(null);
      return store.edit(label, fn, key);
    } catch (err) {
      setProblem(refusal(err));
      return undefined;
    }
  }

  function selectModule(id: string | null) {
    setModuleId(id);
    setStepId(null);
    setPlacing(false);
    setTesting(false);
  }

  function selectStep(s: ModuleStep | undefined) {
    setStepId(s?.id ?? null);
    setPlacing(false);
    if (s?.kind === 'navigate') setSceneId(s.sceneId);
    if (s?.kind === 'hazard-hunt') setSceneId(s.hazards[0]!.sceneId);
  }

  async function exportScorm() {
    setProblem(null);
    setExported(null);
    const name = `${project.name.replace(/[\\/:*?"<>|]+/g, '-')}-SCORM-${version}.zip`;
    const path = await api.pickSave(k.exportTitle, name, k.scormFilter, 'zip');
    if (!path) return;
    try {
      setExporting(k.exporting(0, 0));
      const bytes = await buildScorm(env, version, (d, n) => setExporting(k.exporting(d, n)));
      setExported(k.exported(await api.writeExport(path, bytes)));
    } catch (err) {
      setProblem(describeError(t, err));
    } finally {
      setExporting(null);
    }
  }

  // ---------------------------------------------------------------- list
  const list = (
    <nav className="evx-editor__scenes evx-panel" aria-label={k.modules}>
      <button
        type="button"
        className="evx-cta evx-cta--small mb-3"
        onClick={() => {
          const id = edit(k.labels.addModule, (d) => tr.addModule(d, k.newModuleTitle));
          if (id) {
            selectModule(id);
            setSection('module');
          }
        }}
      >
        {k.newModule}
      </button>
      {env.modules.length === 0 ? (
        <p className="evx-hint">{k.noModules}</p>
      ) : (
        <ul className="evx-skin-list" data-testid="module-list">
          {env.modules.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="evx-skin-list__item"
                aria-current={m.id === moduleId}
                onClick={() => selectModule(m.id)}
              >
                <span>{L(m.title)}</span>
                <span className="evx-hint">
                  {k.steps(m.steps.length)} ·{' '}
                  {m.audienceIds.length
                    ? m.audienceIds
                        .map((a) => L(env.audiences.find((x) => x.id === a)?.name))
                        .join(', ')
                    : k.everyone}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <hr className="evx-skin-list__rule" />
      <div className="grid gap-2">
        <Field label={k.scormVersion}>
          {(id) => (
            <select
              id={id}
              className="evx-field"
              value={version}
              onChange={(e) => setVersion(e.target.value as ScormVersion)}
            >
              <option value="2004">SCORM 2004 (4th edition)</option>
              <option value="1.2">SCORM 1.2</option>
            </select>
          )}
        </Field>
        <button
          type="button"
          className="evx-cta evx-cta--ghost evx-cta--small"
          disabled={!env.modules.length || exporting !== null}
          onClick={() => void exportScorm()}
        >
          {k.exportScorm}
        </button>
        {exporting && (
          <p role="status" className="evx-hint">
            {exporting}
          </p>
        )}
        {exported && (
          <p role="status" className="evx-hint" data-testid="scorm-exported">
            {exported}
          </p>
        )}
        <p className="evx-hint">{k.scormNote}</p>
      </div>
    </nav>
  );

  // ---------------------------------------------------------------- preview
  const scene = env.scenes.find((s) => s.id === sceneId);
  const place = (at: Spherical) => {
    if (!placing || !mod || step?.kind !== 'hazard-hunt' || !sceneId) return;
    edit(k.labels.addHazard, (d) => tr.addHazard(d, mod.id, step.id, sceneId, at));
    setPlacing(false);
  };
  const middle = (
    <section className="evx-editor__stage" aria-label={k.modules}>
      <div className="evx-toolbar" role="toolbar" aria-label={k.modules}>
        {testing ? (
          <>
            <p className="text-sm">{k.testing}</p>
            <button
              type="button"
              className="evx-cta evx-cta--small"
              onClick={() => setTesting(false)}
            >
              {k.backToEditing}
            </button>
          </>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm">
              <span>{k.scene}</span>
              <select
                className="evx-field evx-field--small"
                value={sceneId ?? ''}
                onChange={(e) => setSceneId(e.target.value)}
              >
                {env.scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {L(s.name)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="evx-cta evx-cta--ghost evx-cta--small ml-auto"
              disabled={!mod}
              onClick={() => {
                setPlacing(false);
                if (mod?.startSceneId) setSceneId(mod.startSceneId);
                setTesting(true);
              }}
            >
              {k.test}
            </button>
          </>
        )}
      </div>
      {scene && sceneId ? (
        <Preview
          env={testing ? env : previewEnv}
          sceneId={sceneId}
          editing={!testing}
          selectedHotspot={null}
          lang={lang}
          resolveAsset={resolveAsset}
          viewerRef={(v) => {
            viewer.current = v;
            if (v && testing && mod) void v.startModule(mod.id).catch(() => undefined);
          }}
          failedText={t.editor.previewFailed}
          onPanoramaClick={place}
          onHotspotMove={(id, at) => {
            if (!id.startsWith(HAZARD_PREFIX) || !mod || !step) return;
            const hid = id.slice(HAZARD_PREFIX.length);
            edit(
              k.labels.hazard,
              (d) => tr.updateHazard(d, mod.id, step.id, hid, { position: at }),
              `hazard:${hid}`,
            );
          }}
          onSceneChange={(id) => testing && id !== sceneId && setSceneId(id)}
        />
      ) : null}
      {!testing && step?.kind === 'hazard-hunt' && <p className="evx-hint">{k.dragHazard}</p>}
    </section>
  );

  // ---------------------------------------------------------------- inspector
  let inspector: ReactNode = <p className="evx-hint">{k.noModules}</p>;
  if (mod) {
    const upM = (patch: Parameters<typeof tr.updateModule>[2], key?: string) =>
      edit(k.labels.module, (d) => tr.updateModule(d, mod.id, patch), key);
    const sections = (
      <div className="evx-segmented mb-4" role="radiogroup" aria-label={k.sectionsLabel}>
        {(['module', 'steps', 'checklist'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={section === s}
            onClick={() => setSection(s)}
          >
            {k.sections[s]}
          </button>
        ))}
      </div>
    );
    let body: ReactNode = null;
    if (section === 'module') {
      body = (
        <div className="grid gap-3" data-testid="module-inspector">
          <Bilingual
            labels={[k.titleEn, k.titleFr]}
            value={mod.title}
            onChange={(v) => upM({ title: v }, `title:${mod.id}`)}
          />
          <Bilingual
            labels={[k.descriptionEn, k.descriptionFr]}
            value={mod.description}
            multiline
            onChange={(v) => upM({ description: v }, `description:${mod.id}`)}
          />
          <fieldset className="grid gap-1">
            <legend className="evx-form-row mb-1 font-semibold">{k.audiences}</legend>
            {env.audiences.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={mod.audienceIds.includes(a.id)}
                  onChange={(e) =>
                    upM({
                      audienceIds: e.target.checked
                        ? [...mod.audienceIds, a.id]
                        : mod.audienceIds.filter((x) => x !== a.id),
                    })
                  }
                />
                {L(a.name)}
              </label>
            ))}
            <p className="evx-hint">{k.audiencesHint}</p>
          </fieldset>
          <Field label={k.startScene}>
            {(id) => (
              <select
                id={id}
                className="evx-field"
                value={mod.startSceneId ?? ''}
                onChange={(e) => upM({ startSceneId: e.target.value || null })}
              >
                <option value="">{k.whereverTheyAre}</option>
                {env.scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {L(s.name)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={k.passMark}>
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                max={100}
                className="evx-field"
                value={mod.passMark}
                onChange={(e) => upM({ passMark: Number(e.target.value) }, `pass:${mod.id}`)}
              />
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mod.certificate}
              onChange={(e) => upM({ certificate: e.target.checked })}
            />
            {k.certificate}
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="evx-cta evx-cta--ghost evx-cta--small"
              onClick={() => edit(k.labels.moveModule, (d) => tr.moveModule(d, mod.id, -1))}
            >
              {k.moveUp}
            </button>
            <button
              type="button"
              className="evx-cta evx-cta--ghost evx-cta--small"
              onClick={() => edit(k.labels.moveModule, (d) => tr.moveModule(d, mod.id, 1))}
            >
              {k.moveDown}
            </button>
            <button
              type="button"
              className="evx-cta evx-cta--ghost evx-cta--small"
              onClick={() => {
                const i = env.modules.indexOf(mod);
                let removed = false;
                edit(k.labels.removeModule, (d) => {
                  tr.removeModule(d, mod.id);
                  removed = true;
                });
                // Refused while a "start module" action uses it (the alert says where).
                if (removed) selectModule(env.modules[i + 1]?.id ?? env.modules[i - 1]?.id ?? null);
              }}
            >
              {k.removeModule}
            </button>
          </div>
        </div>
      );
    } else if (section === 'steps') {
      body = (
        <div className="grid gap-3">
          <ol className="evx-training-steps" data-testid="step-list">
            {mod.steps.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="evx-skin-list__item"
                  aria-current={s.id === stepId}
                  onClick={() => selectStep(s)}
                >
                  <span>
                    {i + 1}. {k.kinds[s.kind]}
                  </span>
                  <span className="evx-hint">
                    {s.kind === 'question' ? L(s.question.prompt) : L(s.instruction)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={k.newStepKind}>
              {(id) => (
                <select
                  id={id}
                  className="evx-field"
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value as tr.StepKind)}
                >
                  {tr.STEP_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {k.kinds[kind]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <button
              type="button"
              className="evx-cta evx-cta--small mb-3"
              onClick={() => {
                const view = viewer.current?.getView();
                const id = edit(k.labels.addStep, (d) =>
                  tr.addStep(d, mod.id, newKind, {
                    sceneId,
                    view: view ? { yaw: view.yaw, pitch: view.pitch } : undefined,
                  }),
                );
                if (id) setStepId(id);
              }}
            >
              {k.addStep}
            </button>
          </div>
          {step ? stepEditor(mod.id, step) : <p className="evx-hint">{k.noSteps}</p>}
        </div>
      );
    } else {
      body = (
        <div className="grid gap-3" data-testid="checklist-inspector">
          <p className="evx-hint">{k.checklistNote}</p>
          {mod.checklist.map((c, i) => (
            <fieldset key={c.id} className="evx-training-item grid gap-1">
              <legend className="font-semibold">{`${i + 1}.`}</legend>
              <Bilingual
                labels={[k.itemEn, k.itemFr]}
                value={c.label}
                onChange={(v) =>
                  edit(
                    k.labels.checklist,
                    (d) => tr.updateChecklistItem(d, mod.id, c.id, { label: v }),
                    `item:${c.id}`,
                  )
                }
              />
              <Field label={k.tickedBy}>
                {(id) => (
                  <select
                    id={id}
                    className="evx-field"
                    value={c.stepId ?? ''}
                    onChange={(e) =>
                      edit(k.labels.checklist, (d) =>
                        tr.updateChecklistItem(d, mod.id, c.id, {
                          stepId: e.target.value || null,
                        }),
                      )
                    }
                  >
                    <option value="">{k.learnerTicks}</option>
                    {mod.steps.map((s, j) => (
                      <option key={s.id} value={s.id}>
                        {`${j + 1}. ${k.kinds[s.kind]}`}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <button
                type="button"
                className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
                onClick={() =>
                  edit(k.labels.checklist, (d) => tr.removeChecklistItem(d, mod.id, c.id))
                }
              >
                {k.remove}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="evx-cta evx-cta--small justify-self-start"
            onClick={() => edit(k.labels.checklist, (d) => tr.addChecklistItem(d, mod.id))}
          >
            {k.addItem}
          </button>
        </div>
      );
    }
    inspector = (
      <>
        <h2 className="evx-subheading mb-3">{L(mod.title)}</h2>
        {sections}
        {body}
      </>
    );
  }

  function stepEditor(mId: string, s: ModuleStep) {
    const up = (patch: Parameters<typeof tr.updateStep>[3], key?: string) =>
      edit(k.labels.step, (d) => tr.updateStep(d, mId, s.id, patch), key);
    const common =
      s.kind === 'question' ? null : (
        <>
          <Bilingual
            labels={[k.instructionEn, k.instructionFr]}
            value={s.instruction}
            multiline
            hint={s.kind === 'reach-exit' ? k.exitDefault : undefined}
            onChange={(v) => up({ instruction: v }, `instruction:${s.id}`)}
          />
          <Bilingual
            labels={[k.hintEn, k.hintFr]}
            value={s.hint}
            hint={k.hintNote}
            onChange={(v) => up({ hint: v }, `hint:${s.id}`)}
          />
          <Field label={k.points}>
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                max={100}
                step={0.5}
                className="evx-field"
                value={s.points}
                onChange={(e) => up({ points: Number(e.target.value) }, `points:${s.id}`)}
              />
            )}
          </Field>
        </>
      );
    let specific: ReactNode = null;
    if (s.kind === 'navigate')
      specific = (
        <Field label={k.scene}>
          {(id) => (
            <select
              id={id}
              className="evx-field"
              value={s.sceneId}
              onChange={(e) => {
                up({ sceneId: e.target.value });
                setSceneId(e.target.value);
              }}
            >
              {env.scenes.map((x) => (
                <option key={x.id} value={x.id}>
                  {L(x.name)}
                </option>
              ))}
            </select>
          )}
        </Field>
      );
    if (s.kind === 'find-item')
      specific = (
        <Field label={k.target} hint={k.targetNote}>
          {(id) => (
            <select
              id={id}
              className="evx-field"
              value={s.targetId}
              onChange={(e) => up({ targetId: e.target.value })}
            >
              {tr.findTargets(env, lang).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      );
    if (s.kind === 'reach-exit') specific = <p className="evx-hint">{k.exitNote}</p>;
    if (s.kind === 'hazard-hunt')
      specific = (
        <fieldset className="grid gap-2" data-testid="hazard-list">
          <legend className="evx-form-row mb-1 font-semibold">{k.hazards}</legend>
          {s.hazards.map((h) => (
            <div key={h.id} className="evx-training-item grid gap-1" data-hazard={h.id}>
              <p className="evx-hint">
                {L(env.scenes.find((x) => x.id === h.sceneId)?.name)} · {h.position.yaw}° ·{' '}
                {h.position.pitch}°
              </p>
              <Bilingual
                labels={[k.hazardLabelEn, k.hazardLabelFr]}
                value={h.label}
                onChange={(v) =>
                  edit(
                    k.labels.hazard,
                    (d) => tr.updateHazard(d, mId, s.id, h.id, { label: v }),
                    `hazard-label:${h.id}`,
                  )
                }
              />
              <Field label={k.radius}>
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min={2}
                    max={45}
                    className="evx-field"
                    value={h.radius}
                    onChange={(e) =>
                      edit(
                        k.labels.hazard,
                        (d) =>
                          tr.updateHazard(d, mId, s.id, h.id, { radius: Number(e.target.value) }),
                        `hazard-radius:${h.id}`,
                      )
                    }
                  />
                )}
              </Field>
              <button
                type="button"
                className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
                disabled={s.hazards.length <= 1}
                onClick={() =>
                  edit(k.labels.removeHazard, (d) => tr.removeHazard(d, mId, s.id, h.id))
                }
              >
                {k.remove}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="evx-cta evx-cta--small justify-self-start"
            aria-pressed={placing}
            onClick={() => setPlacing((p) => !p)}
          >
            {placing ? k.placing : k.placeHazard}
          </button>
          <Field label={k.required}>
            {(id) => (
              <select
                id={id}
                className="evx-field"
                value={s.required ?? ''}
                onChange={(e) => up({ required: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">{k.allOf(s.hazards.length)}</option>
                {s.hazards.slice(0, -1).map((_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </fieldset>
      );
    if (s.kind === 'question') {
      const q = s.question;
      specific = (
        <>
          <Bilingual
            labels={[k.promptEn, k.promptFr]}
            value={q.prompt}
            multiline
            onChange={(v) => up({ prompt: v }, `prompt:${s.id}`)}
          />
          <fieldset className="grid gap-2" data-testid="answers">
            <legend className="evx-form-row mb-1 font-semibold">{k.answers}</legend>
            {q.choices.map((c, i) => (
              <div key={c.id} className="evx-training-item grid gap-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`correct-${s.id}`}
                    checked={c.correct}
                    onChange={() => edit(k.labels.answer, (d) => tr.setCorrect(d, mId, s.id, c.id))}
                  />
                  {`${k.correct} (${i + 1})`}
                </label>
                <Bilingual
                  labels={[k.answerEn(i + 1), k.answerFr(i + 1)]}
                  value={c.label}
                  onChange={(v) =>
                    edit(
                      k.labels.answer,
                      (d) => tr.updateChoice(d, mId, s.id, c.id, v),
                      `answer:${s.id}:${c.id}`,
                    )
                  }
                />
                <button
                  type="button"
                  className="evx-cta evx-cta--ghost evx-cta--small justify-self-start"
                  disabled={q.choices.length <= 2}
                  onClick={() => edit(k.labels.answer, (d) => tr.removeChoice(d, mId, s.id, c.id))}
                >
                  {k.removeAnswer(i + 1)}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="evx-cta evx-cta--small justify-self-start"
              onClick={() => edit(k.labels.answer, (d) => tr.addChoice(d, mId, s.id))}
            >
              {k.addAnswer}
            </button>
          </fieldset>
          <Field label={k.points}>
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                step={0.5}
                className="evx-field"
                value={q.points}
                onChange={(e) => up({ points: Number(e.target.value) }, `points:${s.id}`)}
              />
            )}
          </Field>
          <Bilingual
            labels={[k.feedbackCorrectEn, k.feedbackCorrectFr]}
            value={q.feedbackCorrect}
            onChange={(v) => up({ feedbackCorrect: v }, `fbc:${s.id}`)}
          />
          <Bilingual
            labels={[k.feedbackIncorrectEn, k.feedbackIncorrectFr]}
            value={q.feedbackIncorrect}
            onChange={(v) => up({ feedbackIncorrect: v }, `fbi:${s.id}`)}
          />
        </>
      );
    }
    const i = mod!.steps.indexOf(s);
    return (
      <div className="grid gap-3 border-t pt-3" data-testid="step-inspector">
        <h3 className="evx-subheading">{`${i + 1}. ${k.kinds[s.kind]}`}</h3>
        {specific}
        {common}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="evx-cta evx-cta--ghost evx-cta--small"
            disabled={i === 0}
            onClick={() => edit(k.labels.moveStep, (d) => tr.moveStep(d, mId, s.id, -1))}
          >
            {k.moveUp}
          </button>
          <button
            type="button"
            className="evx-cta evx-cta--ghost evx-cta--small"
            disabled={i === mod!.steps.length - 1}
            onClick={() => edit(k.labels.moveStep, (d) => tr.moveStep(d, mId, s.id, 1))}
          >
            {k.moveDown}
          </button>
          <button
            type="button"
            className="evx-cta evx-cta--ghost evx-cta--small"
            disabled={mod!.steps.length <= 1}
            onClick={() => {
              edit(k.labels.removeStep, (d) => tr.removeStep(d, mId, s.id));
              setStepId(null);
            }}
          >
            {k.remove}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="evx-editor">
      {list}
      {middle}
      <aside className="evx-editor__inspector evx-panel" aria-label={k.modules}>
        {problem && (
          <p role="alert" className="evx-alert mb-4">
            {problem}
          </p>
        )}
        {inspector}
      </aside>
    </div>
  );
}
