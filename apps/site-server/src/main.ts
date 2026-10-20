/**
 * EVACTIS 3DWORKFLOW Site Server — command line.
 *
 *   evactis-3dworkflow-site-server [--data <folder>] [--config <file>]
 *
 * The data folder (default ./site-data, or EVX_SITE_DATA) holds config.json, the
 * database, uploaded environments, note photos and the TLS files. On first start the
 * server writes a default config, makes a local certificate authority and server
 * certificate, and prints a one-time setup code for the first administrator.
 */
import { X509Certificate, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig, type Config } from './config.ts';
import { getSetting, openDb, setSetting } from './db.ts';
import { Networks } from './lan.ts';
import { createServer, newSetupCode, turnSecret, type WebFiles } from './server.ts';
import { TurnServer } from './turn.ts';
import { issueServer, makeAuthority } from './x509.ts';

/** The server's own addresses on the site network (for the certificate and TURN). */
export function lanAddresses(networks: Networks): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && !i.internal && networks.contains(i.address))
    .map((i) => i!.address.replace(/%.*$/, ''));
}

interface Tls {
  cert: string;
  key: string;
  caPem: string | null;
}

/** The site's own certificate if configured, else the local authority's (made or renewed). */
export function ensureTls(config: Config, names: string[], now = new Date()): Tls {
  if (config.tls.certFile && config.tls.keyFile)
    return {
      cert: readFileSync(config.tls.certFile, 'utf8'),
      key: readFileSync(config.tls.keyFile, 'utf8'),
      caPem: null,
    };
  const dir = join(config.dataDir, 'tls');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = (n: string) => join(dir, n);
  let ca = existsSync(file('ca.pem'))
    ? { cert: readFileSync(file('ca.pem'), 'utf8'), key: readFileSync(file('ca-key.pem'), 'utf8') }
    : null;
  if (!ca) {
    ca = makeAuthority(config.siteName, now);
    writeFileSync(file('ca.pem'), ca.cert);
    writeFileSync(file('ca-key.pem'), ca.key, { mode: 0o600 });
  }
  const wanted = [...new Set(names)];
  let leaf = existsSync(file('server.pem'))
    ? {
        cert: readFileSync(file('server.pem'), 'utf8'),
        key: readFileSync(file('server-key.pem'), 'utf8'),
      }
    : null;
  if (leaf) {
    const x = new X509Certificate(leaf.cert);
    const covers = wanted.every((n) => (isIP(n) ? x.checkIP(n) : x.checkHost(n)));
    const renew = Date.parse(x.validTo) - now.getTime() < 30 * 86_400_000;
    if (!covers || renew || !x.checkIssued(new X509Certificate(ca.cert))) leaf = null;
  }
  if (!leaf) {
    leaf = issueServer(ca, wanted, now);
    writeFileSync(file('server.pem'), leaf.cert);
    writeFileSync(file('server-key.pem'), leaf.key, { mode: 0o600 });
  }
  return { ...leaf, caPem: ca.cert };
}

/** Pages from the folder next to the server bundle, or from the standalone binary. */
export function webFiles(dir: string): WebFiles {
  type Sea = { isSea(): boolean; getAsset(k: string): ArrayBuffer };
  let sea: Sea | null = null;
  try {
    const mod = process.getBuiltinModule('node:sea') as unknown as Sea | undefined;
    sea = mod?.isSea() ? mod : null;
  } catch {
    sea = null;
  }
  return {
    read(path: string) {
      if (path.includes('..')) return null;
      if (sea) {
        try {
          return Buffer.from(sea.getAsset(`web/${path}`));
        } catch {
          return null;
        }
      }
      const f = join(dir, path);
      return existsSync(f) ? readFileSync(f) : null;
    },
  };
}

export async function start(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: { data: { type: 'string' }, config: { type: 'string' }, web: { type: 'string' } },
  });
  const dataDir = resolve(values.data ?? process.env.EVX_SITE_DATA ?? 'site-data');
  const config = loadConfig(dataDir, values.config);
  const networks = new Networks(config.allowedNetworks);
  const addresses = lanAddresses(networks);
  const names = [hostname(), 'localhost', '127.0.0.1', ...addresses, ...config.tls.names];
  const tls = ensureTls(config, names);

  const db = openDb(join(config.dataDir, 'site.db'));
  let secret = getSetting(db, 'turn.secret');
  if (!secret) {
    secret = randomBytes(32).toString('base64');
    setSetting(db, 'turn.secret', secret);
  }
  const relayAddress =
    config.turn.relayAddress ??
    addresses.find((a) => a.includes('.')) ??
    (config.host !== '0.0.0.0' ? config.host : '127.0.0.1');
  const realm = config.siteName.replace(/[^\w.-]+/g, '-').toLowerCase() || 'site';

  const needsSetup = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n === 0;
  const setupCode = needsSetup ? newSetupCode() : null;
  // Next to the bundled server (dist/server.cjs); `--web` points elsewhere in development.
  const here = typeof __dirname === 'string' ? __dirname : process.cwd();
  const server = await createServer({
    config,
    db,
    tls,
    caPem: tls.caPem,
    web: webFiles(resolve(values.web ?? join(here, 'web'))),
    turn: { secret: turnSecret(secret), port: config.turn.port, realm },
    setupCode,
  });
  const turn = new TurnServer({
    port: config.turn.port,
    host: config.host === '0.0.0.0' ? undefined : config.host,
    relayAddress,
    relayPorts: config.turn.relayPorts,
    realm,
    secret: turnSecret(secret),
    networks,
  });
  await turn.listen();
  await server.app.listen({ host: config.host, port: config.port });

  const log = server.app.log;
  log.info(
    {
      site: config.siteName,
      port: config.port,
      turn: `${relayAddress}:${config.turn.port}`,
      addresses,
    },
    'EVACTIS 3DWORKFLOW Site Server is running on the site network only',
  );
  if (setupCode)
    log.warn(
      `First-time setup: open this server's address on port ${config.port} in a browser (HTTPS) and enter the setup code ${setupCode} to create the first administrator.`,
    );
  if (tls.caPem)
    log.info(
      `Client PCs trust this server once its certificate authority is installed; it is offered at /ca.pem on port ${config.port}`,
    );

  const stop = async () => {
    turn.close();
    await server.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  return { server, turn, config, stop };
}
