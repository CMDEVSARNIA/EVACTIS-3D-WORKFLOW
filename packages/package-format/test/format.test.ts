import { readFileSync } from 'node:fs';
import { gcm } from '@noble/ciphers/aes.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveKey,
  fromBase64,
  IntegrityError,
  MANIFEST_PATH,
  ManifestError,
  open,
  Packer,
  PackageReader,
  parseManifest,
  PassphraseError,
  ReadError,
  seal,
  sha256Hex,
  toHex,
  type StoredFile,
} from '../src/index.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const ENV = { id: 'demo', title: { en: 'Demo', fr: 'Démo' }, updatedAt: '2026-10-20T00:00:00Z' };

/** Builds a package in memory: stored files by path. */
async function build(passphrase?: string): Promise<Map<string, Uint8Array>> {
  const p = await Packer.create({
    kind: 'intranet',
    producer: 'test',
    environment: ENV,
    passphrase,
  });
  const out: StoredFile[] = [];
  out.push(await p.add('index.html', enc('<!doctype html>'), false));
  out.push(await p.add('environment.json', enc('{"id":"demo"}')));
  out.push(await p.add('media/lobby/a.jpg', new Uint8Array([1, 2, 3, 4])));
  out.push(...(await p.finish()).files);
  return new Map(out.map((f) => [f.path, f.data]));
}
const reader = (files: Map<string, Uint8Array>) =>
  PackageReader.open(async (path) => {
    const f = files.get(path);
    if (!f) throw new Error('missing');
    return f;
  });

afterEach(() => {
  delete (globalThis as { isSecureContext?: boolean }).isSecureContext;
});

describe('integrity manifest', () => {
  it('lists every file with its SHA-256 and a version/date stamp', async () => {
    const files = await build();
    const m = parseManifest(dec(files.get(MANIFEST_PATH)!));
    expect(m).toMatchObject({
      kind: 'intranet',
      offline: true,
      encryption: null,
      environment: ENV,
    });
    expect(m.files.map((f) => f.path)).toEqual([
      'environment.json',
      'index.html',
      'media/lobby/a.jpg',
    ]);
    expect(m.files[0]!.sha256).toBe(await sha256Hex(enc('{"id":"demo"}')));
    expect(Date.parse(m.createdAt)).not.toBeNaN();
    const r = await reader(files);
    expect(dec(await r.bytes('environment.json'))).toBe('{"id":"demo"}');
    await expect(r.verifyAll()).resolves.toBeUndefined();
  });

  it('refuses an altered file, an unlisted file and a missing one', async () => {
    const files = await build();
    files.set('media/lobby/a.jpg', new Uint8Array([1, 2, 3, 5]));
    const r = await reader(files);
    await expect(r.bytes('media/lobby/a.jpg')).rejects.toBeInstanceOf(IntegrityError);
    await expect(r.bytes('media/other.jpg')).rejects.toBeInstanceOf(IntegrityError);
    await expect(r.verifyAll()).rejects.toThrow(/a\.jpg" failed its integrity check/);
    // A file that cannot be read is a read problem, not proof of tampering.
    files.delete('environment.json');
    await expect(r.bytes('environment.json')).rejects.toBeInstanceOf(ReadError);
  });

  it('retries a read that fails once (a busy server), and is not fooled into an alarm', async () => {
    const files = await build();
    let failures = 1;
    const flaky = await PackageReader.open(async (p) => {
      if (p === 'environment.json' && failures-- > 0) throw new Error('503');
      const b = files.get(p);
      if (!b) throw new Error('404');
      return b;
    });
    expect(dec(await flaky.bytes('environment.json'))).toBe('{"id":"demo"}');
    const down = await PackageReader.open(async (p) => {
      if (p === 'environment.json') throw new Error('connection reset');
      return files.get(p)!;
    });
    const e = await down.bytes('environment.json').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ReadError);
    expect(e).not.toBeInstanceOf(IntegrityError);
    expect(String(e)).toMatch(/environment\.json" could not be read \(Error: connection reset\)/);
  });

  it('rejects manifests that are not ours or that escape the package', () => {
    const ok = {
      format: 'evactis-3dworkflow-package',
      formatVersion: 1,
      kind: 'evx',
      files: [{ path: 'a.jpg', size: 1, sha256: 'a'.repeat(64) }],
      encryption: null,
    };
    expect(() => parseManifest(JSON.stringify(ok))).not.toThrow();
    const accented = {
      ...ok,
      files: [{ ...ok.files[0], path: 'Quick start - Démarrage rapide.pdf' }],
    };
    expect(() => parseManifest(JSON.stringify(accented))).not.toThrow();
    for (const path of ['../x', '/etc/passwd', 'a/../../b', 'evx-manifest.json', 'a\\b'])
      expect(() =>
        parseManifest(JSON.stringify({ ...ok, files: [{ ...ok.files[0], path }] })),
      ).toThrow(ManifestError);
    expect(() => parseManifest('{"format":"zip"}')).toThrow(/Not an EVACTIS/);
    const kdf = {
      name: 'Argon2id',
      memoryKiB: 4 * 1024 * 1024,
      iterations: 2,
      parallelism: 1,
      salt: 'AA==',
    };
    expect(() =>
      parseManifest(
        JSON.stringify({
          ...ok,
          files: [...ok.files, { path: 'content/index.bin', size: 1, sha256: 'b'.repeat(64) }],
          encryption: { cipher: 'AES-256-GCM', kdf, index: 'content/index.bin' },
        }),
      ),
    ).toThrow(/Unsupported encryption/);
  });
});

describe('passphrase encryption', () => {
  it('stores content as numbered blobs; names only in the encrypted index', async () => {
    const files = await build('correct horse battery');
    const paths = [...files.keys()].sort();
    expect(paths).toEqual([
      'content/000001.bin',
      'content/000002.bin',
      'content/index.bin',
      'evx-manifest.json',
      'index.html',
    ]);
    const text = [...files.values()].map(dec).join('');
    expect(text).not.toContain('environment.json');
    expect(text).not.toContain('{"id":"demo"}');
    const m = parseManifest(dec(files.get(MANIFEST_PATH)!));
    expect(m.encryption).toMatchObject({
      cipher: 'AES-256-GCM',
      kdf: { name: 'Argon2id', memoryKiB: 65536 },
    });
  }, 30_000);

  it('opens with the right passphrase and refuses a wrong one', async () => {
    const files = await build('correct horse battery');
    const r = await reader(files);
    expect(r.locked).toBe(true);
    await expect(r.bytes('environment.json')).rejects.toBeInstanceOf(PassphraseError);
    await expect(r.unlock('wrong horse battery')).rejects.toBeInstanceOf(PassphraseError);
    expect(r.locked).toBe(true);
    await r.unlock('correct horse battery');
    expect(dec(await r.bytes('environment.json'))).toBe('{"id":"demo"}');
    expect([...(await r.bytes('media/lobby/a.jpg'))]).toEqual([1, 2, 3, 4]);
  }, 30_000);

  it('a swapped or altered blob fails even with the right passphrase', async () => {
    const files = await build('correct horse battery');
    const a = files.get('content/000001.bin')!;
    files.set('content/000001.bin', files.get('content/000002.bin')!);
    files.set('content/000002.bin', a);
    const r = await reader(files);
    // The manifest's hashes catch it first.
    await expect(r.unlock('correct horse battery')).resolves.toBeUndefined();
    await expect(r.bytes('environment.json')).rejects.toBeInstanceOf(IntegrityError);
  }, 30_000);

  it('WebCrypto and the pure-JavaScript fallback produce and read the same blobs', async () => {
    const key = new Uint8Array(32).fill(7);
    const viaSubtle = await seal(key, 'content/000001.bin', enc('hello'));
    (globalThis as { isSecureContext?: boolean }).isSecureContext = false;
    expect(dec(await open(key, 'content/000001.bin', viaSubtle))).toBe('hello');
    const viaNoble = await seal(key, 'content/000001.bin', enc('hello'));
    delete (globalThis as { isSecureContext?: boolean }).isSecureContext;
    expect(dec(await open(key, 'content/000001.bin', viaNoble))).toBe('hello');
    await expect(open(key, 'content/000002.bin', viaNoble)).rejects.toThrow(/decrypted/);
  });
});

/** The vector the Rust reader (crates/evx-package) is tested against, so both agree. */
describe('cross-implementation vector', () => {
  it('matches crates/evx-package/tests/vector.json', async () => {
    const v = JSON.parse(
      readFileSync(
        new URL('../../../crates/evx-package/tests/vector.json', import.meta.url),
        'utf8',
      ),
    ) as {
      passphrase: string;
      kdf: {
        name: 'Argon2id';
        memoryKiB: number;
        iterations: number;
        parallelism: number;
        salt: string;
      };
      key: string;
      name: string;
      nonce: string;
      plain: string;
      blob: string;
    };
    const key = await deriveKey(v.passphrase, v.kdf);
    expect(toHex(key)).toBe(v.key);
    const nonce = fromBase64(v.nonce);
    const body = gcm(key, nonce, enc(v.name)).encrypt(enc(v.plain));
    const blob = new Uint8Array([...nonce, ...body]);
    expect(toHex(blob)).toBe(v.blob);
    expect(dec(await open(key, v.name, blob))).toBe(v.plain);
  });
});
