import { execFileSync } from 'node:child_process';
import { X509Certificate, createPublicKey } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { connect } from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { issueServer, makeAuthority } from '../src/x509.ts';

describe('local certificates', () => {
  const ca = makeAuthority('Riverside');
  const server = issueServer(ca, ['site.riverside.lan', 'localhost', '127.0.0.1', '10.20.0.5']);

  it('makes a self-signed authority and a server certificate it signed', () => {
    const caCert = new X509Certificate(ca.cert);
    const leaf = new X509Certificate(server.cert);
    expect(caCert.ca).toBe(true);
    expect(caCert.verify(caCert.publicKey)).toBe(true);
    expect(leaf.ca).toBe(false);
    expect(leaf.verify(createPublicKey(ca.key))).toBe(true);
    expect(leaf.checkIssued(caCert)).toBe(true);
    expect(leaf.checkHost('site.riverside.lan')).toBe('site.riverside.lan');
    expect(leaf.checkIP('10.20.0.5')).toBe('10.20.0.5');
    expect(leaf.checkIP('10.20.0.6')).toBeUndefined();
    const days = (Date.parse(leaf.validTo) - Date.parse(leaf.validFrom)) / 86_400_000;
    expect(days).toBeLessThanOrEqual(398);
    expect(leaf.keyUsage).toContain('1.3.6.1.5.5.7.3.1');
  });

  it('passes OpenSSL verification for a TLS server', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evx-x509-'));
    writeFileSync(join(dir, 'ca.pem'), ca.cert);
    writeFileSync(join(dir, 'server.pem'), server.cert);
    const out = execFileSync(
      'openssl',
      [
        'verify',
        '-purpose',
        'sslserver',
        '-verify_ip',
        '10.20.0.5',
        '-CAfile',
        'ca.pem',
        'server.pem',
      ],
      { cwd: dir, encoding: 'utf8' },
    );
    expect(out).toContain('server.pem: OK');
  });

  it('a TLS client that trusts only the authority connects', async () => {
    const https = createServer({ cert: server.cert, key: server.key }, (_q, r) => r.end('ok'));
    await new Promise<void>((r) => https.listen(0, '127.0.0.1', r));
    const port = (https.address() as { port: number }).port;
    const authorized = await new Promise<boolean>((resolve, reject) => {
      const s = connect({ host: '127.0.0.1', port, ca: ca.cert, servername: 'localhost' }, () => {
        resolve(s.authorized);
        s.end();
      });
      s.on('error', reject);
    });
    https.close();
    expect(authorized).toBe(true);
  });
});
