/**
 * Shared notes pinned in scenes: a direction (yaw, pitch) in one scene of one
 * environment, with a category, a title and text, a status, an assignee, a thread of
 * replies and photos. Text is stored and served as plain text; the pages render it as
 * text, never as HTML.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { User } from './accounts.ts';
import { tx, type Db } from './db.ts';
import { cleanPhoto } from './photos.ts';

export const CATEGORIES = [
  'hazard',
  'maintenance',
  'safety-equipment',
  'question',
  'general',
] as const;
export const STATUSES = ['open', 'in-progress', 'resolved'] as const;
export type Category = (typeof CATEGORIES)[number];
export type Status = (typeof STATUSES)[number];

const LIMITS = { title: 120, body: 4000 };

export interface Person {
  id: string;
  name: string;
}
export interface Photo {
  id: string;
  type: string;
  size: number;
  replyId: string | null;
}
export interface Reply {
  id: string;
  author: Person;
  body: string;
  createdAt: string;
}
export interface Note {
  id: string;
  environmentId: string;
  sceneId: string;
  yaw: number;
  pitch: number;
  category: Category;
  title: string;
  body: string;
  status: Status;
  assignee: Person | null;
  author: Person;
  createdAt: string;
  updatedAt: string;
  replies: Reply[];
  photos: Photo[];
}

export class NoteError extends Error {
  override name = 'NoteError';
  constructor(
    readonly code: 'invalid' | 'not-found' | 'forbidden',
    message: string,
  ) {
    super(message);
  }
}

/** Plain text, trimmed, control characters other than newlines and tabs removed. */
function text(v: unknown, max: number, what: string, required: boolean): string {
  const s = typeof v === 'string' ? v.replace(/[^\P{Cc}\n\t]/gu, '').trim() : '';
  if (required && !s) throw new NoteError('invalid', `${what} is required`);
  if (s.length > max) throw new NoteError('invalid', `${what} is longer than ${max} characters`);
  return s;
}

function angle(v: unknown, lo: number, hi: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi)
    throw new NoteError('invalid', `${what} must be between ${lo} and ${hi}`);
  return Math.round(v * 100) / 100;
}

interface NoteRow {
  id: string;
  environment_id: string;
  scene_id: string;
  yaw: number;
  pitch: number;
  category: Category;
  title: string;
  body: string;
  status: Status;
  assignee_id: string | null;
  assignee_name: string | null;
  author_id: string;
  author_name: string;
  created_at: string;
  updated_at: string;
}

export class Notes {
  private photoDir: string;
  constructor(
    private db: Db,
    dataDir: string,
    private maxPhotoBytes: number,
  ) {
    this.photoDir = join(dataDir, 'photos');
  }

  private rows(where: string, ...args: (string | number)[]): NoteRow[] {
    return this.db
      .prepare(
        `SELECT n.*, a.display_name AS author_name, s.display_name AS assignee_name
         FROM notes n JOIN users a ON a.id = n.author_id LEFT JOIN users s ON s.id = n.assignee_id
         WHERE ${where} ORDER BY n.created_at`,
      )
      .all(...args) as unknown as NoteRow[];
  }

  private assemble(rows: NoteRow[]): Note[] {
    return rows.map((r) => ({
      id: r.id,
      environmentId: r.environment_id,
      sceneId: r.scene_id,
      yaw: r.yaw,
      pitch: r.pitch,
      category: r.category,
      title: r.title,
      body: r.body,
      status: r.status,
      assignee: r.assignee_id ? { id: r.assignee_id, name: r.assignee_name ?? '' } : null,
      author: { id: r.author_id, name: r.author_name },
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      replies: (
        this.db
          .prepare(
            `SELECT r.id, r.body, r.created_at, u.id AS uid, u.display_name AS uname
             FROM replies r JOIN users u ON u.id = r.author_id WHERE r.note_id = ? ORDER BY r.created_at`,
          )
          .all(r.id) as {
          id: string;
          body: string;
          created_at: string;
          uid: string;
          uname: string;
        }[]
      ).map((x) => ({
        id: x.id,
        body: x.body,
        createdAt: x.created_at,
        author: { id: x.uid, name: x.uname },
      })),
      photos: (
        this.db
          .prepare(
            'SELECT id, mime, size, reply_id FROM photos WHERE note_id = ? ORDER BY created_at',
          )
          .all(r.id) as { id: string; mime: string; size: number; reply_id: string | null }[]
      ).map((p) => ({ id: p.id, type: p.mime, size: p.size, replyId: p.reply_id })),
    }));
  }

  list(environmentId: string): Note[] {
    return this.assemble(this.rows('n.environment_id = ?', environmentId));
  }

  get(id: string): Note {
    const n = this.assemble(this.rows('n.id = ?', id))[0];
    if (!n) throw new NoteError('not-found', 'No such note');
    return n;
  }

  private assigneeId(v: unknown): string | null {
    if (v === null || v === undefined || v === '') return null;
    if (
      typeof v !== 'string' ||
      !this.db.prepare('SELECT 1 FROM users WHERE id = ? AND disabled = 0').get(v)
    )
      throw new NoteError('invalid', 'The assignee is not a user of this site');
    return v;
  }

  create(environmentId: string, author: User, input: Record<string, unknown>): Note {
    const category = input.category ?? 'general';
    if (!CATEGORIES.includes(category as Category))
      throw new NoteError('invalid', 'Unknown category');
    const sceneId = text(input.sceneId, 200, 'The scene', true);
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO notes (id, environment_id, scene_id, yaw, pitch, category, title, body, status,
           assignee_id, author_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      )
      .run(
        id,
        environmentId,
        sceneId,
        angle(input.yaw, -360, 360, 'yaw'),
        angle(input.pitch, -90, 90, 'pitch'),
        category as string,
        text(input.title, LIMITS.title, 'The title', true),
        text(input.body, LIMITS.body, 'The text', false),
        this.assigneeId(input.assigneeId),
        author.id,
        now,
        now,
      );
    return this.get(id);
  }

  /**
   * Status, assignee and category: anyone on the site (shared work). Title, text and
   * position: the author or an administrator.
   */
  update(id: string, user: User, patch: Record<string, unknown>): Note {
    const n = this.get(id);
    const own = n.author.id === user.id || user.role === 'admin';
    const sets: string[] = [];
    const args: (string | number | null)[] = [];
    if (patch.status !== undefined) {
      if (!STATUSES.includes(patch.status as Status))
        throw new NoteError('invalid', 'Unknown status');
      sets.push('status = ?');
      args.push(patch.status as string);
    }
    if (patch.category !== undefined) {
      if (!CATEGORIES.includes(patch.category as Category))
        throw new NoteError('invalid', 'Unknown category');
      sets.push('category = ?');
      args.push(patch.category as string);
    }
    if ('assigneeId' in patch) {
      sets.push('assignee_id = ?');
      args.push(this.assigneeId(patch.assigneeId));
    }
    for (const [key, column, check] of [
      ['title', 'title', () => text(patch.title, LIMITS.title, 'The title', true)],
      ['body', 'body', () => text(patch.body, LIMITS.body, 'The text', false)],
      ['yaw', 'yaw', () => angle(patch.yaw, -360, 360, 'yaw')],
      ['pitch', 'pitch', () => angle(patch.pitch, -90, 90, 'pitch')],
    ] as const) {
      if (patch[key] === undefined) continue;
      if (!own)
        throw new NoteError('forbidden', 'Only the author or an administrator can change this');
      sets.push(`${column} = ?`);
      args.push(check());
    }
    if (!sets.length) return n;
    sets.push('updated_at = ?');
    args.push(new Date().toISOString());
    this.db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    return this.get(id);
  }

  async remove(id: string, user: User): Promise<Note> {
    const n = this.get(id);
    if (n.author.id !== user.id && user.role !== 'admin')
      throw new NoteError('forbidden', 'Only the author or an administrator can delete a note');
    this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    for (const p of n.photos) await rm(join(this.photoDir, p.id), { force: true });
    return n;
  }

  reply(id: string, author: User, body: unknown): Note {
    this.get(id);
    const now = new Date().toISOString();
    tx(this.db, () => {
      this.db
        .prepare(
          'INSERT INTO replies (id, note_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), id, author.id, text(body, LIMITS.body, 'The reply', true), now);
      this.db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(now, id);
    });
    return this.get(id);
  }

  async addPhoto(
    id: string,
    author: User,
    bytes: Buffer,
    replyId: string | null = null,
  ): Promise<Note> {
    const n = this.get(id);
    if (bytes.length > this.maxPhotoBytes) throw new NoteError('invalid', 'The photo is too large');
    if (replyId && !n.replies.some((r) => r.id === replyId))
      throw new NoteError('invalid', 'No such reply');
    let clean;
    try {
      clean = cleanPhoto(bytes);
    } catch (e) {
      throw new NoteError('invalid', (e as Error).message);
    }
    const photoId = randomUUID();
    await mkdir(this.photoDir, { recursive: true });
    await writeFile(join(this.photoDir, photoId), clean.data, { mode: 0o600 });
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO photos (id, note_id, reply_id, mime, size, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(photoId, id, replyId, clean.type, clean.data.length, author.id, now);
    this.db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(now, id);
    return this.get(id);
  }

  async photo(
    photoId: string,
  ): Promise<{ type: string; data: Buffer; environmentId: string } | null> {
    const r = this.db
      .prepare(
        'SELECT p.mime, n.environment_id FROM photos p JOIN notes n ON n.id = p.note_id WHERE p.id = ?',
      )
      .get(photoId) as { mime: string; environment_id: string } | undefined;
    if (!r) return null;
    return {
      type: r.mime,
      environmentId: r.environment_id,
      data: await readFile(join(this.photoDir, photoId)),
    };
  }
}
