/**
 * Guided training modules (Phase 8): a panel walks the learner through a module's
 * steps — go somewhere, find an item, find the nearest exit, hunt for hazards, answer
 * questions — scores them (hints halve a step's points, skips earn none), keeps the
 * module's checklist, and ends with results and, when passed, a local certificate.
 * Everything stays on the device; hosts (e.g. the SCORM bridge) listen to events.
 */
import {
  localize,
  routesForScene,
  type Environment,
  type Hotspot,
  type ModuleStep,
  type QuizQuestion,
  type TrainingModule,
} from '@evactis-3dworkflow/schema';
import type { UiStrings } from './i18n.ts';
import { DEG, direction } from './math.ts';

export type StepStatus = 'done' | 'hinted' | 'skipped' | 'incorrect';

export interface StepResult {
  stepId: string;
  kind: ModuleStep['kind'];
  status: StepStatus;
  points: number;
  max: number;
}

export interface ModuleResult {
  moduleId: string;
  score: number;
  max: number;
  /** 0–100, rounded. */
  percent: number;
  passed: boolean;
  steps: StepResult[];
  /** Checklist items ticked. */
  checklist: string[];
  startedAt: string;
  finishedAt: string;
}

export interface TrainingEvents {
  modulestart: { moduleId: string };
  modulestep: { moduleId: string; index: number; result: StepResult };
  modulecomplete: ModuleResult;
  /** The learner left a module before finishing it. */
  moduleend: { moduleId: string; completed: boolean };
}

/** What training needs from the Viewer. */
export interface TrainingHost {
  readonly element: HTMLElement;
  readonly environment: Environment;
  readonly language: string;
  readonly audience: string | null;
  readonly sceneId: string | null;
  /** Pre-fills the certificate's name field (e.g. from the LMS). */
  readonly learnerName: string;
  t(): UiStrings;
  inAudience(ids: string[]): boolean;
  goToScene(id: string): Promise<void>;
  showDialog(title: string, content: Node[], modifier?: string): Promise<void>;
  closeDialog(): void;
  ask(q: QuizQuestion): Promise<{ correct: boolean; points: number }>;
  showRoute(routeId: string): void;
  /** Direction at the centre of the view. */
  view(): { yaw: number; pitch: number };
  refreshHotspots(): void;
  emit<K extends keyof TrainingEvents>(type: K, payload: TrainingEvents[K]): void;
  certificate(result: ModuleResult, name: string): Promise<void>;
}

interface Run {
  module: TrainingModule;
  index: number;
  results: StepResult[];
  hinted: boolean;
  found: Set<string>;
  /** Target scene of a reach-exit step, fixed when the step starts. */
  exitSceneId: string | null;
  ticked: Set<string>;
  startedAt: string;
  busy: boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const stepPoints = (s: ModuleStep) => (s.kind === 'question' ? s.question.points : s.points);

/** Angle (degrees) between two directions. */
function angleBetween(a: { yaw: number; pitch: number }, b: { yaw: number; pitch: number }) {
  const p = direction(a.yaw, a.pitch);
  const q = direction(b.yaw, b.pitch);
  const dot = Math.min(1, Math.max(-1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
  return Math.acos(dot) / DEG;
}

export class Training {
  private run: Run | null = null;
  private panel: HTMLElement;
  private eyebrow: HTMLElement;
  private heading: HTMLElement;
  private instruction: HTMLElement;
  private status: HTMLElement;
  private actions: HTMLElement;
  /** Last result per module this session (shown in the picker). */
  private last = new Map<string, number>();

  constructor(private host: TrainingHost) {
    this.panel = el('section', 'evx-training');
    this.panel.hidden = true;
    this.eyebrow = el('p', 'evx-training__eyebrow');
    this.heading = el('h2', 'evx-training__title');
    this.instruction = el('p', 'evx-training__instruction');
    this.instruction.setAttribute('aria-live', 'polite');
    this.status = el('p', 'evx-training__status');
    this.status.setAttribute('role', 'status');
    this.actions = el('div', 'evx-training__actions');
    this.panel.append(this.eyebrow, this.heading, this.instruction, this.status, this.actions);
    host.element.append(this.panel);
    new ResizeObserver(() => this.publishHeight()).observe(this.panel);
  }

  /** Modules this audience may take. */
  available(): TrainingModule[] {
    return this.host.environment.modules.filter((m) => this.host.inAudience(m.audienceIds));
  }

  get active(): { moduleId: string; stepIndex: number } | null {
    return this.run ? { moduleId: this.run.module.id, stepIndex: this.run.index } : null;
  }

  async start(moduleId: string): Promise<void> {
    const m = this.host.environment.modules.find((x) => x.id === moduleId);
    if (!m) throw new Error(`Unknown training module "${moduleId}"`);
    if (!this.host.inAudience(m.audienceIds))
      throw new Error(`Module "${moduleId}" is not available to this audience`);
    if (this.run) this.end(false);
    this.run = {
      module: m,
      index: 0,
      results: [],
      hinted: false,
      found: new Set(),
      exitSceneId: null,
      ticked: new Set(),
      startedAt: new Date().toISOString(),
      busy: false,
    };
    this.host.emit('modulestart', { moduleId });
    if (m.startSceneId && m.startSceneId !== this.host.sceneId)
      await this.host.goToScene(m.startSceneId);
    await this.begin();
  }

  /** Leaves the current module without results. */
  quit(): void {
    if (this.run) this.end(false);
  }

  private end(completed: boolean) {
    const id = this.run!.module.id;
    this.run = null;
    this.panel.hidden = true;
    this.publishHeight();
    this.host.refreshHotspots();
    this.host.emit('moduleend', { moduleId: id, completed });
  }

  private get step(): ModuleStep | null {
    const r = this.run;
    return r ? (r.module.steps[r.index] ?? null) : null;
  }

  // ---------------------------------------------------------------- the panel

  private publishHeight() {
    const h = this.panel.hidden ? 0 : Math.round(this.panel.offsetHeight + 12);
    this.host.element.style.setProperty('--evx-training-h', `${h}px`);
  }

  private button(label: string, onClick: () => void, cls = 'evx-cta evx-cta--ghost') {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  /** Re-renders the panel for the current step and language. */
  render(): void {
    const r = this.run;
    const s = this.step;
    if (!r || !s) return;
    const t = this.host.t().training;
    const L = (x: Record<string, string>) => localize(x, this.host.language);
    this.panel.hidden = false;
    this.panel.lang = this.host.language;
    this.panel.setAttribute('aria-label', t.region(L(r.module.title)));
    this.panel.dataset.step = s.id;
    this.panel.dataset.kind = s.kind;
    this.eyebrow.textContent = t.step(r.index + 1, r.module.steps.length);
    this.heading.textContent = L(r.module.title);
    this.instruction.textContent =
      s.kind === 'question'
        ? L(s.question.prompt)
        : s.kind === 'reach-exit' && !Object.values(s.instruction).some(Boolean)
          ? t.exitInstruction
          : L(s.instruction);
    const buttons: HTMLElement[] = [];
    if (s.kind === 'hazard-hunt') {
      const b = this.button(t.inspect, () => this.inspect(this.host.view()), 'evx-cta');
      b.dataset.training = 'inspect';
      buttons.push(b);
    }
    if (s.kind !== 'question') {
      const hint = this.button(t.hint, () => this.hint());
      hint.title = t.hintCost;
      hint.dataset.training = 'hint';
      hint.disabled = r.hinted;
      buttons.push(hint);
    }
    if (r.module.checklist.length) {
      const c = this.button(t.checklist, () => void this.checklist());
      c.dataset.training = 'checklist';
      buttons.push(c);
    }
    const skip = this.button(t.skip, () => this.finishStep('skipped'));
    skip.dataset.training = 'skip';
    const leave = this.button(t.leave, () => this.quit());
    leave.dataset.training = 'leave';
    buttons.push(skip, leave);
    this.actions.replaceChildren(...buttons);
    this.publishHeight();
  }

  private say(text: string) {
    this.status.textContent = text;
  }

  // ---------------------------------------------------------------- steps

  private async begin(): Promise<void> {
    const r = this.run;
    const s = this.step;
    if (!r) return;
    if (!s) return void (await this.complete());
    r.hinted = false;
    r.found = new Set();
    r.exitSceneId = null;
    this.say('');
    this.render();
    this.host.refreshHotspots();
    switch (s.kind) {
      case 'navigate':
        if (this.host.sceneId === s.sceneId) this.finishStep('done');
        return;
      case 'reach-exit': {
        const here = this.host.sceneId;
        const route = here
          ? routesForScene(this.host.environment, here, this.host.audience).primary
          : null;
        const target = route?.sceneSequence.at(-1) ?? null;
        if (!route || !target) {
          this.finishStep('skipped', this.host.t().training.noExit);
          return;
        }
        r.exitSceneId = target;
        if (here === target) this.finishStep('done');
        return;
      }
      case 'question': {
        const answer = await this.host.ask(s.question);
        if (this.run !== r || this.step !== s) return;
        this.finishStep(answer.correct ? 'done' : 'incorrect');
        return;
      }
      default:
        return;
    }
  }

  /** Records the current step and moves on. */
  private finishStep(status: StepStatus, note?: string) {
    const r = this.run;
    const s = this.step;
    if (!r || !s || r.busy) return;
    const max = stepPoints(s);
    const result: StepResult = {
      stepId: s.id,
      kind: s.kind,
      status: status === 'done' && r.hinted ? 'hinted' : status,
      points: status === 'done' ? (r.hinted ? max / 2 : max) : 0,
      max,
    };
    r.results.push(result);
    if (result.status === 'done' || result.status === 'hinted')
      for (const c of r.module.checklist) if (c.stepId === s.id) r.ticked.add(c.id);
    this.host.emit('modulestep', { moduleId: r.module.id, index: r.index, result });
    r.index++;
    const t = this.host.t().training;
    const said = note ?? (status === 'skipped' ? t.stepSkipped : t.stepDone);
    // The next step renders on a microtask so its own announcement follows this one.
    r.busy = true;
    queueMicrotask(() => {
      r.busy = false;
      if (this.run !== r) return;
      void this.begin().then(() => this.run === r && this.say(said));
    });
  }

  private hint() {
    const r = this.run;
    const s = this.step;
    if (!r || !s || s.kind === 'question') return;
    r.hinted = true;
    const t = this.host.t().training;
    const L = (x: Record<string, string>) => localize(x, this.host.language);
    let text = s.hint ? L(s.hint) : '';
    if (s.kind === 'reach-exit' && this.host.sceneId) {
      const route = routesForScene(
        this.host.environment,
        this.host.sceneId,
        this.host.audience,
      ).primary;
      if (route) {
        this.host.showRoute(route.id);
        text ||= t.routeShown;
      }
    }
    if (!text && s.kind === 'find-item') {
      const scene = this.sceneOf(s.targetId);
      if (scene) text = t.itemIn(L(scene));
    }
    if (!text && s.kind === 'navigate') {
      const scene = this.host.environment.scenes.find((x) => x.id === s.sceneId);
      if (scene) text = t.itemIn(L(scene.name));
    }
    this.render();
    this.say(text);
  }

  private sceneOf(targetId: string) {
    const env = this.host.environment;
    const h = env.hotspots.find((x) => x.id === targetId);
    const eq = env.equipment.find((x) => x.id === targetId);
    const sceneId = h?.sceneId ?? eq?.placements.find((p) => p.sceneId)?.sceneId;
    return env.scenes.find((x) => x.id === sceneId)?.name;
  }

  // ---------------------------------------------------------------- what the learner does

  onScene(sceneId: string): void {
    const r = this.run;
    const s = this.step;
    if (!r || !s) return;
    if (s.kind === 'navigate' && s.sceneId === sceneId) this.finishStep('done');
    else if (s.kind === 'reach-exit' && r.exitSceneId === sceneId) this.finishStep('done');
    else this.host.refreshHotspots();
  }

  onHotspot(hotspotId: string): void {
    const s = this.step;
    if (s?.kind !== 'find-item') return;
    if (hotspotId === s.targetId || hotspotId === `equipment:${s.targetId}`)
      this.finishStep('done');
  }

  /** A click on the panorama: during a hazard hunt, did it land on a hazard? */
  onPanoramaClick(at: { yaw: number; pitch: number }): void {
    if (this.step?.kind === 'hazard-hunt') this.inspect(at);
  }

  private inspect(at: { yaw: number; pitch: number }) {
    const r = this.run;
    const s = this.step;
    if (!r || s?.kind !== 'hazard-hunt') return;
    const t = this.host.t().training;
    const hit = s.hazards.find(
      (h) =>
        h.sceneId === this.host.sceneId &&
        !r.found.has(h.id) &&
        angleBetween(h.position, at) <= h.radius,
    );
    if (!hit) return this.say(t.nothingThere);
    r.found.add(hit.id);
    const required = s.required ?? s.hazards.length;
    this.host.refreshHotspots();
    const said = t.found(localize(hit.label, this.host.language), r.found.size, required);
    if (r.found.size >= required) this.finishStep('done', said);
    else this.say(said);
  }

  /** Markers for hazards already found in this scene (a green tick and the label). */
  hotspots(sceneId: string): Hotspot[] {
    const r = this.run;
    const s = this.step;
    if (!r || s?.kind !== 'hazard-hunt') return [];
    return s.hazards
      .filter((h) => h.sceneId === sceneId && r.found.has(h.id))
      .map((h) => ({
        id: `training:${h.id}`,
        sceneId,
        title: h.label,
        position: { kind: 'spherical' as const, ...h.position },
        appearance: {
          kind: 'label' as const,
          text: Object.fromEntries(Object.entries(h.label).map(([k, v]) => [k, `✓ ${v}`])),
        },
        actions: [],
        audienceIds: [],
        hidden: false,
      }));
  }

  // ---------------------------------------------------------------- dialogs

  /** The module's checklist: linked items follow their steps; others the learner ticks. */
  async checklist(finishing = false): Promise<void> {
    const r = this.run;
    const t = this.host.t().training;
    const L = (x: Record<string, string>) => localize(x, this.host.language);
    if (!r) return this.host.showDialog(t.checklist, [el('p', 'evx-viewer__text', t.noActive)]);
    const list = el('ul', 'evx-training__checklist');
    const finish = this.button(t.finish, () => this.host.closeDialog(), 'evx-cta');
    const allTicked = () => r.module.checklist.every((c) => r.ticked.has(c.id));
    for (const c of r.module.checklist) {
      const li = el('li');
      const label = el('label');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = r.ticked.has(c.id);
      // Items tied to a step are ticked by doing the step.
      box.disabled = !!c.stepId;
      box.addEventListener('change', () => {
        if (box.checked) r.ticked.add(c.id);
        else r.ticked.delete(c.id);
        finish.disabled = !allTicked();
      });
      label.append(box, document.createTextNode(` ${L(c.label)}`));
      li.append(label);
      list.append(li);
    }
    const nodes: Node[] = [];
    if (finishing) nodes.push(el('p', 'evx-viewer__text', t.beforeFinish));
    nodes.push(list);
    if (finishing) {
      finish.disabled = !allTicked();
      nodes.push(finish);
    }
    await this.host.showDialog(t.checklistTitle(L(r.module.title)), nodes);
  }

  /** The start-module button: modules for this audience, or the one in progress. */
  async picker(): Promise<void> {
    const t = this.host.t().training;
    const L = (x: Record<string, string>) => localize(x, this.host.language);
    const nodes: Node[] = [];
    if (this.run) {
      const r = this.run;
      const box = el('div', 'evx-training__current');
      box.append(
        el('p', 'evx-viewer__text', t.inProgress(L(r.module.title))),
        this.button(t.resume, () => this.host.closeDialog(), 'evx-cta'),
        this.button(t.leave, () => {
          this.quit();
          this.host.closeDialog();
        }),
      );
      nodes.push(box);
    }
    const modules = this.available();
    if (!modules.length) nodes.push(el('p', 'evx-viewer__text', t.noModules));
    const list = el('ul', 'evx-training__modules');
    for (const m of modules) {
      const li = el('li', 'evx-training__module');
      li.dataset.moduleId = m.id;
      const title = el('h3', 'evx-training__module-title', L(m.title));
      li.append(title);
      if (m.description) li.append(el('p', 'evx-viewer__text', L(m.description)));
      const meta = [t.steps(m.steps.length)];
      const last = this.last.get(m.id);
      if (last !== undefined) meta.push(t.lastScore(last));
      li.append(el('p', 'evx-training__meta', meta.join(' · ')));
      const go = this.button(
        last === undefined ? t.start : t.restart,
        () => {
          this.host.closeDialog();
          void this.start(m.id);
        },
        'evx-cta',
      );
      go.setAttribute('aria-label', `${go.textContent}: ${L(m.title)}`);
      li.append(go);
      list.append(li);
    }
    nodes.push(list);
    await this.host.showDialog(t.modules, nodes, 'evx-viewer__dialog--menu');
  }

  // ---------------------------------------------------------------- results

  private async complete() {
    const r = this.run;
    if (!r) return;
    if (r.module.checklist.some((c) => !r.ticked.has(c.id))) await this.checklist(true);
    if (this.run !== r) return;
    const score = r.results.reduce((a, x) => a + x.points, 0);
    const max = r.results.reduce((a, x) => a + x.max, 0);
    const percent = max ? Math.round((score / max) * 100) : 100;
    const checklistDone = r.module.checklist.every((c) => r.ticked.has(c.id));
    const result: ModuleResult = {
      moduleId: r.module.id,
      score,
      max,
      percent,
      passed: percent >= r.module.passMark && checklistDone,
      steps: r.results,
      checklist: [...r.ticked],
      startedAt: r.startedAt,
      finishedAt: new Date().toISOString(),
    };
    this.last.set(r.module.id, percent);
    const module = r.module;
    this.host.emit('modulecomplete', result);
    this.end(true);
    await this.results(module, result);
  }

  private async results(m: TrainingModule, result: ModuleResult) {
    const t = this.host.t().training;
    const L = (x: Record<string, string>) => localize(x, this.host.language);
    const nodes: Node[] = [];
    const verdict = el(
      'p',
      'evx-training__verdict',
      result.passed ? t.passed : t.notPassed(m.passMark),
    );
    verdict.dataset.passed = String(result.passed);
    nodes.push(
      el('p', 'evx-training__score', t.score(result.score, result.max, result.percent)),
      verdict,
    );
    const list = el('ol', 'evx-training__results');
    m.steps.forEach((s, i) => {
      const res = result.steps[i];
      const li = el('li');
      li.dataset.status = res?.status ?? 'skipped';
      const what =
        s.kind === 'question'
          ? L(s.question.prompt)
          : s.kind === 'reach-exit' && !Object.values(s.instruction).some(Boolean)
            ? t.exitInstruction
            : L(s.instruction);
      li.append(
        el('span', '', what),
        el('span', 'evx-training__result', t.status[res?.status ?? 'skipped']),
      );
      list.append(li);
    });
    nodes.push(list);
    if (result.passed && m.certificate) {
      const form = el('form', 'evx-training__certificate');
      const label = el('label', 'evx-skin__field');
      const input = el('input', 'evx-training__name');
      input.required = true;
      input.maxLength = 80;
      input.autocomplete = 'name';
      input.value = this.host.learnerName;
      label.append(el('span', '', t.yourName), input);
      const submit = el('button', 'evx-cta', t.download);
      submit.type = 'submit';
      form.append(label, submit);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        submit.disabled = true;
        submit.textContent = t.preparing;
        void this.host.certificate(result, name).finally(() => {
          submit.disabled = false;
          submit.textContent = t.download;
        });
      });
      nodes.push(el('h3', 'evx-skin__section-title', t.certificate), form);
    }
    await this.host.showDialog(`${t.results}: ${L(m.title)}`, nodes);
  }

  dispose(): void {
    this.panel.remove();
    this.host.element.style.removeProperty('--evx-training-h');
  }
}
