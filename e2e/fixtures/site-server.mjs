#!/usr/bin/env node
/**
 * Site Server fixture for e2e/site-server.spec.ts: the real server bundle
 * (apps/site-server/dist/server.cjs) on 127.0.0.1 over HTTPS with its own certificate
 * authority, a fresh data folder, the first administrator created with the setup code
 * from its log, a member, and the demo facility uploaded as a .evx made by the packager.
 * Stays running (Playwright stops it); target/e2e-site/fixture.json says what was made.
 *
 *   node e2e/fixtures/site-server.mjs <port>
 *
 * EVX_SITE_OUT (output folder), EVX_SITE_HOST (listen address, default 127.0.0.1) and
 * EVX_SITE_RELAY (TURN relay address, default 127.0.0.1) let the isolated-network
 * acceptance (scripts/linux/site-server-lan.sh) reuse it.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.argv[2] ?? 4190);
const out = resolve(process.env.EVX_SITE_OUT ?? join(repo, 'target/e2e-site'));
const data = join(out, 'data');
const bundle = join(repo, 'apps/site-server/dist/server.cjs');
const shell = process.platform === 'win32';

if (!existsSync(bundle) || !existsSync(join(repo, 'apps/site-server/dist/web/view.html')))
  execFileSync('pnpm', ['--filter', '@evactis-3dworkflow/site-server', 'build'], {
    cwd: repo,
    stdio: 'inherit',
    shell,
  });
if (!existsSync(join(repo, 'packages/demo-facility/dist/environment.json')))
  execFileSync('pnpm', ['--filter', '@evactis-3dworkflow/demo-facility', 'build'], {
    cwd: repo,
    stdio: 'inherit',
    shell,
  });

rmSync(out, { recursive: true, force: true });
mkdirSync(data, { recursive: true });
execFileSync(
  process.execPath,
  ['tools/package.mjs', '--kind', 'evx', '--out', out, '--name', 'demo'],
  { cwd: repo, stdio: 'ignore' },
);
writeFileSync(
  join(data, 'config.json'),
  JSON.stringify({
    siteName: 'Riverside Hospital',
    host: process.env.EVX_SITE_HOST ?? '127.0.0.1',
    port,
    turn: {
      port: port + 1,
      relayAddress: process.env.EVX_SITE_RELAY ?? '127.0.0.1',
      relayPorts: [49500, 49540],
    },
  }),
);

const server = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', bundle, '--data', data],
  {
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
const stop = () => server.kill();
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('exit', (code) => process.exit(code ?? 0));

const code = await new Promise((resolve, reject) => {
  let log = '';
  const t = setTimeout(() => reject(new Error(`no setup code in the server log:\n${log}`)), 30_000);
  server.stdout.on('data', (b) => {
    log += b;
    const m = /setup code ([A-Z0-9-]{14})/.exec(log);
    if (m) {
      clearTimeout(t);
      resolve(m[1]);
    }
  });
});
// From here on the server's log goes to ours (the LAN acceptance checks it for errors).
server.stdout.pipe(process.stdout);

const ca = readFileSync(join(data, 'tls/ca.pem'));
/** One HTTPS call, trusting only the site's own authority. */
function call(method, path, { body, cookie, type } = {}) {
  return new Promise((resolve, reject) => {
    const raw = Buffer.isBuffer(body);
    const payload = body === undefined ? undefined : raw ? body : Buffer.from(JSON.stringify(body));
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        ca,
        servername: 'localhost',
        headers: {
          'x-evx': '1',
          ...(cookie ? { cookie } : {}),
          ...(payload
            ? { 'content-type': type ?? 'application/json', 'content-length': payload.length }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          if (res.statusCode >= 400)
            return reject(new Error(`${method} ${path}: ${res.statusCode} ${text}`));
          resolve({
            json: text ? JSON.parse(text) : null,
            cookie: String(res.headers['set-cookie'] ?? '').split(';')[0],
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const PASSWORD = 'correct horse battery staple';
const admin = await call('POST', '/api/setup', {
  body: { code, username: 'ada', displayName: 'Ada Admin', password: PASSWORD },
});
const cookie = admin.cookie;
await call('POST', '/api/users', {
  cookie,
  body: { username: 'bob', displayName: 'Bob Builder', password: PASSWORD, role: 'member' },
});
// Only the administration test changes this account (a password reset signs its owner out
// everywhere, so it must not be an account another test is using at the same time).
await call('POST', '/api/users', {
  cookie,
  body: { username: 'carol', displayName: 'Carol Clerk', password: PASSWORD, role: 'member' },
});
const env = await call('PUT', '/api/environments', {
  cookie,
  body: readFileSync(join(out, 'demo.evx')),
  type: 'application/octet-stream',
});
writeFileSync(
  join(out, 'fixture.json'),
  JSON.stringify(
    { environmentId: env.json.id, password: PASSWORD, users: ['ada', 'bob', 'carol'] },
    null,
    2,
  ),
);
console.log(`Site Server fixture ready on https://127.0.0.1:${port}/ (environment ${env.json.id})`);
