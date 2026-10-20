import { createHash, randomBytes } from 'node:crypto';
import { createSocket, type Socket } from 'node:dgram';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Networks } from '../src/lan.ts';
import {
  ATTR,
  CLASS,
  METHOD,
  TurnServer,
  build,
  integrityOk,
  parse,
  turnCredentials,
  xorAddress,
  type Message,
} from '../src/turn.ts';

const secret = randomBytes(32);
const realm = 'site.test';
let server: TurnServer;
let port: number;
const relayed: string[] = [];

beforeAll(async () => {
  server = new TurnServer({
    port: 0,
    host: '127.0.0.1',
    relayAddress: '127.0.0.1',
    relayPorts: [49300, 49340],
    realm,
    secret,
    networks: new Networks(),
    onRelay: (p) => relayed.push(`${p.address}:${p.port}`),
  });
  port = await server.listen();
});
afterAll(() => server.close());

/** A tiny TURN client: one UDP socket, request/response by transaction id. */
class Client {
  sock: Socket = createSocket('udp4');
  inbox: Buffer[] = [];
  waiters = new Map<string, (m: Message) => void>();
  key: Buffer | null = null;
  realm = '';
  nonce = Buffer.alloc(0);
  constructor(
    public username: string,
    public password: string,
  ) {}
  async open() {
    await new Promise<void>((r) => this.sock.bind(0, '127.0.0.1', r));
    this.sock.on('message', (b) => {
      const m = parse(b);
      const w = m && this.waiters.get(m.transaction.toString('hex'));
      if (m && w) w(m);
      else this.inbox.push(b);
    });
  }
  request(method: number, attrs: [number, Buffer][], auth = true): Promise<Message> {
    const tid = randomBytes(12);
    const all: [number, Buffer][] =
      auth && this.key
        ? [
            ...attrs,
            [ATTR.username, Buffer.from(this.username)],
            [ATTR.realm, Buffer.from(this.realm)],
            [ATTR.nonce, this.nonce],
          ]
        : attrs;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no response')), 2000);
      this.waiters.set(tid.toString('hex'), (m) => {
        clearTimeout(t);
        resolve(m);
      });
      this.sock.send(
        build(method, CLASS.request, tid, all, auth && this.key ? this.key : undefined),
        port,
        '127.0.0.1',
      );
    });
  }
  async allocate(): Promise<Message> {
    const transport: [number, Buffer] = [ATTR.requestedTransport, Buffer.from([17, 0, 0, 0])];
    const first = await this.request(METHOD.allocate, [transport], false);
    expect(first.cls).toBe(CLASS.error);
    expect(code(first)).toBe(401);
    this.realm = first.attrs.find((a) => a.type === ATTR.realm)!.value.toString();
    this.nonce = Buffer.from(first.attrs.find((a) => a.type === ATTR.nonce)!.value);
    this.key = createHash('md5').update(`${this.username}:${this.realm}:${this.password}`).digest();
    return this.request(METHOD.allocate, [transport]);
  }
  next(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const poll = () => {
        const b = this.inbox.shift();
        if (b) return resolve(b);
        if (Date.now() - t0 > 2000) return reject(new Error('nothing received'));
        setTimeout(poll, 10);
      };
      poll();
    });
  }
  close() {
    this.sock.close();
  }
}

const code = (m: Message) => {
  const v = m.attrs.find((a) => a.type === ATTR.errorCode)?.value;
  return v ? v[2]! * 100 + v[3]! : 0;
};
const xorPeer = (address: string, p: number, tid = Buffer.alloc(12)) => {
  const b = Buffer.alloc(8);
  b[1] = 1;
  b.writeUInt16BE(p ^ 0x2112, 2);
  const a = address.split('.').reduce((n, x) => ((n << 8) | Number(x)) >>> 0, 0);
  b.writeUInt32BE((a ^ 0x2112a442) >>> 0, 4);
  void tid;
  return b;
};

describe('LAN TURN relay', () => {
  it('answers Binding requests with the reflexive address (a LAN STUN server)', async () => {
    const c = new Client('x', 'y');
    await c.open();
    const m = await c.request(METHOD.binding, [], false);
    expect(m.cls).toBe(CLASS.success);
    const mapped = xorAddress(m.attrs.find((a) => a.type === ATTR.xorMappedAddress)!.value);
    expect(mapped?.address).toBe('127.0.0.1');
    c.close();
  });

  it('allocates with short-lived credentials and relays both ways, by indication and by channel', async () => {
    const creds = turnCredentials(secret, 'user-1');
    const c = new Client(creds.username, creds.credential);
    await c.open();
    const ok = await c.allocate();
    expect(ok.cls).toBe(CLASS.success);
    expect(integrityOk(ok, c.key!)).toBe(true);
    const relay = xorAddress(ok.attrs.find((a) => a.type === ATTR.xorRelayedAddress)!.value)!;
    expect(relay.address).toBe('127.0.0.1');
    expect(relay.port).toBeGreaterThanOrEqual(49300);

    // A peer on the LAN (here: loopback).
    const peer = createSocket('udp4');
    const got: Buffer[] = [];
    await new Promise<void>((r) => peer.bind(0, '127.0.0.1', r));
    peer.on('message', (b) => got.push(b));
    const peerPort = (peer.address() as { port: number }).port;

    // Without a permission nothing is relayed.
    c.sock.send(
      build(METHOD.send, CLASS.indication, randomBytes(12), [
        [ATTR.xorPeerAddress, xorPeer('127.0.0.1', peerPort)],
        [ATTR.data, Buffer.from('too early')],
      ]),
      port,
      '127.0.0.1',
    );
    const perm = await c.request(METHOD.createPermission, [
      [ATTR.xorPeerAddress, xorPeer('127.0.0.1', peerPort)],
    ]);
    expect(perm.cls).toBe(CLASS.success);
    c.sock.send(
      build(METHOD.send, CLASS.indication, randomBytes(12), [
        [ATTR.xorPeerAddress, xorPeer('127.0.0.1', peerPort)],
        [ATTR.data, Buffer.from('hello peer')],
      ]),
      port,
      '127.0.0.1',
    );
    await expect.poll(() => got.map(String)).toEqual(['hello peer']);

    // Peer → client arrives as a Data indication.
    peer.send('hello client', relay.port, relay.address);
    const data = parse(await c.next())!;
    expect(data.method).toBe(METHOD.data);
    expect(data.attrs.find((a) => a.type === ATTR.data)!.value.toString()).toBe('hello client');

    // Channels: 4-byte header instead of a STUN message.
    const ch = Buffer.alloc(4);
    ch.writeUInt16BE(0x4001, 0);
    const bind = await c.request(METHOD.channelBind, [
      [ATTR.channelNumber, ch],
      [ATTR.xorPeerAddress, xorPeer('127.0.0.1', peerPort)],
    ]);
    expect(bind.cls).toBe(CLASS.success);
    const payload = Buffer.from('over a channel');
    const frame = Buffer.alloc(4);
    frame.writeUInt16BE(0x4001, 0);
    frame.writeUInt16BE(payload.length, 2);
    c.sock.send(Buffer.concat([frame, payload]), port, '127.0.0.1');
    await expect.poll(() => got.map(String)).toContain('over a channel');
    peer.send('back on the channel', relay.port, relay.address);
    const back = await c.next();
    expect(back.readUInt16BE(0)).toBe(0x4001);
    expect(back.subarray(4, 4 + back.readUInt16BE(2)).toString()).toBe('back on the channel');
    expect(relayed.every((p) => p.startsWith('127.0.0.1:'))).toBe(true);
    peer.close();
    c.close();
  });

  it('refuses to relay to an address outside the site network', async () => {
    const creds = turnCredentials(secret, 'user-2');
    const c = new Client(creds.username, creds.credential);
    await c.open();
    expect((await c.allocate()).cls).toBe(CLASS.success);
    const perm = await c.request(METHOD.createPermission, [
      [ATTR.xorPeerAddress, xorPeer('8.8.8.8', 53)],
    ]);
    expect(perm.cls).toBe(CLASS.error);
    expect(code(perm)).toBe(403);
    expect(relayed.some((p) => p.startsWith('8.8.8.8'))).toBe(false);
    c.close();
  });

  it('refuses wrong and expired credentials', async () => {
    const wrong = new Client(turnCredentials(secret, 'u').username, 'not-the-password');
    await wrong.open();
    const r = await wrong.allocate();
    expect(r.cls).toBe(CLASS.error);
    expect(code(r)).toBe(401);
    wrong.close();
    const expiredName = `${Math.floor(Date.now() / 1000) - 10}:u`;
    const { credential } = turnCredentials(secret, 'u');
    const expired = new Client(expiredName, credential);
    await expired.open();
    expect(code(await expired.allocate())).toBe(401);
    expired.close();
  });
});
