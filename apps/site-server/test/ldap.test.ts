import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'ldapts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LdapConfig } from '../src/config.ts';
import { Networks } from '../src/lan.ts';
import { Directory, LdapError, escapeFilter } from '../src/ldap.ts';

/**
 * Sign-in against a real OpenLDAP server (slapd, started here on loopback with the
 * memberOf overlay, as Active Directory provides memberOf natively), and against the
 * same directory without memberOf (groups looked up by member).
 */
const SLAPD = '/usr/sbin/slapd';
// Skipped only on a developer machine without slapd; CI installs it and must run these.
const HAVE = existsSync(SLAPD) || !!process.env.CI;
const BASE = 'dc=riverside,dc=lan';
let slapd: ChildProcess | null = null;
let url = '';

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

beforeAll(async () => {
  if (!HAVE) return;
  const dir = mkdtempSync(join(tmpdir(), 'evx-slapd-'));
  mkdirSync(join(dir, 'db'));
  writeFileSync(
    join(dir, 'slapd.conf'),
    [
      'include /etc/ldap/schema/core.schema',
      'include /etc/ldap/schema/cosine.schema',
      'include /etc/ldap/schema/inetorgperson.schema',
      'modulepath /usr/lib/ldap',
      'moduleload back_mdb',
      'moduleload memberof',
      `pidfile ${dir}/slapd.pid`,
      'database mdb',
      `suffix "${BASE}"`,
      `rootdn "cn=admin,${BASE}"`,
      'rootpw admin-secret',
      `directory ${dir}/db`,
      'overlay memberof',
      '',
    ].join('\n'),
  );
  const port = await freePort();
  url = `ldap://127.0.0.1:${port}`;
  slapd = spawn(SLAPD, ['-d', '0', '-f', join(dir, 'slapd.conf'), '-h', `${url}/`], {
    stdio: 'ignore',
  });
  const admin = new Client({ url });
  for (let i = 0; ; i++) {
    try {
      await admin.bind(`cn=admin,${BASE}`, 'admin-secret');
      break;
    } catch (e) {
      if (i > 50) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const add = (dn: string, attrs: Record<string, string | string[]>) => admin.add(dn, attrs);
  await add(BASE, {
    objectClass: ['top', 'dcObject', 'organization'],
    dc: 'riverside',
    o: 'Riverside',
  });
  for (const ou of ['people', 'groups', 'services'])
    await add(`ou=${ou},${BASE}`, { objectClass: 'organizationalUnit', ou });
  await add(`cn=reader,ou=services,${BASE}`, {
    objectClass: ['inetOrgPerson'],
    cn: 'reader',
    sn: 'reader',
    userPassword: 'reader-secret',
  });
  const person = (uid: string, name: string) =>
    add(`uid=${uid},ou=people,${BASE}`, {
      objectClass: ['inetOrgPerson'],
      uid,
      cn: name,
      sn: name.split(' ').at(-1)!,
      displayName: name,
      userPassword: `${uid}-password`,
    });
  await person('ada', 'Ada Lovelace');
  await person('bob', 'Bob Builder');
  await person('eve', 'Eve Outsider');
  await add(`cn=evx-admins,ou=groups,${BASE}`, {
    objectClass: 'groupOfNames',
    cn: 'evx-admins',
    member: `uid=ada,ou=people,${BASE}`,
  });
  await add(`cn=evx-members,ou=groups,${BASE}`, {
    objectClass: 'groupOfNames',
    cn: 'evx-members',
    member: [`uid=bob,ou=people,${BASE}`, `uid=ada,ou=people,${BASE}`],
  });
  await admin.unbind();
}, 30_000);

afterAll(() => {
  slapd?.kill();
});

const config = (): LdapConfig => ({
  url,
  bindDN: `cn=reader,ou=services,${BASE}`,
  bindPassword: 'reader-secret',
  baseDN: `ou=people,${BASE}`,
  userFilter: '(uid={username})',
  adminGroup: `cn=evx-admins,ou=groups,${BASE}`,
  memberGroup: `cn=evx-members,ou=groups,${BASE}`,
});

describe('LDAP / Active Directory sign-in', () => {
  it('escapes filter values (RFC 4515)', () => {
    expect(escapeFilter('a*b(c)\\d\0')).toBe('a\\2ab\\28c\\29\\5cd\\00');
  });

  it.runIf(HAVE)('maps directory groups to roles', async () => {
    const d = new Directory(config(), new Networks());
    expect(await d.authenticate('ada', 'ada-password')).toEqual({
      username: 'ada',
      displayName: 'Ada Lovelace',
      role: 'admin',
    });
    expect(await d.authenticate('bob', 'bob-password')).toMatchObject({ role: 'member' });
  });

  it.runIf(HAVE)('works without memberOf, by asking the group', async () => {
    // A group DN spelled differently from memberOf values forces the member lookup.
    const c = { ...config(), memberGroup: `CN=evx-members, OU=groups, ${BASE.toUpperCase()}` };
    expect(
      await new Directory(c, new Networks()).authenticate('bob', 'bob-password'),
    ).toMatchObject({
      role: 'member',
    });
  });

  it.runIf(HAVE)('refuses wrong passwords, empty passwords and filter injection', async () => {
    const d = new Directory(config(), new Networks());
    expect(await d.authenticate('bob', 'wrong')).toBeNull();
    expect(await d.authenticate('bob', '')).toBeNull();
    expect(await d.authenticate('*', 'bob-password')).toBeNull();
    expect(await d.authenticate('bob)(uid=*', 'bob-password')).toBeNull();
    expect(await d.authenticate('nobody', 'x')).toBeNull();
  });

  it.runIf(HAVE)(
    'refuses people outside the allowed groups, after checking their password',
    async () => {
      const d = new Directory(config(), new Networks());
      expect(await d.authenticate('eve', 'wrong')).toBeNull();
      await expect(d.authenticate('eve', 'eve-password')).rejects.toBeInstanceOf(LdapError);
    },
  );

  it.runIf(HAVE)('never connects to a directory outside the site network', async () => {
    const d = new Directory(config(), new Networks(['10.0.0.0/8']));
    await expect(d.authenticate('ada', 'ada-password')).rejects.toThrow(
      /not on the site's network/,
    );
  });
});
