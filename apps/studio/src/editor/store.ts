/**
 * The open environment document: every edit, undo/redo and autosave go through here.
 *
 * Edits are functions that mutate a copy (`structuredClone`) of the current document;
 * the previous document is kept for undo. Environments are small (a 10-scene tour is
 * tens of kilobytes), so whole-document copies are simpler and safer than diffs.
 * Edits with the same `key` within `coalesceMs` merge into one undo step (dragging a
 * hotspot, typing a name). An edit that throws leaves the document unchanged.
 *
 * Autosave writes only documents that pass the full schema (shapes plus references),
 * so the manifest on disk is always one the Viewer can open.
 */
import { EnvironmentSchema, type Environment } from '@evactis-3dworkflow/schema';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'invalid' | 'error';

export interface StoreOptions {
  /** Writes the manifest (JSON text). */
  save: (json: string) => Promise<void>;
  /** Takes an automatic version of the saved project (see `snapshotEveryMs`). */
  snapshot?: () => Promise<unknown>;
  /** Autosave delay after the last edit. */
  delayMs?: number;
  /** Minimum time between automatic versions while editing. */
  snapshotEveryMs?: number;
  /** Undo steps kept. */
  limit?: number;
  coalesceMs?: number;
  now?: () => number;
}

interface Step {
  doc: Environment;
  label: string;
}

export interface DocumentState {
  env: Environment;
  revision: number;
  status: SaveStatus;
  /** Why the document is not saved (status `invalid` or `error`). */
  problem: string | null;
  undoLabel: string | null;
  redoLabel: string | null;
}

export class DocumentStore {
  private present: Environment;
  private past: Step[] = [];
  private future: Step[] = [];
  private revision = 0;
  private savedRevision = 0;
  private status: SaveStatus = 'saved';
  private problem: string | null = null;
  private last: { key: string; at: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private lastSnapshotAt: number;
  private listeners = new Set<() => void>();
  private state: DocumentState;
  private readonly opts: Required<Omit<StoreOptions, 'snapshot'>> & Pick<StoreOptions, 'snapshot'>;

  constructor(env: Environment, options: StoreOptions) {
    this.opts = {
      delayMs: 1500,
      snapshotEveryMs: 10 * 60_000,
      limit: 100,
      coalesceMs: 1000,
      now: () => Date.now(),
      ...options,
    };
    this.present = env;
    // Opening the project already took a version (studio.rs).
    this.lastSnapshotAt = this.opts.now();
    this.state = this.makeState();
  }

  get env(): Environment {
    return this.present;
  }

  getState = (): DocumentState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Applies `fn` to a copy of the document as one undo step labelled `label`, and
   * returns what `fn` returns. No step is recorded when nothing changed.
   */
  edit<T>(label: string, fn: (draft: Environment) => T, key?: string): T {
    const draft = structuredClone(this.present);
    const result = fn(draft);
    if (JSON.stringify(draft) === JSON.stringify(this.present)) return result;
    const at = this.opts.now();
    const merge =
      key !== undefined && this.last?.key === key && at - this.last.at < this.opts.coalesceMs;
    if (!merge) {
      this.past.push({ doc: this.present, label });
      if (this.past.length > this.opts.limit) this.past.shift();
    }
    this.last = key === undefined ? null : { key, at };
    this.future = [];
    this.present = draft;
    this.changed();
    return result;
  }

  undo(): void {
    const step = this.past.pop();
    if (!step) return;
    this.future.push({ doc: this.present, label: step.label });
    this.present = step.doc;
    this.last = null;
    this.changed();
  }

  redo(): void {
    const step = this.future.pop();
    if (!step) return;
    this.past.push({ doc: this.present, label: step.label });
    this.present = step.doc;
    this.last = null;
    this.changed();
  }

  /** Replaces the document without an undo step (after restoring a version). */
  reset(env: Environment): void {
    this.cancelTimer();
    this.present = env;
    this.past = [];
    this.future = [];
    this.last = null;
    this.revision++;
    this.savedRevision = this.revision;
    this.status = 'saved';
    this.problem = null;
    this.publish();
  }

  /** Saves now if anything is pending; resolves when the document on disk is current. */
  async flush(): Promise<void> {
    this.cancelTimer();
    if (this.saving) await this.saving;
    if (this.revision !== this.savedRevision) await this.save();
  }

  dispose(): void {
    this.cancelTimer();
    this.listeners.clear();
  }

  private changed() {
    this.revision++;
    this.status = 'pending';
    this.problem = null;
    this.cancelTimer();
    this.timer = setTimeout(() => void this.save(), this.opts.delayMs);
    this.publish();
  }

  private async save(): Promise<void> {
    this.timer = null;
    if (this.saving) {
      // A save is in flight; save again once it lands.
      await this.saving;
      if (this.revision === this.savedRevision) return;
    }
    const revision = this.revision;
    const checked = EnvironmentSchema.safeParse(this.present);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      this.status = 'invalid';
      this.problem = issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid document';
      this.publish();
      return;
    }
    const doc = { ...this.present, updatedAt: new Date(this.opts.now()).toISOString() };
    this.status = 'saving';
    this.publish();
    this.saving = (async () => {
      try {
        await this.opts.save(JSON.stringify(doc, null, 2) + '\n');
        this.savedRevision = revision;
        if (this.revision === revision) this.status = 'saved';
        await this.maybeSnapshot();
      } catch (e) {
        this.status = 'error';
        this.problem =
          e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      }
    })();
    try {
      await this.saving;
    } finally {
      this.saving = null;
      this.publish();
    }
  }

  private async maybeSnapshot() {
    const now = this.opts.now();
    if (!this.opts.snapshot || now - this.lastSnapshotAt < this.opts.snapshotEveryMs) return;
    this.lastSnapshotAt = now;
    // A failed automatic version never blocks editing; the next one will try again.
    await this.opts.snapshot().catch(() => {});
  }

  private cancelTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private makeState(): DocumentState {
    return {
      env: this.present,
      revision: this.revision,
      status: this.status,
      problem: this.problem,
      undoLabel: this.past.at(-1)?.label ?? null,
      redoLabel: this.future.at(-1)?.label ?? null,
    };
  }

  private publish() {
    this.state = this.makeState();
    for (const l of this.listeners) l();
  }
}
