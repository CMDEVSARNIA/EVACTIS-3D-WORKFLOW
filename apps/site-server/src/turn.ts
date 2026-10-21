/**
 * A TURN relay for guided sessions (RFC 8656 over UDP, with RFC 8489 STUN messages), so
 * browsers on the site's network reach each other's audio and video without any public
 * STUN or TURN server. It relays only to addresses on the site's network and answers only
 * clients there: it can never become a path to the internet.
 *
 * Credentials are short-lived (the "TURN REST" scheme): username `<expiry>:<user id>`,
 * password base64(HMAC-SHA1(secret, username)), issued to signed-in users by /api/ice.
 * Supported: Binding, Allocate, Refresh, CreatePermission, ChannelBind, Send/Data
 * indications and ChannelData. Not supported (refused): TCP relays, IPv6 relays, EVEN-PORT.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { isIP } from 'node:net';
import type { Networks } from './lan.ts';

const MAGIC = 0x2112a442;
const METHOD = {
  binding: 0x001,
  allocate: 0x003,
  refresh: 0x004,
  send: 0x006,
  data: 0x007,
  createPermission: 0x008,
  channelBind: 0x009,
};
const CLASS = { request: 0, indication: 1, success: 2, error: 3 };
const ATTR = {
  mappedAddress: 0x0001,
  username: 0x0006,
  messageIntegrity: 0x0008,
  errorCode: 0x0009,
  unknownAttributes: 0x000a,
  channelNumber: 0x000c,
  lifetime: 0x000d,
  xorPeerAddress: 0x0012,
  data: 0x0013,
  realm: 0x0014,
  nonce: 0x0015,
  xorRelayedAddress: 0x0016,
  requestedAddressFamily: 0x0017,
  evenPort: 0x0018,
  requestedTransport: 0x0019,
  dontFragment: 0x001a,
  xorMappedAddress: 0x0020,
  reservationToken: 0x0022,
  fingerprint: 0x8028,
};
/** Comprehension-required attributes this server understands (others get a 420). */
const KNOWN = new Set(Object.values(ATTR).filter((a) => a < 0x8000));

const PERMISSION_MS = 300_000;
const CHANNEL_MS = 600_000;
const DEFAULT_LIFETIME = 600;
const MAX_LIFETIME = 3600;
const NONCE_MS = 3_600_000;

// ---------------------------------------------------------------- messages
export interface Message {
  method: number;
  cls: number;
  transaction: Buffer;
  attrs: { type: number; value: Buffer; offset: number }[];
  raw: Buffer;
}

export function encodeType(method: number, cls: number): number {
  return (
    (method & 0x000f) |
    ((method & 0x0070) << 1) |
    ((method & 0x0f80) << 2) |
    ((cls & 1) << 4) |
    ((cls & 2) << 7)
  );
}

export function parse(b: Buffer): Message | null {
  if (b.length < 20 || (b[0]! & 0xc0) !== 0 || b.readUInt32BE(4) !== MAGIC) return null;
  const type = b.readUInt16BE(0);
  const length = b.readUInt16BE(2);
  if (length % 4 !== 0 || 20 + length > b.length) return null;
  const method = (type & 0x000f) | ((type & 0x00e0) >> 1) | ((type & 0x3e00) >> 2);
  const cls = ((type & 0x0010) >> 4) | ((type & 0x0100) >> 7);
  const attrs: Message['attrs'] = [];
  let at = 20;
  while (at + 4 <= 20 + length) {
    const t = b.readUInt16BE(at);
    const l = b.readUInt16BE(at + 2);
    if (at + 4 + l > 20 + length) return null;
    attrs.push({ type: t, value: b.subarray(at + 4, at + 4 + l), offset: at });
    at += 4 + l + ((4 - (l % 4)) % 4);
  }
  return { method, cls, transaction: b.subarray(8, 20), attrs, raw: b.subarray(0, 20 + length) };
}

const attr = (m: Message, type: number) => m.attrs.find((a) => a.type === type)?.value;

export function xorAddress(v: Buffer): { address: string; port: number } | null {
  if (v.length < 8) return null;
  const family = v[1];
  const port = v.readUInt16BE(2) ^ (MAGIC >>> 16);
  if (family === 1) {
    const a = v.readUInt32BE(4) ^ MAGIC;
    return { address: [a >>> 24, (a >>> 16) & 255, (a >>> 8) & 255, a & 255].join('.'), port };
  }
  return null; // IPv6 peers are not relayed
}

function encodeXorAddress(address: string, port: number): Buffer {
  const b = Buffer.alloc(8);
  b[1] = 1;
  b.writeUInt16BE(port ^ (MAGIC >>> 16), 2);
  const a = address.split('.').reduce((n, p) => ((n << 8) | Number(p)) >>> 0, 0);
  b.writeUInt32BE((a ^ MAGIC) >>> 0, 4);
  return b;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Builds a message; with `key`, adds MESSAGE-INTEGRITY; always adds FINGERPRINT. */
export function build(
  method: number,
  cls: number,
  transaction: Buffer,
  attrs: [number, Buffer][],
  key?: Buffer,
): Buffer {
  const parts: Buffer[] = [];
  for (const [t, v] of attrs) {
    const h = Buffer.alloc(4);
    h.writeUInt16BE(t, 0);
    h.writeUInt16BE(v.length, 2);
    parts.push(h, v, Buffer.alloc((4 - (v.length % 4)) % 4));
  }
  let body = Buffer.concat(parts);
  const header = (extra: number) => {
    const h = Buffer.alloc(20);
    h.writeUInt16BE(encodeType(method, cls), 0);
    h.writeUInt16BE(body.length + extra, 2);
    h.writeUInt32BE(MAGIC, 4);
    transaction.copy(h, 8);
    return h;
  };
  if (key) {
    const mac = createHmac('sha1', key)
      .update(Buffer.concat([header(24), body]))
      .digest();
    const h = Buffer.alloc(4);
    h.writeUInt16BE(ATTR.messageIntegrity, 0);
    h.writeUInt16BE(20, 2);
    body = Buffer.concat([body, h, mac]);
  }
  const fp = Buffer.alloc(8);
  fp.writeUInt16BE(ATTR.fingerprint, 0);
  fp.writeUInt16BE(4, 2);
  fp.writeUInt32BE((crc32(Buffer.concat([header(8), body])) ^ 0x5354554e) >>> 0, 4);
  return Buffer.concat([header(8), body, fp]);
}

/** Verifies MESSAGE-INTEGRITY with the long-term key. */
export function integrityOk(m: Message, key: Buffer): boolean {
  const mi = m.attrs.find((a) => a.type === ATTR.messageIntegrity);
  if (!mi || mi.value.length !== 20) return false;
  const covered = Buffer.from(m.raw.subarray(0, mi.offset));
  covered.writeUInt16BE(mi.offset + 24 - 20, 2);
  const mac = createHmac('sha1', key).update(covered).digest();
  return timingSafeEqual(mac, mi.value);
}

const errorAttr = (code: number, reason: string): [number, Buffer] => {
  const r = Buffer.from(reason, 'utf8');
  const b = Buffer.alloc(4 + r.length);
  b[2] = Math.floor(code / 100);
  b[3] = code % 100;
  r.copy(b, 4);
  return [ATTR.errorCode, b];
};

// ---------------------------------------------------------------- credentials
export function turnCredentials(
  secret: Buffer,
  userId: string,
  ttlSeconds = 12 * 3600,
): { username: string; credential: string } {
  const username = `${Math.floor(Date.now() / 1000) + ttlSeconds}:${userId}`;
  return { username, credential: createHmac('sha1', secret).update(username).digest('base64') };
}

const longTermKey = (username: string, realm: string, password: string) =>
  createHash('md5').update(`${username}:${realm}:${password}`).digest();

// ---------------------------------------------------------------- server
interface Allocation {
  client: RemoteInfo;
  relay: Socket;
  relayPort: number;
  username: string;
  key: Buffer;
  expires: number;
  permissions: Map<string, number>;
  channels: Map<number, { address: string; port: number; expires: number }>;
  peerChannel: Map<string, number>;
}

export interface TurnOptions {
  port: number;
  host?: string;
  /** The address peers and clients reach relays on. */
  relayAddress: string;
  relayPorts: [number, number];
  realm: string;
  secret: Buffer;
  networks: Networks;
  maxAllocations?: number;
  /** Called for every packet the relay sends to a peer (tests watch for outbound traffic). */
  onRelay?: (to: { address: string; port: number }) => void;
}

export class TurnServer {
  private socket: Socket;
  private allocations = new Map<string, Allocation>();
  private nonceSecret = randomBytes(32);
  private timer: NodeJS.Timeout;
  private usedPorts = new Set<number>();

  constructor(private o: TurnOptions) {
    if (isIP(o.relayAddress) !== 4)
      throw new Error(`TURN relay address must be IPv4: ${o.relayAddress}`);
    this.relayBind = o.relayAddress;
    this.socket = createSocket('udp4');
    this.socket.on('message', (b, r) => this.onClient(b, r));
    this.socket.on('error', () => undefined);
    this.timer = setInterval(() => this.sweep(), 30_000);
    this.timer.unref();
  }

  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(this.o.port, this.o.host ?? '0.0.0.0', () =>
        resolve(this.socket.address().port),
      );
    });
  }

  get count(): number {
    return this.allocations.size;
  }

  close(): void {
    clearInterval(this.timer);
    for (const a of this.allocations.values()) a.relay.close();
    this.allocations.clear();
    this.socket.close();
  }

  private key5(r: RemoteInfo) {
    return `${r.address}:${r.port}`;
  }

  private nonce(): Buffer {
    const t = Date.now().toString(16).padStart(12, '0');
    const mac = createHmac('sha256', this.nonceSecret).update(t).digest('hex').slice(0, 24);
    return Buffer.from(`${t}${mac}`);
  }

  private nonceState(n: Buffer | undefined): 'ok' | 'stale' | 'bad' {
    if (!n || n.length !== 36) return 'bad';
    const s = n.toString();
    const t = s.slice(0, 12);
    const mac = createHmac('sha256', this.nonceSecret).update(t).digest('hex').slice(0, 24);
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(s.slice(12)))) return 'bad';
    return Date.now() - parseInt(t, 16) > NONCE_MS ? 'stale' : 'ok';
  }

  private send(b: Buffer, r: { address: string; port: number }) {
    this.socket.send(b, r.port, r.address);
  }

  private reply(m: Message, r: RemoteInfo, attrs: [number, Buffer][], key?: Buffer) {
    this.send(build(m.method, CLASS.success, m.transaction, attrs, key), r);
  }

  private fail(
    m: Message,
    r: RemoteInfo,
    code: number,
    reason: string,
    key?: Buffer,
    extra: [number, Buffer][] = [],
  ) {
    this.send(
      build(m.method, CLASS.error, m.transaction, [errorAttr(code, reason), ...extra], key),
      r,
    );
  }

  /** The long-term key for an authenticated request, or null after replying with an error. */
  private authenticate(m: Message, r: RemoteInfo): Buffer | null {
    const challenge = (): [number, Buffer][] => [
      [ATTR.realm, Buffer.from(this.o.realm)],
      [ATTR.nonce, this.nonce()],
    ];
    const username = attr(m, ATTR.username)?.toString('utf8');
    if (!attr(m, ATTR.messageIntegrity) || !username) {
      this.fail(m, r, 401, 'Unauthorized', undefined, challenge());
      return null;
    }
    const state = this.nonceState(attr(m, ATTR.nonce));
    if (state !== 'ok') {
      this.fail(
        m,
        r,
        state === 'stale' ? 438 : 401,
        state === 'stale' ? 'Stale Nonce' : 'Unauthorized',
        undefined,
        challenge(),
      );
      return null;
    }
    const expiry = Number(username.split(':')[0]);
    const realm = attr(m, ATTR.realm)?.toString('utf8');
    if (!Number.isFinite(expiry) || expiry * 1000 < Date.now() || realm !== this.o.realm) {
      this.fail(m, r, 401, 'Unauthorized', undefined, challenge());
      return null;
    }
    const password = createHmac('sha1', this.o.secret).update(username).digest('base64');
    const key = longTermKey(username, this.o.realm, password);
    if (!integrityOk(m, key)) {
      this.fail(m, r, 401, 'Unauthorized', undefined, challenge());
      return null;
    }
    const a = this.allocations.get(this.key5(r));
    if (a && a.username !== username) {
      this.fail(m, r, 441, 'Wrong Credentials');
      return null;
    }
    return key;
  }

  private onClient(b: Buffer, r: RemoteInfo) {
    if (!this.o.networks.contains(r.address)) return;
    // ChannelData: first two bits 01.
    if (b.length >= 4 && (b[0]! & 0xc0) === 0x40) return this.channelData(b, r);
    const m = parse(b);
    if (!m) return;
    if (m.cls === CLASS.indication) {
      if (m.method === METHOD.send) this.sendIndication(m, r);
      return;
    }
    if (m.cls !== CLASS.request) return;
    const unknown = m.attrs.filter((a) => a.type < 0x8000 && !KNOWN.has(a.type)).map((a) => a.type);
    if (unknown.length) {
      const v = Buffer.alloc(unknown.length * 2);
      unknown.forEach((t, i) => v.writeUInt16BE(t, i * 2));
      return this.fail(m, r, 420, 'Unknown Attribute', undefined, [[ATTR.unknownAttributes, v]]);
    }
    switch (m.method) {
      case METHOD.binding:
        return this.reply(m, r, [[ATTR.xorMappedAddress, encodeXorAddress(r.address, r.port)]]);
      case METHOD.allocate:
        return void this.allocate(m, r);
      case METHOD.refresh:
        return this.refresh(m, r);
      case METHOD.createPermission:
        return this.createPermission(m, r);
      case METHOD.channelBind:
        return this.channelBind(m, r);
      default:
        return this.fail(m, r, 400, 'Bad Request');
    }
  }

  private async allocate(m: Message, r: RemoteInfo) {
    const key = this.authenticate(m, r);
    if (!key) return;
    if (this.allocations.has(this.key5(r))) return this.fail(m, r, 437, 'Allocation Mismatch', key);
    const transport = attr(m, ATTR.requestedTransport);
    if (!transport || transport[0] !== 17)
      return this.fail(m, r, 442, 'Unsupported Transport Protocol', key);
    const family = attr(m, ATTR.requestedAddressFamily);
    if (family && family[0] !== 1) return this.fail(m, r, 440, 'Address Family not Supported', key);
    if (attr(m, ATTR.evenPort) || attr(m, ATTR.reservationToken))
      return this.fail(m, r, 508, 'Insufficient Capacity', key);
    if (this.allocations.size >= (this.o.maxAllocations ?? 500))
      return this.fail(m, r, 486, 'Allocation Quota Reached', key);
    const relay = await this.bindRelay();
    if (!relay) return this.fail(m, r, 508, 'Insufficient Capacity', key);
    const lifetime = this.lifetime(m);
    const a: Allocation = {
      client: r,
      relay: relay.socket,
      relayPort: relay.port,
      username: attr(m, ATTR.username)!.toString('utf8'),
      key,
      expires: Date.now() + lifetime * 1000,
      permissions: new Map(),
      channels: new Map(),
      peerChannel: new Map(),
    };
    relay.socket.on('message', (data, peer) => this.fromPeer(a, data, peer));
    this.allocations.set(this.key5(r), a);
    const life = Buffer.alloc(4);
    life.writeUInt32BE(lifetime);
    this.reply(
      m,
      r,
      [
        [ATTR.xorRelayedAddress, encodeXorAddress(this.o.relayAddress, relay.port)],
        [ATTR.lifetime, life],
        [ATTR.xorMappedAddress, encodeXorAddress(r.address, r.port)],
      ],
      key,
    );
  }

  private lifetime(m: Message): number {
    const v = attr(m, ATTR.lifetime);
    const asked = v && v.length === 4 ? v.readUInt32BE(0) : DEFAULT_LIFETIME;
    return Math.min(asked, MAX_LIFETIME);
  }

  /**
   * Relay sockets are bound to the relayed address itself, so peers see packets come
   * from exactly the address and port the allocation announced (bound to 0.0.0.0, the
   * kernel would pick the source per route and peers would see a different address).
   * Only when that address is not on this machine (a relay address set for a
   * translated network) does it fall back to the listening address.
   */
  private relayBind: string | undefined;

  private async bindRelay(): Promise<{ socket: Socket; port: number } | null> {
    const [lo, hi] = this.o.relayPorts;
    const span = hi - lo + 1;
    const start = Math.floor(Math.random() * span);
    for (let i = 0; i < span; i++) {
      const port = lo + ((start + i) % span);
      if (this.usedPorts.has(port)) continue;
      const socket = createSocket('udp4');
      const ok = await new Promise<boolean>((resolve) => {
        socket.once('error', (e: NodeJS.ErrnoException) => {
          if (e.code === 'EADDRNOTAVAIL' && this.relayBind) {
            this.relayBind = this.o.host && this.o.host !== '0.0.0.0' ? this.o.host : undefined;
            i--; // try this port again on the fallback address
          }
          resolve(false);
        });
        socket.bind(port, this.relayBind, () => resolve(true));
      });
      if (ok) {
        socket.on('error', () => undefined);
        this.usedPorts.add(port);
        return { socket, port };
      }
      socket.close();
    }
    return null;
  }

  private drop(k: string) {
    const a = this.allocations.get(k);
    if (!a) return;
    this.allocations.delete(k);
    this.usedPorts.delete(a.relayPort);
    a.relay.close();
  }

  private refresh(m: Message, r: RemoteInfo) {
    const key = this.authenticate(m, r);
    if (!key) return;
    const a = this.allocations.get(this.key5(r));
    if (!a) return this.fail(m, r, 437, 'Allocation Mismatch', key);
    const lifetime = this.lifetime(m);
    if (lifetime === 0) this.drop(this.key5(r));
    else a.expires = Date.now() + lifetime * 1000;
    const life = Buffer.alloc(4);
    life.writeUInt32BE(lifetime);
    this.reply(m, r, [[ATTR.lifetime, life]], key);
  }

  private peers(m: Message): { address: string; port: number }[] {
    return m.attrs
      .filter((a) => a.type === ATTR.xorPeerAddress)
      .map((a) => xorAddress(a.value))
      .filter((p): p is { address: string; port: number } => !!p);
  }

  private createPermission(m: Message, r: RemoteInfo) {
    const key = this.authenticate(m, r);
    if (!key) return;
    const a = this.allocations.get(this.key5(r));
    if (!a) return this.fail(m, r, 437, 'Allocation Mismatch', key);
    const peers = this.peers(m);
    if (!peers.length) return this.fail(m, r, 400, 'Bad Request', key);
    if (peers.some((p) => !this.o.networks.contains(p.address)))
      return this.fail(m, r, 403, 'Forbidden', key);
    for (const p of peers) a.permissions.set(p.address, Date.now() + PERMISSION_MS);
    this.reply(m, r, [], key);
  }

  private channelBind(m: Message, r: RemoteInfo) {
    const key = this.authenticate(m, r);
    if (!key) return;
    const a = this.allocations.get(this.key5(r));
    if (!a) return this.fail(m, r, 437, 'Allocation Mismatch', key);
    const ch = attr(m, ATTR.channelNumber);
    const peer = this.peers(m)[0];
    const number = ch && ch.length >= 2 ? ch.readUInt16BE(0) : 0;
    if (!peer || number < 0x4000 || number > 0x4fff)
      return this.fail(m, r, 400, 'Bad Request', key);
    if (!this.o.networks.contains(peer.address)) return this.fail(m, r, 403, 'Forbidden', key);
    const id = `${peer.address}:${peer.port}`;
    const bound = a.channels.get(number);
    if (
      (bound && `${bound.address}:${bound.port}` !== id) ||
      (a.peerChannel.has(id) && a.peerChannel.get(id) !== number)
    )
      return this.fail(m, r, 400, 'Bad Request', key);
    a.channels.set(number, { ...peer, expires: Date.now() + CHANNEL_MS });
    a.peerChannel.set(id, number);
    a.permissions.set(peer.address, Date.now() + PERMISSION_MS);
    this.reply(m, r, [], key);
  }

  private permitted(a: Allocation, address: string): boolean {
    const until = a.permissions.get(address);
    return !!until && until > Date.now() && this.o.networks.contains(address);
  }

  private relayTo(a: Allocation, data: Buffer, peer: { address: string; port: number }) {
    if (!this.permitted(a, peer.address)) return;
    this.o.onRelay?.(peer);
    a.relay.send(data, peer.port, peer.address);
  }

  private sendIndication(m: Message, r: RemoteInfo) {
    const a = this.allocations.get(this.key5(r));
    const peer = this.peers(m)[0];
    const data = attr(m, ATTR.data);
    if (a && peer && data) this.relayTo(a, data, peer);
  }

  private channelData(b: Buffer, r: RemoteInfo) {
    const a = this.allocations.get(this.key5(r));
    if (!a) return;
    const number = b.readUInt16BE(0);
    const length = b.readUInt16BE(2);
    const ch = a.channels.get(number);
    if (!ch || ch.expires < Date.now() || 4 + length > b.length) return;
    this.relayTo(a, b.subarray(4, 4 + length), ch);
  }

  private fromPeer(a: Allocation, data: Buffer, peer: RemoteInfo) {
    if (!this.permitted(a, peer.address)) return;
    const number = a.peerChannel.get(`${peer.address}:${peer.port}`);
    const ch = number !== undefined ? a.channels.get(number) : undefined;
    if (number !== undefined && ch && ch.expires > Date.now()) {
      const h = Buffer.alloc(4);
      h.writeUInt16BE(number, 0);
      h.writeUInt16BE(data.length, 2);
      this.send(Buffer.concat([h, data, Buffer.alloc((4 - (data.length % 4)) % 4)]), a.client);
      return;
    }
    this.send(
      build(METHOD.data, CLASS.indication, randomBytes(12), [
        [ATTR.xorPeerAddress, encodeXorAddress(peer.address, peer.port)],
        [ATTR.data, data],
      ]),
      a.client,
    );
  }

  private sweep() {
    const now = Date.now();
    for (const [k, a] of this.allocations) {
      if (a.expires < now) {
        this.drop(k);
        continue;
      }
      for (const [ip, t] of a.permissions) if (t < now) a.permissions.delete(ip);
      for (const [n, c] of a.channels)
        if (c.expires < now) {
          a.channels.delete(n);
          a.peerChannel.delete(`${c.address}:${c.port}`);
        }
    }
  }
}

export { ATTR, CLASS, METHOD, MAGIC };
