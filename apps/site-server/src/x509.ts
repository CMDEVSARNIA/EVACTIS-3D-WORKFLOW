/**
 * The Site Server's own certificates, made with node:crypto and a small DER encoder (no
 * certificate library). Browsers allow microphone and camera (guided sessions) only on
 * HTTPS, so on first start the server makes a local certificate authority and a server
 * certificate for its LAN names and addresses. IT installs the authority's certificate
 * (`ca.pem`, public) on client PCs, or replaces both with the site's own PKI.
 *
 * Keys are ECDSA P-256; signatures ECDSA with SHA-256.
 */
import {
  X509Certificate,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { isIP } from 'node:net';

// ---------------------------------------------------------------- DER encoding
function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, body: Buffer) =>
  Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const ctx = (n: number, body: Buffer, constructed = true) =>
  tlv((constructed ? 0xa0 : 0x80) | n, body);
const octets = (b: Buffer) => tlv(0x04, b);
const bits = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
const bool = (v: boolean) => tlv(0x01, Buffer.from([v ? 0xff : 0]));

function integer(b: Buffer): Buffer {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  const v = b.subarray(i);
  return tlv(0x02, v[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), v]) : v);
}

function oid(dotted: string): Buffer {
  const [a = 0, b = 0, ...rest] = dotted.split('.').map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >> 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

function time(d: Date): Buffer {
  // UTCTime up to 2049, GeneralizedTime after (RFC 5280 4.1.2.5).
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  return d.getUTCFullYear() < 2050
    ? tlv(0x17, Buffer.from(iso.slice(2)))
    : tlv(0x18, Buffer.from(iso));
}

const OID = {
  ecPublicKey: '1.2.840.10045.2.1',
  p256: '1.2.840.10045.3.1.7',
  ecdsaSha256: '1.2.840.10045.4.3.2',
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  extKeyUsage: '2.5.29.37',
  subjectAltName: '2.5.29.17',
  subjectKeyId: '2.5.29.14',
  authorityKeyId: '2.5.29.35',
  serverAuth: '1.3.6.1.5.5.7.3.1',
};

const name = (cn: string) =>
  seq(set(seq(oid(OID.organization), utf8('Evactis'))), set(seq(oid(OID.commonName), utf8(cn))));
const ext = (id: string, critical: boolean, value: Buffer) =>
  seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));

function ipBytes(ip: string): Buffer {
  if (isIP(ip) === 4) return Buffer.from(ip.split('.').map(Number));
  const [h = '', t = ''] = ip.split('::');
  const head = h ? h.split(':') : [];
  const tail = ip.includes('::') && t ? t.split(':') : [];
  const groups = ip.includes('::')
    ? [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail]
    : head;
  return Buffer.concat(
    groups.map((g) => Buffer.from([(parseInt(g, 16) >> 8) & 0xff, parseInt(g, 16) & 0xff])),
  );
}

// ---------------------------------------------------------------- certificates
export interface Issued {
  /** PEM certificate and PKCS#8 PEM private key. */
  cert: string;
  key: string;
}

interface CertSpec {
  subject: string;
  publicKey: KeyObject;
  /** Issuer name and key; the subject's own for the authority (self-signed). */
  issuer: string;
  issuerKey: KeyObject;
  issuerPublicKey: KeyObject;
  days: number;
  ca: boolean;
  names?: string[];
  now?: Date;
}

const spki = (k: KeyObject) => k.export({ type: 'spki', format: 'der' });
/** Key identifier: SHA-1 of the subject public key bits (RFC 5280 method 1). */
function keyId(k: KeyObject): Buffer {
  const der = spki(k);
  // The BIT STRING is the last element of SubjectPublicKeyInfo; its value starts after
  // the tag, length and the unused-bits byte. For P-256 that is the last 65 bytes.
  return createHash('sha1')
    .update(der.subarray(der.length - 65))
    .digest();
}

function certificate(s: CertSpec): string {
  const now = s.now ?? new Date();
  const notBefore = new Date(now.getTime() - 60 * 60 * 1000);
  const notAfter = new Date(now.getTime() + s.days * 86_400_000);
  const serial = randomBytes(16);
  serial[0]! &= 0x7f;
  const algorithm = seq(oid(OID.ecdsaSha256));
  const exts = [
    ext(OID.basicConstraints, true, s.ca ? seq(bool(true), tlv(0x02, Buffer.from([0]))) : seq()),
    // keyCertSign + cRLSign for the authority; digitalSignature for the server.
    ext(OID.keyUsage, true, s.ca ? bits(Buffer.from([0x06])) : bits(Buffer.from([0x80]))),
    ext(OID.subjectKeyId, false, octets(keyId(s.publicKey))),
    ext(OID.authorityKeyId, false, seq(ctx(0, keyId(s.issuerPublicKey), false))),
  ];
  if (!s.ca) {
    exts.push(ext(OID.extKeyUsage, false, seq(oid(OID.serverAuth))));
    const alt = (s.names ?? []).map((n) =>
      isIP(n) ? ctx(7, ipBytes(n), false) : ctx(2, Buffer.from(n, 'ascii'), false),
    );
    exts.push(ext(OID.subjectAltName, false, seq(...alt)));
  }
  const tbs = seq(
    ctx(0, integer(Buffer.from([2]))),
    integer(serial),
    algorithm,
    name(s.issuer),
    seq(time(notBefore), time(notAfter)),
    name(s.subject),
    Buffer.from(spki(s.publicKey)),
    ctx(3, seq(...exts)),
  );
  const signature = sign('sha256', tbs, { key: s.issuerKey, dsaEncoding: 'der' });
  const der = seq(tbs, algorithm, bits(signature));
  const b64 = der.toString('base64').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN CERTIFICATE-----\n${b64.trim()}\n-----END CERTIFICATE-----\n`;
}

const newKey = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pkcs8 = (k: KeyObject) => k.export({ type: 'pkcs8', format: 'pem' }).toString();

/** A local certificate authority for one site (10 years). */
export function makeAuthority(site: string, now?: Date): Issued {
  const { publicKey, privateKey } = newKey();
  const subject = `EVACTIS 3DWORKFLOW Site Server CA (${site})`;
  return {
    cert: certificate({
      subject,
      publicKey,
      issuer: subject,
      issuerKey: privateKey,
      issuerPublicKey: publicKey,
      days: 3650,
      ca: true,
      now,
    }),
    key: pkcs8(privateKey),
  };
}

/**
 * A server certificate for the given host names and IP addresses, signed by the
 * authority. 397 days, within what browsers accept for any TLS certificate.
 */
export function issueServer(ca: Issued, names: string[], now?: Date): Issued {
  const { publicKey, privateKey } = newKey();
  const caKey = createPrivateKey(ca.key);
  const issuer = authoritySubject(ca.cert);
  return {
    cert: certificate({
      subject: names[0] ?? 'localhost',
      publicKey,
      issuer,
      issuerKey: caKey,
      issuerPublicKey: createPublicKey(caKey),
      days: 397,
      ca: false,
      names,
      now,
    }),
    key: pkcs8(privateKey),
  };
}

/** The authority's common name, read back from its certificate (the issuer name must match). */
function authoritySubject(pem: string): string {
  const cn = /CN=(.+)/.exec(new X509Certificate(pem).subject)?.[1]?.trim();
  if (!cn) throw new Error('not a Site Server authority certificate');
  return cn;
}
