/**
 * What counts as the client's own network. The Site Server answers only these
 * addresses, its TURN relay forwards only to these, and it connects out only to these
 * (the LDAP server). Defaults: the private, loopback, link-local and shared ranges
 * (RFC 1918, RFC 6598, RFC 4193); a site using other internal ranges lists them in the
 * configuration (`allowedNetworks`).
 */
import { isIP } from 'node:net';

export const DEFAULT_NETWORKS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',
  '169.254.0.0/16',
  '127.0.0.0/8',
  'fc00::/7',
  'fe80::/10',
  '::1/128',
];

interface Range {
  v6: boolean;
  base: bigint;
  mask: bigint;
}

function toBigInt(address: string): { v6: boolean; value: bigint } | null {
  const kind = isIP(address);
  if (kind === 4) {
    const parts = address.split('.').map(Number);
    return { v6: false, value: parts.reduce((n, p) => (n << 8n) | BigInt(p), 0n) };
  }
  if (kind !== 6) return null;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is the IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return toBigInt(mapped[1]!);
  const [head = '', tail = ''] = address.split('::');
  const h = head ? head.split(':') : [];
  const t = address.includes('::') ? (tail ? tail.split(':') : []) : [];
  const groups = address.includes('::')
    ? [...h, ...Array<string>(8 - h.length - t.length).fill('0'), ...t]
    : h;
  if (groups.length !== 8) return null;
  return { v6: true, value: groups.reduce((n, g) => (n << 16n) | BigInt(parseInt(g, 16)), 0n) };
}

export function parseCidr(cidr: string): Range {
  const [addr = '', bitsText] = cidr.split('/');
  const a = toBigInt(addr);
  if (!a) throw new Error(`not an IP network: ${cidr}`);
  const width = a.v6 ? 128 : 32;
  const bits = bitsText === undefined ? width : Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > width) throw new Error(`bad prefix: ${cidr}`);
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(width - bits);
  return { v6: a.v6, base: a.value & mask, mask };
}

export class Networks {
  private ranges: Range[];
  constructor(cidrs: string[] = DEFAULT_NETWORKS) {
    this.ranges = cidrs.map(parseCidr);
  }
  /** True when the address belongs to the site's own network. */
  contains(address: string | undefined | null): boolean {
    if (!address) return false;
    const a = toBigInt(address.replace(/%.*$/, ''));
    if (!a) return false;
    return this.ranges.some((r) => r.v6 === a.v6 && (a.value & r.mask) === r.base);
  }
}
