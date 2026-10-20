/**
 * Accounts and sign-in sessions. Local passwords are hashed with scrypt; LDAP/Active
 * Directory users (ldap.ts) get a local row (no password) for notes and assignments.
 * A sign-in session is a random token in an HttpOnly, Secure, SameSite=Strict cookie;
 * only its SHA-256 is stored, so a copy of the database signs nobody in.
 */
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from './db.ts';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const MIN_PASSWORD = 10;

export type Role = 'admin' | 'member';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  source: 'local' | 'ldap';
  disabled: boolean;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  source: 'local' | 'ldap';
  password_hash: string | null;
  disabled: number;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  role: r.role,
  source: r.source,
  disabled: !!r.disabled,
});

export class AccountError extends Error {
  override name = 'AccountError';
  constructor(
    readonly code: 'invalid' | 'exists' | 'weak-password' | 'not-found',
    message: string,
  ) {
    super(message);
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFC'), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = await scryptAsync(
    password.normalize('NFC'),
    Buffer.from(salt, 'base64'),
    expected.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    },
  );
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const USERNAME = /^[\p{L}\p{N}._@-]{1,64}$/u;

export class Accounts {
  constructor(private db: Db) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  list(): User[] {
    return (
      this.db.prepare('SELECT * FROM users ORDER BY username').all() as unknown as UserRow[]
    ).map(toUser);
  }

  get(id: string): User | null {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return r ? toUser(r) : null;
  }

  byName(username: string): (User & { passwordHash: string | null }) | null {
    const r = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | UserRow
      | undefined;
    return r ? { ...toUser(r), passwordHash: r.password_hash } : null;
  }

  async createLocal(
    username: string,
    displayName: string,
    role: Role,
    password: string,
  ): Promise<User> {
    const name = username.trim();
    if (!USERNAME.test(name))
      throw new AccountError('invalid', 'Usernames are letters, digits and . _ @ -');
    if (password.normalize('NFC').length < MIN_PASSWORD)
      throw new AccountError('weak-password', `Passwords need at least ${MIN_PASSWORD} characters`);
    if (this.byName(name)) throw new AccountError('exists', `${name} already exists`);
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO users (id, username, display_name, role, source, password_hash, created_at)
         VALUES (?, ?, ?, ?, 'local', ?, ?)`,
      )
      .run(
        id,
        name,
        displayName.trim() || name,
        role,
        await hashPassword(password),
        new Date().toISOString(),
      );
    return this.get(id)!;
  }

  /** The local row for a directory user, created or refreshed at each sign-in. */
  upsertLdap(username: string, displayName: string, role: Role): User {
    const existing = this.byName(username);
    if (existing && existing.source === 'local')
      throw new AccountError('exists', `${username} is a local account`);
    if (existing) {
      this.db
        .prepare('UPDATE users SET display_name = ?, role = ? WHERE id = ?')
        .run(displayName, role, existing.id);
      return this.get(existing.id)!;
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO users (id, username, display_name, role, source, created_at)
         VALUES (?, ?, ?, ?, 'ldap', ?)`,
      )
      .run(id, username, displayName || username, role, new Date().toISOString());
    return this.get(id)!;
  }

  update(id: string, patch: { displayName?: string; role?: Role; disabled?: boolean }): User {
    const u = this.get(id);
    if (!u) throw new AccountError('not-found', 'No such user');
    this.db
      .prepare('UPDATE users SET display_name = ?, role = ?, disabled = ? WHERE id = ?')
      .run(
        patch.displayName?.trim() || u.displayName,
        patch.role ?? u.role,
        (patch.disabled ?? u.disabled) ? 1 : 0,
        id,
      );
    if (patch.disabled) this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    return this.get(id)!;
  }

  async setPassword(id: string, password: string): Promise<void> {
    const u = this.get(id);
    if (!u || u.source !== 'local') throw new AccountError('not-found', 'No such local user');
    if (password.normalize('NFC').length < MIN_PASSWORD)
      throw new AccountError('weak-password', `Passwords need at least ${MIN_PASSWORD} characters`);
    this.db
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(await hashPassword(password), id);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }

  /** A local user with this password, or null. Same work whether or not the user exists. */
  async checkLocal(username: string, password: string): Promise<User | null> {
    const u = this.byName(username.trim());
    const ok = await verifyPassword(password, u?.passwordHash ?? DUMMY_HASH);
    return u && ok && u.source === 'local' && !u.disabled ? u : null;
  }

  // ---------------------------------------------------------------- sessions
  startSession(userId: string, hours: number): string {
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(sha256(token), userId, Date.now() + hours * 3_600_000);
    return token;
  }

  /** The signed-in user for a token, sliding its expiry; null when expired or disabled. */
  session(token: string | undefined, hours: number): User | null {
    if (!token) return null;
    const key = sha256(token);
    const r = this.db
      .prepare(
        `SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
      )
      .get(key) as (UserRow & { expires_at: number }) | undefined;
    if (!r || r.expires_at < Date.now() || r.disabled) {
      if (r) this.endSession(token);
      return null;
    }
    this.db
      .prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .run(Date.now() + hours * 3_600_000, key);
    return toUser(r);
  }

  endSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  purgeSessions(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
// Verified against when the user does not exist, so timing does not reveal usernames.
const DUMMY_HASH = `scrypt$${SCRYPT.N}$8$1$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(32).toString('base64')}`;

/**
 * Failed sign-ins per address and username: after 5 in 15 minutes, further attempts wait
 * until the window passes (no permanent lockout an attacker could trigger).
 */
export class Throttle {
  private failures = new Map<string, number[]>();
  constructor(
    private limit = 5,
    private windowMs = 15 * 60_000,
  ) {}
  private recent(key: string): number[] {
    const now = Date.now();
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.failures.set(key, list);
    return list;
  }
  blocked(key: string): boolean {
    return this.recent(key).length >= this.limit;
  }
  fail(key: string): void {
    this.recent(key).push(Date.now());
  }
  clear(key: string): void {
    this.failures.delete(key);
  }
}
