import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildDelivery } from '@evactis-3dworkflow/packaging';
import { demoEnvironment } from '../../../packages/demo-facility/src/environment.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import { createServer, type WebFiles } from '../src/server.ts';

const enc = new TextEncoder();
const SETUP = 'ABCD-EFGH-JKLM';
const web: WebFiles = {
  read: (p) => (p === 'index.html' ? Buffer.from('<!doctype html><title>Portal</title>') : null),
};

/** A real .evx of the demo facility (assets are stand-in bytes). */
async function evx(passphrase?: string): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  await buildDelivery(
    {
      env: demoEnvironment(),
      kind: 'evx',
      producer: 'test',
      name: 'demo',
      readAsset: async (p) => enc.encode(`asset ${p}`),
      quickStart: enc.encode('%PDF-test'),
      passphrase,
    },
    { write: async (_p, d) => void parts.push(d) },
  );
  return Buffer.concat(parts);
}

let s: Awaited<ReturnType<typeof createServer>>;
let base: string;
const cookies: Record<string, string> = {};

const call = async (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  o: {
    as?: string;
    body?: unknown;
    raw?: Buffer;
    type?: string;
    from?: string;
    csrf?: boolean;
  } = {},
) => {
  const headers: Record<string, string> = {};
  if (o.as) headers.cookie = `evx_session=${cookies[o.as]}`;
  if (o.csrf !== false && method !== 'GET') headers['x-evx'] = '1';
  if (o.raw) headers['content-type'] = o.type ?? 'application/octet-stream';
  const r = await s.app.inject({
    method,
    url,
    headers,
    remoteAddress: o.from ?? '10.0.0.20',
    ...(o.raw ? { payload: o.raw } : o.body !== undefined ? { payload: o.body as object } : {}),
  });
  const set = r.headers['set-cookie'];
  return {
    status: r.statusCode,
    json: () => r.json(),
    body: r.rawPayload,
    headers: r.headers,
    setCookie: String(set ?? ''),
  };
};
const login = async (who: string, password: string) => {
  const r = await call('POST', '/api/login', { body: { username: who, password } });
  expect(r.status).toBe(200);
  cookies[who] = /evx_session=([^;]+)/.exec(r.setCookie)![1]!;
};

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'evx-site-'));
  const config = loadConfig(dir);
  config.siteName = 'Riverside';
  s = await createServer({
    config,
    db: openDb(join(dir, 'site.db')),
    tls: null,
    caPem: null,
    web,
    turn: { secret: Buffer.alloc(32, 7), port: 3478, realm: 'riverside' },
    setupCode: SETUP,
    log: false,
  });
  await s.app.listen({ host: '127.0.0.1', port: 0 });
  base = `127.0.0.1:${(s.app.server.address() as { port: number }).port}`;
});
afterAll(() => s.close());

describe('Site Server', () => {
  it('answers only its own network', async () => {
    expect((await call('GET', '/health', { from: '203.0.113.9' })).status).toBe(403);
    expect((await call('GET', '/health', { from: '::ffff:192.168.1.30' })).status).toBe(200);
    expect((await call('GET', '/health', { from: 'fe80::1' })).status).toBe(200);
  });

  it('is set up once, with the code printed at first start', async () => {
    expect((await call('GET', '/api/site')).json()).toMatchObject({
      siteName: 'Riverside',
      setup: true,
      user: null,
      reports: false,
    });
    const bad = await call('POST', '/api/setup', {
      body: { code: 'WRONG', username: 'ada', password: 'long enough pass' },
    });
    expect(bad.status).toBe(403);
    const weak = await call('POST', '/api/setup', {
      body: { code: SETUP, username: 'ada', password: 'short' },
    });
    expect(weak.status).toBe(400);
    const ok = await call('POST', '/api/setup', {
      body: {
        code: SETUP.toLowerCase(),
        username: 'ada',
        displayName: 'Ada Admin',
        password: 'long enough pass',
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.setCookie).toMatch(/HttpOnly; SameSite=Strict/);
    expect(
      (
        await call('POST', '/api/setup', {
          body: { code: SETUP, username: 'eve', password: 'long enough pass' },
        })
      ).status,
    ).toBe(409);
    await login('ada', 'long enough pass');
  });

  it('refuses API writes without the X-EVX header or from another origin', async () => {
    const r = await call('POST', '/api/users', {
      as: 'ada',
      body: { username: 'x', password: 'xxxxxxxxxxxx' },
      csrf: false,
    });
    expect(r.status).toBe(403);
    const other = await s.app.inject({
      method: 'POST',
      url: '/api/logout',
      remoteAddress: '10.0.0.20',
      headers: {
        'x-evx': '1',
        origin: 'https://evil.example',
        host: base,
        cookie: `evx_session=${cookies.ada}`,
      },
    });
    expect(other.statusCode).toBe(403);
  });

  it('administrators create members; members cannot administer', async () => {
    const r = await call('POST', '/api/users', {
      as: 'ada',
      body: {
        username: 'bob',
        displayName: 'Bob Builder',
        password: 'bobs password 1',
        role: 'member',
      },
    });
    expect(r.status).toBe(200);
    await login('bob', 'bobs password 1');
    expect((await call('GET', '/api/admin/reports', { as: 'bob' })).status).toBe(403);
    expect((await call('GET', '/api/users', { as: 'bob' })).json()).toEqual(
      expect.arrayContaining([{ id: expect.any(String), name: 'Bob Builder' }]),
    );
  });

  it('throttles repeated wrong passwords', async () => {
    for (let i = 0; i < 5; i++)
      expect(
        (
          await call('POST', '/api/login', {
            body: { username: 'bob', password: 'nope' },
            from: '10.9.9.9',
          })
        ).status,
      ).toBe(401);
    const blocked = await call('POST', '/api/login', {
      body: { username: 'bob', password: 'bobs password 1' },
      from: '10.9.9.9',
    });
    expect(blocked.status).toBe(429);
  });

  let envId = '';
  it('accepts a checked .evx and refuses an altered one', async () => {
    const good = await evx();
    const up = await call('PUT', '/api/environments', { as: 'ada', raw: good });
    expect(up.status).toBe(200);
    envId = up.json().id;
    expect(up.json()).toMatchObject({ encrypted: false, title: { en: 'Evactis Demo Centre' } });
    const altered = Buffer.from(good);
    const at = altered.indexOf('asset media/lobby/preview.jpg');
    altered[at] = 'A'.charCodeAt(0);
    const bad = await call('PUT', '/api/environments', { as: 'ada', raw: altered });
    expect(bad.status).toBe(422);
    expect(bad.json().error).toContain('failed its check');
    expect((await call('PUT', '/api/environments', { as: 'bob', raw: good })).status).toBe(403);

    const enc = await call('PUT', '/api/environments', {
      as: 'ada',
      raw: await evx('correct horse battery staple'),
    });
    expect(enc.json().encrypted).toBe(true);
  }, 60_000);

  it('serves package files as opaque bytes to signed-in users only', async () => {
    expect((await call('GET', `/api/environments/${envId}/files/evx-manifest.json`)).status).toBe(
      401,
    );
    const r = await call('GET', `/api/environments/${envId}/files/evx-manifest.json`, {
      as: 'bob',
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/octet-stream');
    expect(r.headers['content-security-policy']).toContain('sandbox');
    expect(JSON.parse(r.body.toString()).format).toBe('evactis-3dworkflow-package');
    const tile = await call('GET', `/api/environments/${envId}/files/media/lobby/preview.jpg`, {
      as: 'bob',
    });
    expect(tile.body.toString()).toBe('asset media/lobby/preview.jpg');
    expect(
      (await call('GET', `/api/environments/${envId}/files/..%2F..%2Fsite.db`, { as: 'bob' }))
        .status,
    ).toBe(404);
  });

  let noteId = '';
  it('shares notes: create, assign, reply, status; edits only by author or admin', async () => {
    const users = (await call('GET', '/api/users', { as: 'ada' })).json() as {
      id: string;
      username: string;
    }[];
    const bob = users.find((u) => u.username === 'bob')!;
    const n = await call('POST', `/api/environments/${envId}/notes`, {
      as: 'ada',
      body: {
        sceneId: 'office',
        yaw: 12.345,
        pitch: -5,
        category: 'hazard',
        title: 'Boxes block the exit',
        body: 'Move them <b>now</b>',
        assigneeId: bob.id,
      },
    });
    expect(n.status).toBe(200);
    noteId = n.json().id;
    expect(n.json()).toMatchObject({
      status: 'open',
      yaw: 12.35,
      assignee: { name: 'Bob Builder' },
      body: 'Move them <b>now</b>',
    });
    expect(
      (
        await call('PATCH', `/api/notes/${noteId}`, { as: 'bob', body: { status: 'in-progress' } })
      ).json().status,
    ).toBe('in-progress');
    expect(
      (await call('PATCH', `/api/notes/${noteId}`, { as: 'bob', body: { title: 'Mine now' } }))
        .status,
    ).toBe(403);
    const reply = await call('POST', `/api/notes/${noteId}/replies`, {
      as: 'bob',
      body: { body: 'Moved to the dock.' },
    });
    expect(reply.json().replies).toEqual([
      expect.objectContaining({
        body: 'Moved to the dock.',
        author: expect.objectContaining({ name: 'Bob Builder' }),
      }),
    ]);
    expect(
      (
        await call('POST', `/api/environments/${envId}/notes`, {
          as: 'bob',
          body: { sceneId: 'office', yaw: 0, pitch: 120, title: 'x' },
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('GET', `/api/environments/${envId}/notes`, { as: 'bob' })).json(),
    ).toHaveLength(1);
  });

  it('strips photo metadata (EXIF with GPS) and refuses non-images', async () => {
    const exif = Buffer.concat([
      Buffer.from([0xff, 0xe1, 0x00, 0x10]),
      Buffer.from('Exif\0\0GPS-HERE'),
    ]);
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe0, 0x00, 0x10]),
      Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'),
      exif,
      Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 0xff, 0xd9]),
    ]);
    const r = await call('PUT', `/api/notes/${noteId}/photos`, {
      as: 'bob',
      raw: jpeg,
      type: 'image/jpeg',
    });
    expect(r.status).toBe(200);
    const photo = r.json().photos[0];
    const got = await call('GET', `/api/photos/${photo.id}`, { as: 'ada' });
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect(got.body.includes(Buffer.from('GPS-HERE'))).toBe(false);
    expect(got.body.length).toBe(jpeg.length - exif.length);
    const html = await call('PUT', `/api/notes/${noteId}/photos`, {
      as: 'bob',
      raw: Buffer.from('<svg onload=alert(1)>'),
      type: 'image/png',
    });
    expect(html.status).toBe(400);
  });

  it('keeps usage reports off until an administrator turns them on; CSV is formula-safe', async () => {
    const off = await call('POST', '/api/reports/events', {
      as: 'bob',
      body: { kind: 'scene-view', environmentId: envId, sceneId: 'lobby' },
    });
    expect(off.status).toBe(409);
    expect((await call('GET', '/api/admin/reports', { as: 'ada' })).json()).toEqual({
      enabled: false,
      events: 0,
    });
    await call('PUT', '/api/admin/reports', { as: 'ada', body: { enabled: true } });
    expect(
      (
        await call('POST', '/api/reports/events', {
          as: 'bob',
          body: { kind: 'scene-view', environmentId: envId, sceneId: 'lobby' },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await call('POST', '/api/reports/events', {
          as: 'bob',
          body: {
            kind: 'module-complete',
            environmentId: envId,
            moduleId: 'nearest-exit',
            score: 90,
            passed: true,
          },
        })
      ).status,
    ).toBe(204);
    await call(
      'PATCH',
      `/api/users/${(await call('GET', '/api/site', { as: 'bob' })).json().user.id}`,
      { as: 'ada', body: { displayName: '=HYPERLINK("x")' } },
    );
    const csv = (await call('GET', '/api/admin/reports.csv', { as: 'ada' })).body.toString();
    expect(csv.split('\r\n')[0]).toContain('"time","event"');
    expect(csv).toContain('"scene-view"');
    expect(csv).toContain('"module-complete"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    await call(
      'PATCH',
      `/api/users/${(await call('GET', '/api/site', { as: 'bob' })).json().user.id}`,
      { as: 'ada', body: { displayName: 'Bob Builder' } },
    );
  });

  it('offers only the site’s own TURN relay, with short-lived credentials', async () => {
    const ice = (await call('GET', '/api/ice', { as: 'bob' })).json();
    expect(ice.iceServers).toHaveLength(1);
    expect(ice.iceServers[0].urls).toEqual([
      expect.stringMatching(/^turn:[^:]+:3478\?transport=udp$/),
    ]);
    expect(JSON.stringify(ice)).not.toMatch(/stun:|google|twilio|cloudflare/i);
    const expiry = Number(ice.iceServers[0].username.split(':')[0]);
    expect(expiry * 1000).toBeGreaterThan(Date.now());
  });

  it('runs a guided session: host navigation reaches participants, signals pass between them', async () => {
    const open = (who: string) =>
      new Promise<{ ws: WebSocket; inbox: Record<string, unknown>[] }>((resolve, reject) => {
        const ws = new WebSocket(`ws://${base}/live`, {
          headers: { cookie: `evx_session=${cookies[who]}`, origin: `http://${base}` },
        });
        const inbox: Record<string, unknown>[] = [];
        ws.on('message', (m) => inbox.push(JSON.parse(m.toString())));
        ws.on('open', () => resolve({ ws, inbox }));
        ws.on('error', reject);
      });
    const waitFor = async (inbox: Record<string, unknown>[], t: string) => {
      await expect.poll(() => inbox.some((m) => m.t === t)).toBe(true);
      return inbox.filter((m) => m.t === t).at(-1)!;
    };
    // No cookie, or another origin: refused.
    await expect(
      new Promise((res, rej) => {
        const ws = new WebSocket(`ws://${base}/live`, { headers: { origin: `http://${base}` } });
        ws.on('open', res);
        ws.on('error', rej);
      }),
    ).rejects.toThrow(/401/);

    const host = await open('ada');
    const guest = await open('bob');
    const hostId = (await waitFor(host.inbox, 'hello')).peerId as string;
    host.ws.send(JSON.stringify({ t: 'watch', environmentId: envId }));
    guest.ws.send(JSON.stringify({ t: 'watch', environmentId: envId }));
    host.ws.send(JSON.stringify({ t: 'session.start', title: 'Fire warden walk' }));
    const session = (await waitFor(host.inbox, 'session')).session as { id: string };
    type Listed = { sessions: { id: string; title: string }[] };
    await waitFor(guest.inbox, 'sessions');
    await expect
      .poll(() =>
        (guest.inbox.filter((m) => m.t === 'sessions').at(-1) as Listed).sessions.map(
          (x) => x.title,
        ),
      )
      .toEqual(['Fire warden walk']);
    guest.ws.send(JSON.stringify({ t: 'session.join', sessionId: session.id }));
    const joined = (await waitFor(host.inbox, 'member.joined')).member as {
      peerId: string;
      name: string;
    };
    expect(joined.name).toBe('Bob Builder');

    host.ws.send(
      JSON.stringify({ t: 'nav', sceneId: 'office', view: { yaw: 40, pitch: -3, fov: 75 } }),
    );
    expect(await waitFor(guest.inbox, 'nav')).toMatchObject({
      sceneId: 'office',
      view: { yaw: 40, pitch: -3, fov: 75 },
    });
    guest.ws.send(
      JSON.stringify({ t: 'nav', sceneId: 'lobby', view: { yaw: 0, pitch: 0, fov: 75 } }),
    );
    expect((await waitFor(guest.inbox, 'error')).message).toContain('Only the host');

    guest.ws.send(JSON.stringify({ t: 'signal', to: hostId, data: { sdp: 'offer' } }));
    expect(await waitFor(host.inbox, 'signal')).toMatchObject({
      from: joined.peerId,
      data: { sdp: 'offer' },
    });

    // A note saved over the API reaches both pages live.
    await call('PATCH', `/api/notes/${noteId}`, { as: 'ada', body: { status: 'resolved' } });
    expect(((await waitFor(guest.inbox, 'note')).note as { status: string }).status).toBe(
      'resolved',
    );

    host.ws.close();
    await waitFor(guest.inbox, 'session.ended');
    guest.ws.close();
  });
});
