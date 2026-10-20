/**
 * Storage: one SQLite file in the data folder (node:sqlite, built into Node; no native
 * module to install). Every statement is parameterised. Migrations run in order on open.
 */
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     display_name TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
     source TEXT NOT NULL CHECK (source IN ('local', 'ldap')),
     password_hash TEXT,
     disabled INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at INTEGER NOT NULL
   );
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE environments (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     file TEXT NOT NULL,
     size INTEGER NOT NULL,
     encrypted INTEGER NOT NULL,
     digest TEXT NOT NULL,
     uploaded_by TEXT NOT NULL,
     uploaded_at TEXT NOT NULL
   );
   CREATE TABLE notes (
     id TEXT PRIMARY KEY,
     environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
     scene_id TEXT NOT NULL,
     yaw REAL NOT NULL,
     pitch REAL NOT NULL,
     category TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('open', 'in-progress', 'resolved')),
     assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
     author_id TEXT NOT NULL REFERENCES users(id),
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX notes_environment ON notes(environment_id, scene_id);
   CREATE TABLE replies (
     id TEXT PRIMARY KEY,
     note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
     author_id TEXT NOT NULL REFERENCES users(id),
     body TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE photos (
     id TEXT PRIMARY KEY,
     note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
     reply_id TEXT REFERENCES replies(id) ON DELETE CASCADE,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     author_id TEXT NOT NULL REFERENCES users(id),
     created_at TEXT NOT NULL
   );
   CREATE TABLE events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('scene-view', 'module-complete')),
     environment_id TEXT NOT NULL,
     user_id TEXT,
     scene_id TEXT,
     module_id TEXT,
     score REAL,
     passed INTEGER
   );
   CREATE INDEX events_at ON events(at);`,
];

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as
    | { version: number }
    | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  for (; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]!);
      db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

export function getSetting(db: Db, key: string): string | null {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return r?.value ?? null;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

/** Runs `fn` in one transaction. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
