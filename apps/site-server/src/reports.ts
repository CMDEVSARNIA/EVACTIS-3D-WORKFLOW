/**
 * Local usage reports: scene views and training-module completions, stored in the site's
 * own database only when an administrator turns reports on (off by default). Nothing is
 * ever sent anywhere; the administrator exports CSV. While reports are off, events are
 * refused, not stored.
 */
import type { User } from './accounts.ts';
import { getSetting, setSetting, type Db } from './db.ts';

export interface ReportEvent {
  kind: 'scene-view' | 'module-complete';
  environmentId: string;
  sceneId?: string;
  moduleId?: string;
  score?: number;
  passed?: boolean;
}

export class ReportError extends Error {
  override name = 'ReportError';
}

const ID = /^[\p{L}\p{N}._:-]{1,200}$/u;

/**
 * A spreadsheet cell: quoted, with formula characters neutralised (a value starting with
 * = + - @ or a tab/return would run as a formula in Excel or LibreOffice).
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export class Reports {
  constructor(private db: Db) {}

  get enabled(): boolean {
    return getSetting(this.db, 'reports.enabled') === 'true';
  }

  setEnabled(on: boolean): void {
    setSetting(this.db, 'reports.enabled', on ? 'true' : 'false');
  }

  /** Records one event; refused while reports are off. */
  record(e: ReportEvent, user: User): void {
    if (!this.enabled) throw new ReportError('Usage reports are off on this site');
    if (e.kind !== 'scene-view' && e.kind !== 'module-complete')
      throw new ReportError('Unknown event');
    const id = (v: unknown) => (typeof v === 'string' && ID.test(v) ? v : null);
    const env = id(e.environmentId);
    if (!env) throw new ReportError('Unknown environment');
    if (e.kind === 'scene-view' && !id(e.sceneId))
      throw new ReportError('A scene view needs the scene');
    if (e.kind === 'module-complete' && !id(e.moduleId))
      throw new ReportError('A completion needs the module');
    const score =
      typeof e.score === 'number' && Number.isFinite(e.score)
        ? Math.max(0, Math.min(100, e.score))
        : null;
    this.db
      .prepare(
        `INSERT INTO events (at, kind, environment_id, user_id, scene_id, module_id, score, passed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(),
        e.kind,
        env,
        user.id,
        e.kind === 'scene-view' ? id(e.sceneId) : null,
        e.kind === 'module-complete' ? id(e.moduleId) : null,
        e.kind === 'module-complete' ? score : null,
        e.kind === 'module-complete' ? (e.passed ? 1 : 0) : null,
      );
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
  }

  /** CSV of events between two ISO dates (inclusive of `from`, exclusive of `to`). */
  csv(from = '0000', to = '9999'): string {
    const rows = this.db
      .prepare(
        `SELECT e.at, e.kind, e.environment_id, env.title, u.username, u.display_name, e.scene_id,
                e.module_id, e.score, e.passed
         FROM events e LEFT JOIN users u ON u.id = e.user_id
         LEFT JOIN environments env ON env.id = e.environment_id
         WHERE e.at >= ? AND e.at < ? ORDER BY e.at`,
      )
      .all(from, to) as Record<string, string | number | null>[];
    const header = [
      'time',
      'event',
      'environment_id',
      'environment',
      'username',
      'name',
      'scene',
      'module',
      'score',
      'passed',
    ];
    const lines = rows.map((r) => {
      let title = '';
      try {
        const t = JSON.parse(String(r.title ?? '{}')) as Record<string, string>;
        title = t.en ?? Object.values(t)[0] ?? '';
      } catch {
        // an environment removed since: its id is still in the row
      }
      return [
        r.at,
        r.kind,
        r.environment_id,
        title,
        r.username,
        r.display_name,
        r.scene_id,
        r.module_id,
        r.score,
        r.passed === null ? '' : r.passed ? 'yes' : 'no',
      ]
        .map(csvCell)
        .join(',');
    });
    // UTF-8 byte-order mark so Excel reads accented names correctly.
    return `\uFEFF${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
  }

  /** Deletes every recorded event (the administrator's "clear reports"). */
  clear(): void {
    this.db.prepare('DELETE FROM events').run();
  }
}
