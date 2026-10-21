/**
 * Site Server configuration: one JSON file (default `<data>/config.json`), written with
 * defaults on first start. Everything has a safe default: HTTPS on 8443 with a local
 * certificate authority, TURN on 3478/udp, reports off, local accounts only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_NETWORKS, parseCidr } from './lan.ts';

export interface LdapConfig {
  /** ldap:// or ldaps:// on the site's own network. */
  url: string;
  /** Service account used to look users up (read-only). */
  bindDN: string;
  bindPassword: string;
  baseDN: string;
  /** `{username}` is replaced by the escaped login name. */
  userFilter: string;
  /** Members of this group are administrators; of `memberGroup`, members. */
  adminGroup: string;
  memberGroup: string;
  /** PEM of the directory's certificate authority, for ldaps:// or StartTLS. */
  caFile?: string;
  startTls?: boolean;
  /**
   * Sign in over plain ldap:// without StartTLS, which sends people's passwords across
   * the network unencrypted. Refused unless set; never recommended.
   */
  allowPlainLdap?: boolean;
}

export interface Config {
  /** Shown in the portal and in certificate names, e.g. "Riverside Hospital". */
  siteName: string;
  dataDir: string;
  host: string;
  port: number;
  tls: {
    /** Use the site's own certificate instead of the generated local authority. */
    certFile?: string;
    keyFile?: string;
    /** Extra host names or addresses for the generated certificate. */
    names: string[];
  };
  turn: {
    port: number;
    /** Address peers reach the relay on (the server's LAN address); auto when empty. */
    relayAddress?: string;
    /** Relay ports (open these for UDP if a host firewall is on). */
    relayPorts: [number, number];
  };
  /** Networks the server serves, relays to and connects to. */
  allowedNetworks: string[];
  ldap?: LdapConfig;
  /** Largest environment upload, in megabytes. */
  maxUploadMB: number;
  /** Largest photo attached to a note, in megabytes. */
  maxPhotoMB: number;
  /** Idle time before a signed-in session ends, in hours. */
  sessionHours: number;
}

export function defaults(dataDir: string): Config {
  return {
    siteName: 'Site',
    dataDir,
    host: '0.0.0.0',
    port: 8443,
    tls: { names: [] },
    turn: { port: 3478, relayPorts: [49160, 49200] },
    allowedNetworks: DEFAULT_NETWORKS,
    maxUploadMB: 8192,
    maxPhotoMB: 10,
    sessionHours: 12,
  };
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function check(c: Config): Config {
  const fail = (m: string) => {
    throw new ConfigError(m);
  };
  if (!c.siteName.trim()) fail('siteName is empty');
  for (const p of [c.port, c.turn.port, ...c.turn.relayPorts])
    if (!Number.isInteger(p) || p < 1 || p > 65535) fail(`bad port ${p}`);
  if (c.turn.relayPorts[0] > c.turn.relayPorts[1]) fail('turn.relayPorts: first > last');
  for (const n of c.allowedNetworks) {
    try {
      parseCidr(n);
    } catch (e) {
      fail(`allowedNetworks: ${(e as Error).message}`);
    }
  }
  if (!!c.tls.certFile !== !!c.tls.keyFile) fail('tls.certFile and tls.keyFile go together');
  if (c.ldap) {
    if (!/^ldaps?:\/\//.test(c.ldap.url)) fail('ldap.url must start with ldap:// or ldaps://');
    if (!c.ldap.userFilter.includes('{username}')) fail('ldap.userFilter needs {username}');
    if (c.ldap.url.startsWith('ldap://') && !c.ldap.startTls && !c.ldap.allowPlainLdap)
      fail(
        'ldap.url is plain ldap:// without startTls: passwords would cross the network in clear. Use ldaps://, set "startTls": true, or (not recommended) "allowPlainLdap": true',
      );
  }
  return c;
}

/** Loads `<dataDir>/config.json` (or `file`), writing the defaults when it is missing. */
export function loadConfig(dataDir: string, file?: string): Config {
  const dir = resolve(dataDir);
  mkdirSync(dir, { recursive: true });
  const path = file ? resolve(file) : join(dir, 'config.json');
  const base = defaults(dir);
  if (!existsSync(path)) {
    const { dataDir: _omit, ...written } = base;
    void _omit;
    writeFileSync(path, `${JSON.stringify(written, null, 2)}\n`, { mode: 0o600 });
    return check(base);
  }
  let raw: Partial<Config>;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>;
  } catch (e) {
    throw new ConfigError(`${path}: ${(e as Error).message}`);
  }
  return check({
    ...base,
    ...raw,
    dataDir: dir,
    tls: { ...base.tls, ...raw.tls },
    turn: { ...base.turn, ...raw.turn },
  });
}
