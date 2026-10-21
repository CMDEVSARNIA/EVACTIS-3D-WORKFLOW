/**
 * Guided sessions in the viewer page. The host leads: their scene and view are sent to
 * every participant, whose viewer follows (unless they untick "Follow the host").
 * Everyone can talk and show their camera: WebRTC, browser to browser, through the
 * site's own TURN relay when needed (no public STUN or TURN server is ever configured).
 *
 * Connections are a full mesh (at most 8 people, server-enforced). For each pair, the
 * peer with the lower id makes the offer, so offers never collide; both sides keep one
 * audio and one video transceiver, and turning the microphone or camera on just
 * replaces the (silent) track, with no renegotiation.
 */
import type { Viewer } from '@evactis-3dworkflow/viewer/open-package';
import { api, type SiteUser } from './api.ts';
import { clear, h } from './dom.ts';
import type { LiveChannel, LiveMessage } from './live.ts';
import { field, say } from './shell.ts';
import type { Strings } from './strings.ts';

interface Member {
  peerId: string;
  userId: string;
  name: string;
  host: boolean;
  audio: boolean;
  video: boolean;
}
interface SessionInfo {
  id: string;
  title: string;
  host: string;
  members: Member[];
}
interface Peer {
  pc: RTCPeerConnection;
  audio: RTCRtpSender | null;
  video: RTCRtpSender | null;
  media: HTMLVideoElement;
  stream: MediaStream;
}

export class GuidedSessions {
  private me = '';
  private sessions: SessionInfo[] = [];
  private current: SessionInfo | null = null;
  private peers = new Map<string, Peer>();
  private local: { audio: MediaStreamTrack | null; video: MediaStreamTrack | null } = {
    audio: null,
    video: null,
  };
  private following = true;
  private ice: RTCConfiguration | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastNav = 0;
  private navTimer = 0;
  private off: (() => void)[] = [];
  private status: HTMLElement = h('p', {});
  private tiles: HTMLElement = h('div', { class: 'site-tiles' });

  constructor(
    private o: {
      viewer: Viewer;
      live: LiveChannel;
      panel: HTMLElement;
      t: Strings;
      user: SiteUser;
      /** Tests: relay candidates only (proves the TURN path). */
      relayOnly: boolean;
    },
  ) {
    const on = (t: string, fn: (m: LiveMessage) => void) => this.off.push(o.live.on(t, fn));
    on('hello', (m) => (this.me = String(m.peerId)));
    on('sessions', (m) => {
      this.sessions = m.sessions as SessionInfo[];
      if (!this.current) this.render();
    });
    on('session', (m) => {
      this.current = m.session as SessionInfo;
      this.me = String(m.you);
      this.serial(() => this.syncPeers());
      this.render();
    });
    on('member.joined', (m) => {
      if (!this.current) return;
      this.current.members.push(m.member as Member);
      this.serial(() => this.syncPeers());
      this.render();
    });
    on('member.left', (m) => {
      if (!this.current) return;
      this.current.members = this.current.members.filter((x) => x.peerId !== m.peerId);
      this.serial(async () => this.drop(String(m.peerId)));
      this.render();
    });
    on('session.ended', () => {
      this.stop();
      this.render();
      say(this.status, o.t.ended);
    });
    on('nav', (m) => void this.follow(m));
    on('signal', (m) =>
      this.serial(() => this.signal(String(m.from), m.data as Record<string, unknown>)),
    );
    on('error', (m) => say(this.status, String(m.message), true));
    const sendNav = () => this.sendNav();
    this.off.push(o.viewer.on('viewchange', sendNav), o.viewer.on('scenechange', sendNav));
    this.render();
  }

  private get hosting(): boolean {
    return !!this.current?.members.find((m) => m.peerId === this.me)?.host;
  }

  // ---------------------------------------------------------------- navigation
  private sendNav() {
    if (!this.hosting) return;
    const send = () => {
      this.lastNav = performance.now();
      const v = this.o.viewer.getView();
      this.o.live.send({
        t: 'nav',
        sceneId: this.o.viewer.sceneId,
        view: { yaw: v.yaw, pitch: v.pitch, fov: v.fov },
      });
    };
    // At most ~8 updates a second, and always the last position.
    const wait = 120 - (performance.now() - this.lastNav);
    clearTimeout(this.navTimer);
    if (wait <= 0) send();
    else this.navTimer = window.setTimeout(send, wait);
  }

  private async follow(m: LiveMessage) {
    if (!this.current || this.hosting || !this.following) return;
    const view = m.view as { yaw: number; pitch: number; fov: number };
    const sceneId = String(m.sceneId);
    if (this.o.viewer.sceneId !== sceneId)
      await this.o.viewer.goToScene(sceneId, { view, transition: { kind: 'cut' } });
    else this.o.viewer.setView(view);
  }

  // ---------------------------------------------------------------- WebRTC
  /**
   * Signals and membership changes are handled one at a time, in arrival order: an ICE
   * candidate must never overtake the offer it belongs to, and two messages arriving
   * together must not each create a connection to the same person.
   */
  private serial(work: () => Promise<void>) {
    this.queue = this.queue.then(work).catch(() => undefined);
  }

  private async config(): Promise<RTCConfiguration> {
    if (!this.ice) {
      const r = await api<{ iceServers: RTCIceServer[] }>('GET', '/api/ice');
      this.ice = {
        iceServers: r.iceServers,
        iceTransportPolicy: this.o.relayOnly ? 'relay' : 'all',
      };
    }
    return this.ice;
  }

  private async peer(id: string, offerer: boolean): Promise<Peer> {
    const config = await this.config();
    const existing = this.peers.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection(config);
    const stream = new MediaStream();
    const media = h('video', { autoplay: true, playsInline: true, 'data-peer': id });
    media.srcObject = stream;
    const p: Peer = { pc, audio: null, video: null, media, stream };
    this.peers.set(id, p);
    pc.ontrack = (e) => {
      stream.addTrack(e.track);
      void media.play().catch(() => undefined);
    };
    pc.onicecandidate = (e) =>
      e.candidate &&
      this.o.live.send({ t: 'signal', to: id, data: { candidate: e.candidate.toJSON() } });
    pc.onconnectionstatechange = () => this.render();
    if (offerer) {
      p.audio = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
      p.video = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
      await this.attachLocal(p);
      await pc.setLocalDescription();
      this.o.live.send({
        t: 'signal',
        to: id,
        data: { description: pc.localDescription!.toJSON() },
      });
    }
    return p;
  }

  private async attachLocal(p: Peer) {
    await p.audio?.replaceTrack(this.local.audio);
    await p.video?.replaceTrack(this.local.video);
  }

  /** One connection per other member; the lower id offers. */
  private async syncPeers() {
    if (!this.current) return;
    const others = this.current.members.filter((m) => m.peerId !== this.me);
    for (const m of others)
      if (!this.peers.has(m.peerId) && this.me < m.peerId) await this.peer(m.peerId, true);
    for (const id of this.peers.keys()) if (!others.some((m) => m.peerId === id)) this.drop(id);
  }

  private async signal(from: string, data: Record<string, unknown>) {
    if (!this.current) return;
    const p = await this.peer(from, false);
    if (data.description) {
      const d = data.description as RTCSessionDescriptionInit;
      await p.pc.setRemoteDescription(d);
      if (d.type === 'offer') {
        // Answer with our own audio and video on the offered transceivers.
        for (const tr of p.pc.getTransceivers()) {
          tr.direction = 'sendrecv';
          if (tr.receiver.track.kind === 'audio') p.audio = tr.sender;
          else p.video = tr.sender;
        }
        await this.attachLocal(p);
        await p.pc.setLocalDescription();
        this.o.live.send({
          t: 'signal',
          to: from,
          data: { description: p.pc.localDescription!.toJSON() },
        });
      }
    } else if (data.candidate) {
      await p.pc.addIceCandidate(data.candidate as RTCIceCandidateInit).catch(() => undefined);
    }
  }

  private drop(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    p.media.srcObject = null;
    this.peers.delete(id);
  }

  private async setMedia(kind: 'audio' | 'video', on: boolean) {
    try {
      if (on && !this.local[kind]) {
        const s = await navigator.mediaDevices.getUserMedia(
          kind === 'audio' ? { audio: true } : { video: { width: 640, height: 360 } },
        );
        this.local[kind] = s.getTracks()[0] ?? null;
      } else if (!on && this.local[kind]) {
        this.local[kind]!.stop();
        this.local[kind] = null;
      }
      for (const p of this.peers.values()) await this.attachLocal(p);
      this.o.live.send({ t: 'media', audio: !!this.local.audio, video: !!this.local.video });
    } catch {
      say(this.status, this.o.t.mediaRefused, true);
    }
    this.render();
  }

  private stop() {
    for (const id of [...this.peers.keys()]) this.drop(id);
    for (const k of ['audio', 'video'] as const) {
      this.local[k]?.stop();
      this.local[k] = null;
    }
    this.current = null;
  }

  /** For acceptance tests: each connection's state and the candidate types in use. */
  async stats(): Promise<
    { peer: string; state: string; local: string | null; remote: string | null; audioIn: number }[]
  > {
    const out = [];
    for (const [peer, p] of this.peers) {
      let local: string | null = null;
      let remote: string | null = null;
      let audioIn = 0;
      const report = await p.pc.getStats();
      const byId = new Map<string, Record<string, unknown>>();
      report.forEach((s: Record<string, unknown>) => byId.set(String(s.id), s));
      report.forEach((s: Record<string, unknown>) => {
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) {
          local = String(byId.get(String(s.localCandidateId))?.candidateType ?? '');
          remote = String(byId.get(String(s.remoteCandidateId))?.candidateType ?? '');
        }
        if (s.type === 'inbound-rtp' && s.kind === 'audio')
          audioIn += Number(s.packetsReceived ?? 0);
      });
      out.push({ peer, state: p.pc.connectionState, local, remote, audioIn });
    }
    return out;
  }

  // ---------------------------------------------------------------- panel
  render(): void {
    const { t } = this.o;
    const s = this.current;
    if (!s) {
      const title = h('input', { maxlength: 120, placeholder: this.o.user.name });
      clear(
        this.o.panel,
        this.sessions.length
          ? h(
              'ul',
              { class: 'site-notes', 'data-testid': 'session-list' },
              ...this.sessions.map((x) =>
                h(
                  'li',
                  { class: 'site-session-item' },
                  h('strong', {}, x.title),
                  h('span', { class: 'site-meta' }, `${t.host}: ${x.host} · ${x.members.length}`),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'evx-cta site-small',
                      onclick: () => this.o.live.send({ t: 'session.join', sessionId: x.id }),
                    },
                    t.join,
                  ),
                ),
              ),
            )
          : h('p', {}, t.noSessions),
        h(
          'form',
          {
            class: 'site-form',
            onsubmit: (e: Event) => {
              e.preventDefault();
              this.o.live.send({ t: 'session.start', title: title.value });
            },
          },
          field(t.sessionTitle, title),
          h('button', { type: 'submit', class: 'evx-cta site-small' }, t.startSession),
        ),
        this.status,
      );
      return;
    }
    const follow = h('input', { type: 'checkbox', checked: this.following, id: 'site-follow' });
    follow.addEventListener('change', () => (this.following = follow.checked));
    const toggle = (kind: 'audio' | 'video', label: string) => {
      const on = !!this.local[kind];
      return h(
        'button',
        {
          type: 'button',
          class: `evx-cta site-small ${on ? '' : 'evx-cta--ghost'}`,
          'aria-pressed': on ? 'true' : 'false',
          onclick: () => void this.setMedia(kind, !on),
        },
        `${label}: ${on ? t.on : t.off}`,
      );
    };
    const tiles = s.members
      .filter((m) => m.peerId !== this.me)
      .map((m) => {
        const p = this.peers.get(m.peerId);
        const state = p?.pc.connectionState ?? 'new';
        if (p) p.media.hidden = !m.video;
        return h(
          'li',
          { class: 'site-member', 'data-peer-state': state },
          h('strong', {}, m.name),
          m.host ? h('span', { class: 'site-meta' }, ` · ${t.host}`) : null,
          h(
            'span',
            { class: 'site-meta' },
            ` · ${state === 'connected' ? t.connected : state === 'failed' ? t.connectionFailed : t.connecting}`,
          ),
          p ? p.media : null,
        );
      });
    clear(
      this.o.panel,
      h('h3', { 'data-testid': 'session-title' }, s.title),
      this.hosting
        ? h('p', { class: 'site-meta' }, t.host)
        : h('label', { class: 'site-check', for: 'site-follow' }, follow, t.following),
      h('div', { class: 'site-row' }, toggle('audio', t.microphone), toggle('video', t.camera)),
      h('h4', {}, t.members),
      h('ul', { class: 'site-members', 'data-testid': 'session-members' }, ...tiles),
      h(
        'button',
        {
          type: 'button',
          class: 'evx-cta evx-cta--ghost site-small',
          onclick: () => {
            this.o.live.send({ t: 'session.leave' });
            this.stop();
            this.render();
          },
        },
        this.hosting ? t.end : t.leave,
      ),
      this.status,
    );
  }

  destroy(): void {
    for (const f of this.off) f();
    this.stop();
  }
}
