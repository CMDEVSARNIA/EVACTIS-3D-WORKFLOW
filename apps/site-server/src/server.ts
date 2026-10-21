/**
 * The Site Server's HTTP side (Fastify over HTTPS): pages, the JSON API and the live
 * WebSocket. Every request must come from the site's network; API writes need the
 * `X-EVX` header (a cross-site page cannot send it without CORS, which is never enabled)
 * and a same-origin Origin; sign-in uses an HttpOnly, Secure, SameSite=Strict cookie.
 * Nothing here makes an outbound connection except the directory sign-in (ldap.ts),
 * which is checked to be on the site's network.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { WebSocketServer } from 'ws';
import { AccountError, Accounts, Throttle, type Role, type User } from './accounts.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { Environments, UploadError } from './environments.ts';
import { Networks } from './lan.ts';
import { Directory, LdapError } from './ldap.ts';
import { Live } from './live.ts';
import { CATEGORIES, NoteError, Notes, STATUSES } from './notes.ts';
import { ReportError, Reports } from './reports.ts';
import { turnCredentials } from './turn.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

/** The built pages and their files (from disk, or embedded in the standalone binary). */
export interface WebFiles {
  read(path: string): Buffer | null;
}

export interface ServerDeps {
  config: Config;
  db: Db;
  tls: { cert: string; key: string } | null;
  /** The local authority's certificate, offered at /ca.pem for IT to install. */
  caPem: string | null;
  web: WebFiles;
  turn: { secret: Buffer; port: number; realm: string };
  /** One-time code for creating the first administrator (null once one exists). */
  setupCode: string | null;
  log?: boolean;
  /** Write the log to this file instead of standard output (when run as a scheduled task). */
  logFile?: string;
}

export const COOKIE = 'evx_session';

/** CSP for the server's own pages: same-origin only; WebRTC media and blob URLs allowed. */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: mediastream:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  woff2: 'font/woff2',
  json: 'application/json',
  ico: 'image/x-icon',
};

function cookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
  ) {
    super(message);
  }
}

export async function createServer(d: ServerDeps): Promise<{
  app: FastifyInstance;
  live: Live;
  accounts: Accounts;
  reports: Reports;
  close(): Promise<void>;
}> {
  const { config, db } = d;
  const networks = new Networks(config.allowedNetworks);
  const accounts = new Accounts(db);
  const envs = new Environments(db, config.dataDir);
  const notes = new Notes(db, config.dataDir, config.maxPhotoMB * 1024 * 1024);
  const reports = new Reports(db);
  const directory = config.ldap ? new Directory(config.ldap, networks) : null;
  const throttle = new Throttle();
  let setupCode = d.setupCode;
  const live = new Live((_u, env) => !!envs.get(env));

  const app = Fastify({
    ...(d.tls
      ? { https: { cert: d.tls.cert, key: d.tls.key, minVersion: 'TLSv1.2' as const } }
      : {}),
    logger:
      d.log === false
        ? false
        : {
            level: 'info',
            redact: ['req.headers.cookie', 'req.headers.authorization'],
            ...(d.logFile ? { file: d.logFile } : {}),
          },
    bodyLimit: 1024 * 1024,
    trustProxy: false,
    requestTimeout: 10 * 60_000,
  });
  app.decorateRequest('user', null);

  // Uploads: environment packages are streamed to disk; photos are read whole (bounded).
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) =>
    done(null, payload),
  );
  app.addContentTypeParser(
    ['image/jpeg', 'image/png', 'image/webp'],
    { parseAs: 'buffer', bodyLimit: config.maxPhotoMB * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

  // ---------------------------------------------------------------- every request
  app.addHook('onRequest', async (req, reply) => {
    if (!networks.contains(req.socket.remoteAddress)) {
      req.log.warn({ from: req.socket.remoteAddress }, 'refused: not on the site network');
      return reply.code(403).send({ error: 'This server answers only its own network' });
    }
    reply.headers({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
      'permissions-policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',
      'cache-control': 'no-store',
      ...(d.tls ? { 'strict-transport-security': 'max-age=31536000' } : {}),
    });
    req.user = accounts.session(cookie(req.headers.cookie, COOKIE), config.sessionHours);
    if (req.url.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method)) {
      const origin = req.headers.origin;
      if (req.headers['x-evx'] !== '1' || (origin && new URL(origin).host !== req.headers.host))
        return reply.code(403).send({ error: 'Cross-site request refused' });
    }
  });

  app.setErrorHandler((e, req, reply) => {
    if (e instanceof HttpError)
      return reply.code(e.status).send({ error: e.message, code: e.code });
    if (e instanceof AccountError)
      return reply
        .code(e.code === 'not-found' ? 404 : 400)
        .send({ error: e.message, code: e.code });
    if (e instanceof NoteError)
      return reply
        .code({ invalid: 400, 'not-found': 404, forbidden: 403 }[e.code])
        .send({ error: e.message, code: e.code });
    if (e instanceof UploadError)
      return reply.code(422).send({ error: e.message, code: 'invalid-package' });
    if (e instanceof ReportError)
      return reply.code(409).send({ error: e.message, code: 'reports' });
    const status = (e as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (e as Error).message });
    req.log.error(e);
    return reply.code(500).send({ error: 'Internal error' });
  });

  const need = (req: FastifyRequest, role: Role = 'member'): User => {
    if (!req.user) throw new HttpError(401, 'Sign in first', 'signed-out');
    if (role === 'admin' && req.user.role !== 'admin')
      throw new HttpError(403, 'Administrators only', 'forbidden');
    return req.user;
  };
  const env = (id: string) => {
    const e = envs.get(id);
    if (!e) throw new HttpError(404, 'No such environment', 'not-found');
    return e;
  };
  const setCookie = (reply: FastifyReply, token: string, maxAge: number) =>
    reply.header(
      'set-cookie',
      `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${d.tls ? '; Secure' : ''}`,
    );
  const publicUser = (u: User) => ({
    id: u.id,
    username: u.username,
    name: u.displayName,
    role: u.role,
    source: u.source,
  });

  // ---------------------------------------------------------------- site and sign-in
  app.get('/health', async () => ({ ok: true }));
  app.get('/ca.pem', async (_req, reply) => {
    if (!d.caPem) throw new HttpError(404, 'This site uses its own certificate');
    return reply
      .type('application/x-pem-file')
      .header('content-disposition', 'attachment; filename="evactis-3dworkflow-site-ca.pem"')
      .send(d.caPem);
  });

  app.get('/api/site', async (req) => ({
    siteName: config.siteName,
    user: req.user ? publicUser(req.user) : null,
    setup: setupCode !== null && accounts.count() === 0,
    directory: !!directory,
    reports: reports.enabled,
    categories: CATEGORIES,
    statuses: STATUSES,
  }));

  app.post('/api/setup', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, string>;
    if (!setupCode || accounts.count() > 0) throw new HttpError(409, 'This site is already set up');
    const given = String(b.code ?? '')
      .replace(/[\s-]/g, '')
      .toUpperCase();
    if (given !== setupCode.replace(/-/g, ''))
      throw new HttpError(403, 'Wrong setup code', 'setup-code');
    const user = await accounts.createLocal(
      String(b.username ?? ''),
      String(b.displayName ?? ''),
      'admin',
      String(b.password ?? ''),
    );
    setupCode = null;
    setCookie(
      reply,
      accounts.startSession(user.id, config.sessionHours),
      config.sessionHours * 3600,
    );
    return publicUser(user);
  });

  app.post('/api/login', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, string>;
    const username = String(b.username ?? '').trim();
    const password = String(b.password ?? '');
    const key = `${req.socket.remoteAddress}|${username.toLowerCase()}`;
    if (throttle.blocked(key))
      throw new HttpError(429, 'Too many attempts; try again in 15 minutes', 'throttled');
    let user = await accounts.checkLocal(username, password);
    if (!user && directory && accounts.byName(username)?.source !== 'local') {
      try {
        const found = await directory.authenticate(username, password);
        if (found) user = accounts.upsertLdap(found.username, found.displayName, found.role);
      } catch (e) {
        if (e instanceof LdapError) throw new HttpError(403, e.message, 'directory');
        req.log.error(e, 'directory sign-in failed');
        throw new HttpError(502, 'The directory did not answer', 'directory');
      }
      if (user?.disabled) user = null;
    }
    if (!user) {
      throttle.fail(key);
      throw new HttpError(401, 'Wrong username or password', 'credentials');
    }
    throttle.clear(key);
    setCookie(
      reply,
      accounts.startSession(user.id, config.sessionHours),
      config.sessionHours * 3600,
    );
    return publicUser(user);
  });

  app.post('/api/logout', async (req, reply) => {
    const token = cookie(req.headers.cookie, COOKIE);
    if (token) accounts.endSession(token);
    setCookie(reply, '', 0);
    return { ok: true };
  });

  // ---------------------------------------------------------------- users
  app.get('/api/users', async (req) => {
    const me = need(req);
    const all = accounts.list().filter((u) => me.role === 'admin' || !u.disabled);
    return me.role === 'admin'
      ? all.map((u) => ({ ...publicUser(u), disabled: u.disabled }))
      : all.map((u) => ({ id: u.id, name: u.displayName }));
  });
  app.post('/api/users', async (req) => {
    need(req, 'admin');
    const b = (req.body ?? {}) as Record<string, string>;
    const role = b.role === 'admin' ? 'admin' : 'member';
    return publicUser(
      await accounts.createLocal(
        String(b.username ?? ''),
        String(b.displayName ?? ''),
        role,
        String(b.password ?? ''),
      ),
    );
  });
  app.patch('/api/users/:id', async (req) => {
    const me = need(req, 'admin');
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { displayName?: string; role?: string; disabled?: boolean };
    if (id === me.id && (b.disabled || b.role === 'member'))
      throw new HttpError(400, 'You cannot lock yourself out');
    const u = accounts.update(id, {
      displayName: b.displayName,
      role: b.role === 'admin' || b.role === 'member' ? b.role : undefined,
      disabled: typeof b.disabled === 'boolean' ? b.disabled : undefined,
    });
    if (u.disabled) live.disconnectUser(u.id);
    return { ...publicUser(u), disabled: u.disabled };
  });
  app.post('/api/users/:id/password', async (req) => {
    const me = need(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { password?: string; current?: string };
    if (me.role !== 'admin' || id === me.id) {
      if (id !== me.id) throw new HttpError(403, 'Administrators only', 'forbidden');
      if (!(await accounts.checkLocal(me.username, String(b.current ?? ''))))
        throw new HttpError(403, 'The current password is wrong', 'credentials');
    }
    await accounts.setPassword(id, String(b.password ?? ''));
    return { ok: true };
  });

  // ---------------------------------------------------------------- environments
  app.get('/api/environments', async (req) => {
    need(req);
    return envs.list();
  });
  app.put('/api/environments', async (req) => {
    const me = need(req, 'admin');
    if (!req.headers['content-type']?.startsWith('application/octet-stream'))
      throw new HttpError(415, 'Send the .evx file as application/octet-stream');
    return envs.add(req.body as Duplex, config.maxUploadMB * 1024 * 1024, me.id);
  });
  app.delete('/api/environments/:id', async (req) => {
    need(req, 'admin');
    const { id } = req.params as { id: string };
    if (!(await envs.remove(id))) throw new HttpError(404, 'No such environment', 'not-found');
    return { ok: true };
  });
  app.get('/api/environments/:id/files/*', async (req, reply) => {
    need(req);
    const { id, '*': path } = req.params as { id: string; '*': string };
    env(id);
    const bytes = await envs.read(id, decodeURIComponent(path));
    if (!bytes) throw new HttpError(404, 'No such file', 'not-found');
    // Opaque bytes: the page checks and decodes them; nothing from a package runs here.
    return reply
      .type('application/octet-stream')
      .header('content-security-policy', 'sandbox; default-src none')
      .header('content-disposition', 'attachment')
      .header('cache-control', 'private, no-cache')
      .send(bytes);
  });

  // ---------------------------------------------------------------- notes
  app.get('/api/environments/:id/notes', async (req) => {
    need(req);
    const { id } = req.params as { id: string };
    env(id);
    return notes.list(id);
  });
  app.post('/api/environments/:id/notes', async (req) => {
    const me = need(req);
    const { id } = req.params as { id: string };
    env(id);
    const n = notes.create(id, me, (req.body ?? {}) as Record<string, unknown>);
    live.broadcast(id, { t: 'note', action: 'saved', note: n });
    return n;
  });
  app.patch('/api/notes/:id', async (req) => {
    const me = need(req);
    const n = notes.update(
      (req.params as { id: string }).id,
      me,
      (req.body ?? {}) as Record<string, unknown>,
    );
    live.broadcast(n.environmentId, { t: 'note', action: 'saved', note: n });
    return n;
  });
  app.delete('/api/notes/:id', async (req) => {
    const me = need(req);
    const n = await notes.remove((req.params as { id: string }).id, me);
    live.broadcast(n.environmentId, { t: 'note', action: 'deleted', id: n.id });
    return { ok: true };
  });
  app.post('/api/notes/:id/replies', async (req) => {
    const me = need(req);
    const n = notes.reply(
      (req.params as { id: string }).id,
      me,
      ((req.body ?? {}) as { body?: unknown }).body,
    );
    live.broadcast(n.environmentId, { t: 'note', action: 'saved', note: n });
    return n;
  });
  app.put('/api/notes/:id/photos', async (req) => {
    const me = need(req);
    if (!Buffer.isBuffer(req.body)) throw new HttpError(415, 'Send a JPEG, PNG or WebP photo');
    const replyId = (req.query as { reply?: string }).reply ?? null;
    const n = await notes.addPhoto((req.params as { id: string }).id, me, req.body, replyId);
    live.broadcast(n.environmentId, { t: 'note', action: 'saved', note: n });
    return n;
  });
  app.get('/api/photos/:id', async (req, reply) => {
    need(req);
    const p = await notes.photo((req.params as { id: string }).id);
    if (!p) throw new HttpError(404, 'No such photo', 'not-found');
    return reply
      .type(p.type)
      .header('content-security-policy', 'sandbox; default-src none')
      .header('cache-control', 'private, max-age=3600')
      .send(p.data);
  });

  // ---------------------------------------------------------------- guided sessions
  app.get('/api/ice', async (req) => {
    const me = need(req);
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    const { username, credential } = turnCredentials(d.turn.secret, me.id);
    const at = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    // The site's own relay only: no public STUN or TURN server, ever.
    return {
      iceServers: [{ urls: [`turn:${at}:${d.turn.port}?transport=udp`], username, credential }],
    };
  });
  app.get('/api/environments/:id/sessions', async (req) => {
    need(req);
    const { id } = req.params as { id: string };
    env(id);
    return live.listSessions(id);
  });

  // ---------------------------------------------------------------- reports
  app.post('/api/reports/events', async (req, reply) => {
    const me = need(req);
    reports.record((req.body ?? {}) as never, me);
    return reply.code(204).send();
  });
  app.get('/api/admin/reports', async (req) => {
    need(req, 'admin');
    return { enabled: reports.enabled, events: reports.count() };
  });
  app.put('/api/admin/reports', async (req) => {
    need(req, 'admin');
    reports.setEnabled(((req.body ?? {}) as { enabled?: unknown }).enabled === true);
    return { enabled: reports.enabled, events: reports.count() };
  });
  app.delete('/api/admin/reports', async (req) => {
    need(req, 'admin');
    reports.clear();
    return { enabled: reports.enabled, events: 0 };
  });
  app.get('/api/admin/reports.csv', async (req, reply) => {
    need(req, 'admin');
    const q = req.query as { from?: string; to?: string };
    const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    return reply
      .type('text/csv; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="usage-${new Date().toISOString().slice(0, 10)}.csv"`,
      )
      .send(reports.csv(date(q.from), date(q.to)));
  });

  // ---------------------------------------------------------------- pages
  const page = (file: string) => async (_req: FastifyRequest, reply: FastifyReply) => {
    const html = d.web.read(file);
    if (!html) throw new HttpError(404, 'The site pages are missing from this build');
    return reply.type(TYPES.html!).header('content-security-policy', PAGE_CSP).send(html);
  };
  app.get('/', page('index.html'));
  app.get('/admin', page('admin.html'));
  app.get('/view/:id', page('view.html'));
  app.get('/assets/*', async (req, reply) => {
    const path = (req.params as { '*': string })['*'];
    if (path.includes('..')) throw new HttpError(404, 'Not found');
    const bytes = d.web.read(`assets/${path}`);
    if (!bytes) throw new HttpError(404, 'Not found');
    const ext = /\.([a-z0-9]+)$/.exec(path)?.[1] ?? '';
    return reply
      .type(TYPES[ext] ?? 'application/octet-stream')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .send(bytes);
  });

  // ---------------------------------------------------------------- live channel
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  app.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const refuse = (code: number) => {
      socket.write(`HTTP/1.1 ${code} Refused\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!networks.contains(req.socket.remoteAddress)) return refuse(403);
    if ((req.url ?? '').split('?')[0] !== '/live') return refuse(404);
    const origin = req.headers.origin;
    if (!origin || new URL(origin).host !== req.headers.host) return refuse(403);
    const user = accounts.session(cookie(req.headers.cookie, COOKIE), config.sessionHours);
    if (!user) return refuse(401);
    wss.handleUpgrade(req, socket, head, (ws) => live.attach(ws, user));
  });

  const purge = setInterval(() => accounts.purgeSessions(), 3_600_000);
  purge.unref();

  return {
    app,
    live,
    accounts,
    reports,
    async close() {
      clearInterval(purge);
      live.close();
      wss.close();
      await app.close();
      await envs.close();
    },
  };
}

/** The one-time first-administrator code, e.g. "K7Q2-M9XD-4RTA". */
export function newSetupCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(12);
  const chars = [...b].map((x) => alphabet[x % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** The TURN shared secret, derived per data folder so it survives restarts. */
export function turnSecret(stored: string): Buffer {
  return createHmac('sha256', 'evx-turn').update(stored).digest();
}
