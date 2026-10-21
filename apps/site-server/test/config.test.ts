import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.ts';

const ldap = {
  url: 'ldap://10.0.0.5',
  bindDN: 'cn=reader,dc=site,dc=lan',
  bindPassword: 'secret',
  baseDN: 'dc=site,dc=lan',
  userFilter: '(uid={username})',
  adminGroup: 'cn=admins,dc=site,dc=lan',
  memberGroup: 'cn=members,dc=site,dc=lan',
};
const withLdap = (extra: Record<string, unknown>) => {
  const dir = mkdtempSync(join(tmpdir(), 'evx-config-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ ldap: { ...ldap, ...extra } }));
  return () => loadConfig(dir);
};

describe('directory sign-in configuration', () => {
  it('refuses plain ldap:// without StartTLS: passwords would cross the network in clear', () => {
    expect(withLdap({})).toThrow(ConfigError);
    expect(withLdap({})).toThrow(/startTls/);
  });

  it('accepts StartTLS, ldaps://, or an explicit opt-in to plain LDAP', () => {
    expect(withLdap({ startTls: true })).not.toThrow();
    expect(withLdap({ url: 'ldaps://10.0.0.5' })).not.toThrow();
    expect(withLdap({ allowPlainLdap: true })).not.toThrow();
  });
});
