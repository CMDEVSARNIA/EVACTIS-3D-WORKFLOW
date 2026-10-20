/**
 * Sign-in against the site's own LDAP directory or Active Directory (no cloud identity
 * provider). The service account looks the user up, the user's own credentials are then
 * checked with a bind, and group membership decides the role. The directory must be on
 * the site's network: its address is checked before any connection is made.
 */
import { readFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { Client, EqualityFilter } from 'ldapts';
import type { LdapConfig } from './config.ts';
import type { Networks } from './lan.ts';
import type { Role } from './accounts.ts';

export interface DirectoryUser {
  username: string;
  displayName: string;
  role: Role;
}

export class LdapError extends Error {
  override name = 'LdapError';
}

/** RFC 4515 escaping for a value placed in a search filter. */
export function escapeFilter(v: string): string {
  return v.replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

const sameDn = (a: string, b: string) =>
  a.replace(/\s*,\s*/g, ',').toLowerCase() === b.replace(/\s*,\s*/g, ',').toLowerCase();

export class Directory {
  constructor(
    private config: LdapConfig,
    private networks: Networks,
  ) {}

  private async client(): Promise<Client> {
    const url = new URL(this.config.url);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const { address } = await lookup(host);
    if (!this.networks.contains(address))
      throw new LdapError(`The directory ${host} (${address}) is not on the site's network`);
    const ca = this.config.caFile ? [readFileSync(this.config.caFile)] : undefined;
    const tlsOptions = ca ? { ca, servername: host } : { servername: host };
    const client = new Client({
      url: this.config.url,
      timeout: 10_000,
      connectTimeout: 5_000,
      ...(url.protocol === 'ldaps:' ? { tlsOptions } : {}),
    });
    if (this.config.startTls) await client.startTLS(tlsOptions);
    return client;
  }

  /** The directory user for these credentials, or null when they are wrong. */
  async authenticate(username: string, password: string): Promise<DirectoryUser | null> {
    // An empty password would be an "unauthenticated bind", which many servers accept.
    if (!username || !password) return null;
    const client = await this.client();
    try {
      await client.bind(this.config.bindDN, this.config.bindPassword);
      const filter = this.config.userFilter.replace('{username}', escapeFilter(username));
      const { searchEntries } = await client.search(this.config.baseDN, {
        scope: 'sub',
        filter,
        attributes: ['dn', 'cn', 'displayName', 'memberOf'],
        sizeLimit: 2,
      });
      if (searchEntries.length !== 1) return null;
      const entry = searchEntries[0]!;
      const groups = ([] as unknown[]).concat(entry.memberOf ?? []).map(String);
      const inGroup = async (group: string) => {
        if (!group) return false;
        if (groups.some((g) => sameDn(g, group))) return true;
        // Directories without memberOf: ask the group for this member.
        const r = await client.search(group, {
          scope: 'base',
          filter: new EqualityFilter({ attribute: 'member', value: entry.dn }),
          attributes: ['dn'],
        });
        return r.searchEntries.length > 0;
      };
      const role: Role | null = (await inGroup(this.config.adminGroup))
        ? 'admin'
        : (await inGroup(this.config.memberGroup))
          ? 'member'
          : null;
      try {
        await client.bind(entry.dn, password);
      } catch {
        return null;
      }
      if (!role) throw new LdapError(`${username} is not in a group allowed on this site`);
      const name = String(entry.displayName || entry.cn || username);
      return { username, displayName: name, role };
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }
}
