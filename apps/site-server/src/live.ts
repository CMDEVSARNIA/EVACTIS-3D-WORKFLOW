/**
 * The live channel (one WebSocket per open page, same origin, signed-in users only):
 * note changes pushed to everyone viewing an environment, and guided sessions. In a
 * session the host's navigation (scene and view) is sent to every participant, and the
 * server passes WebRTC offers, answers and candidates between participants (signalling).
 * Audio and video go browser to browser, through the site's own TURN relay when needed.
 * Sessions live in memory: they end when the host leaves or the server restarts.
 */
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { User } from './accounts.ts';

export interface Member {
  peerId: string;
  userId: string;
  name: string;
  host: boolean;
  audio: boolean;
  video: boolean;
}

export interface SessionInfo {
  id: string;
  environmentId: string;
  title: string;
  host: string;
  startedAt: string;
  members: Member[];
}

interface Client {
  peerId: string;
  user: User;
  ws: WebSocket;
  environmentId: string | null;
  sessionId: string | null;
  audio: boolean;
  video: boolean;
  /** Messages in the current second (flood limit). */
  budget: { second: number; count: number };
}

interface Session {
  id: string;
  environmentId: string;
  title: string;
  hostPeer: string;
  startedAt: string;
  members: Set<string>;
  /** The host's last position, sent to whoever joins. */
  nav: unknown;
}

/** Most participants in one guided session (audio/video is a full mesh). */
export const MAX_MEMBERS = 8;
const MAX_PER_SECOND = 60;

type Incoming = Record<string, unknown> & { t?: unknown };

export class Live {
  private clients = new Map<string, Client>();
  private sessions = new Map<string, Session>();

  constructor(private canSee: (user: User, environmentId: string) => boolean) {}

  get sessionCount(): number {
    return this.sessions.size;
  }

  attach(ws: WebSocket, user: User): void {
    const c: Client = {
      peerId: randomUUID(),
      user,
      ws,
      environmentId: null,
      sessionId: null,
      audio: false,
      video: false,
      budget: { second: 0, count: 0 },
    };
    this.clients.set(c.peerId, c);
    this.send(c, { t: 'hello', peerId: c.peerId, user: { id: user.id, name: user.displayName } });
    ws.on('message', (raw, binary) => {
      if (binary) return ws.close(1003, 'text only');
      const second = Math.floor(Date.now() / 1000);
      if (c.budget.second !== second) c.budget = { second, count: 0 };
      if (++c.budget.count > MAX_PER_SECOND) return ws.close(1008, 'too many messages');
      let msg: Incoming;
      try {
        msg = JSON.parse(raw.toString()) as Incoming;
      } catch {
        return ws.close(1007, 'not JSON');
      }
      try {
        this.handle(c, msg);
      } catch (e) {
        this.send(c, { t: 'error', message: (e as Error).message });
      }
    });
    ws.on('close', () => {
      this.leave(c);
      this.clients.delete(c.peerId);
    });
  }

  /** Users removed or disabled lose their open pages too. */
  disconnectUser(userId: string): void {
    for (const c of this.clients.values()) if (c.user.id === userId) c.ws.close(1008, 'signed out');
  }

  private send(c: Client, msg: unknown) {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
  }

  /** Pushes an event to every page viewing an environment. */
  broadcast(environmentId: string, msg: unknown): void {
    for (const c of this.clients.values()) if (c.environmentId === environmentId) this.send(c, msg);
  }

  listSessions(environmentId: string): SessionInfo[] {
    return [...this.sessions.values()]
      .filter((s) => s.environmentId === environmentId)
      .map((s) => this.info(s));
  }

  private info(s: Session): SessionInfo {
    const members = [...s.members]
      .map((p) => this.clients.get(p))
      .filter((c): c is Client => !!c)
      .map((c) => ({
        peerId: c.peerId,
        userId: c.user.id,
        name: c.user.displayName,
        host: c.peerId === s.hostPeer,
        audio: c.audio,
        video: c.video,
      }));
    return {
      id: s.id,
      environmentId: s.environmentId,
      title: s.title,
      host: members.find((m) => m.host)?.name ?? '',
      startedAt: s.startedAt,
      members,
    };
  }

  private announceSessions(environmentId: string) {
    this.broadcast(environmentId, { t: 'sessions', sessions: this.listSessions(environmentId) });
  }

  private handle(c: Client, m: Incoming) {
    const str = (v: unknown, max = 200) => (typeof v === 'string' && v.length <= max ? v : null);
    switch (m.t) {
      case 'watch': {
        const env = str(m.environmentId);
        if (!env || !this.canSee(c.user, env)) throw new Error('No such environment');
        if (c.sessionId) this.leave(c);
        c.environmentId = env;
        this.send(c, { t: 'sessions', sessions: this.listSessions(env) });
        return;
      }
      case 'session.start': {
        if (!c.environmentId) throw new Error('Open an environment first');
        if (c.sessionId) this.leave(c);
        const s: Session = {
          id: randomUUID(),
          environmentId: c.environmentId,
          title: (str(m.title, 120) ?? '').trim() || `${c.user.displayName}`,
          hostPeer: c.peerId,
          startedAt: new Date().toISOString(),
          members: new Set([c.peerId]),
          nav: null,
        };
        this.sessions.set(s.id, s);
        c.sessionId = s.id;
        this.send(c, { t: 'session', session: this.info(s), you: c.peerId });
        this.announceSessions(s.environmentId);
        return;
      }
      case 'session.join': {
        const s = this.sessions.get(str(m.sessionId) ?? '');
        if (!s || s.environmentId !== c.environmentId) throw new Error('No such session');
        if (s.members.size >= MAX_MEMBERS)
          throw new Error(`A session holds at most ${MAX_MEMBERS} people`);
        if (c.sessionId) this.leave(c);
        s.members.add(c.peerId);
        c.sessionId = s.id;
        const info = this.info(s);
        this.send(c, { t: 'session', session: info, you: c.peerId });
        if (s.nav) this.send(c, { t: 'nav', ...(s.nav as object) });
        for (const p of s.members)
          if (p !== c.peerId)
            this.send(this.clients.get(p)!, {
              t: 'member.joined',
              member: info.members.find((x) => x.peerId === c.peerId),
            });
        this.announceSessions(s.environmentId);
        return;
      }
      case 'session.leave':
        return this.leave(c);
      case 'nav': {
        const s = c.sessionId ? this.sessions.get(c.sessionId) : null;
        if (!s || s.hostPeer !== c.peerId) throw new Error('Only the host leads the session');
        const scene = str(m.sceneId);
        const view = m.view as Record<string, unknown> | undefined;
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        if (
          !scene ||
          !view ||
          num(view.yaw) === null ||
          num(view.pitch) === null ||
          num(view.fov) === null
        )
          throw new Error('Bad navigation message');
        s.nav = { sceneId: scene, view: { yaw: view.yaw, pitch: view.pitch, fov: view.fov } };
        for (const p of s.members)
          if (p !== c.peerId) this.send(this.clients.get(p)!, { t: 'nav', ...(s.nav as object) });
        return;
      }
      case 'signal': {
        const s = c.sessionId ? this.sessions.get(c.sessionId) : null;
        const to = str(m.to);
        if (!s || !to || !s.members.has(to)) throw new Error('Not in this session');
        const data = m.data;
        if (JSON.stringify(data ?? null).length > 32_000) throw new Error('Signal too large');
        this.send(this.clients.get(to)!, { t: 'signal', from: c.peerId, data });
        return;
      }
      case 'media': {
        c.audio = m.audio === true;
        c.video = m.video === true;
        const s = c.sessionId ? this.sessions.get(c.sessionId) : null;
        if (s)
          for (const p of s.members)
            this.send(this.clients.get(p)!, { t: 'session', session: this.info(s), you: p });
        return;
      }
      default:
        throw new Error('Unknown message');
    }
  }

  private leave(c: Client) {
    const s = c.sessionId ? this.sessions.get(c.sessionId) : null;
    c.sessionId = null;
    if (!s) return;
    s.members.delete(c.peerId);
    if (s.hostPeer === c.peerId) {
      // The host left: the session ends for everyone.
      this.sessions.delete(s.id);
      for (const p of s.members) {
        const m = this.clients.get(p);
        if (m) {
          m.sessionId = null;
          this.send(m, { t: 'session.ended', sessionId: s.id });
        }
      }
    } else {
      for (const p of s.members)
        this.send(this.clients.get(p)!, { t: 'member.left', peerId: c.peerId });
    }
    this.announceSessions(s.environmentId);
  }

  close(): void {
    for (const c of this.clients.values()) c.ws.close(1001, 'server stopping');
  }
}
