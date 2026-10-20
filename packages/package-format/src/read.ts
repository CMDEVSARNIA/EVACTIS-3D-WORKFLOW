/**
 * Reading a package in the player: every file is checked against the manifest before it
 * is used, and an encrypted package's files are decrypted in memory once the reader has
 * entered the passphrase. Hands the Viewer blob URLs, so nothing decrypted is written
 * anywhere and nothing unchecked is ever shown.
 */
import { deriveKey, DecryptError, open, sha256Hex } from './crypto.ts';
import {
  contentType,
  INDEX_PATH,
  MANIFEST_PATH,
  parseManifest,
  type EncryptedIndex,
  type ManifestFile,
  type PackageManifest,
} from './manifest.ts';

/** Gets the stored bytes of a package file (fetch, a script chunk, an inline block…). */
export type ReadStored = (path: string) => Promise<Uint8Array>;

/** A file that does not match the manifest (altered, damaged or not listed). */
export class IntegrityError extends Error {
  override name = 'IntegrityError';
  readonly path: string;
  constructor(path: string) {
    super(`The package file "${path}" failed its integrity check`);
    this.path = path;
  }
}

/** The passphrase did not open the package. */
export class PassphraseError extends Error {
  override name = 'PassphraseError';
  constructor() {
    super('This passphrase does not open the package');
  }
}

export class PackageReader {
  private files: Map<string, ManifestFile>;
  private key: Uint8Array | null = null;
  private index: Map<string, EncryptedIndex['entries'][number]> | null = null;
  private urls = new Map<string, Promise<string>>();
  readonly manifest: PackageManifest;
  /** Hex SHA-256 of the manifest itself, printed on the delivery note to compare. */
  readonly digest: string;
  private read: ReadStored;

  private constructor(manifest: PackageManifest, digest: string, read: ReadStored) {
    this.manifest = manifest;
    this.digest = digest;
    this.read = read;
    this.files = new Map(manifest.files.map((f) => [f.path, f]));
  }

  static async open(read: ReadStored): Promise<PackageReader> {
    const bytes = await read(MANIFEST_PATH);
    const manifest = parseManifest(new TextDecoder().decode(bytes));
    return new PackageReader(manifest, await sha256Hex(bytes), read);
  }

  get encrypted(): boolean {
    return this.manifest.encryption !== null;
  }

  get locked(): boolean {
    return this.encrypted && !this.index;
  }

  /** The stored bytes of a listed file, verified. */
  async stored(path: string): Promise<Uint8Array> {
    const f = this.files.get(path);
    if (!f) throw new IntegrityError(path);
    let data: Uint8Array;
    try {
      data = await this.read(path);
    } catch {
      throw new IntegrityError(path);
    }
    if (data.length !== f.size || (await sha256Hex(data)) !== f.sha256)
      throw new IntegrityError(path);
    return data;
  }

  /** Opens an encrypted package; throws PassphraseError for a wrong passphrase. */
  async unlock(passphrase: string, onProgress?: (fraction: number) => void): Promise<void> {
    const e = this.manifest.encryption;
    if (!e) return;
    const blob = await this.stored(INDEX_PATH);
    const key = await deriveKey(passphrase, e.kdf, onProgress);
    let json: Uint8Array;
    try {
      json = await open(key, INDEX_PATH, blob);
    } catch (err) {
      if (err instanceof DecryptError) throw new PassphraseError();
      throw err;
    }
    const index = JSON.parse(new TextDecoder().decode(json)) as EncryptedIndex;
    this.index = new Map(index.entries.map((x) => [x.path, x]));
    this.key = key;
  }

  /** The verified (and decrypted) bytes of an environment file. */
  async bytes(path: string): Promise<Uint8Array> {
    if (!this.encrypted) return this.stored(path);
    if (!this.index || !this.key) throw new PassphraseError();
    const entry = this.index.get(path);
    if (!entry) throw new IntegrityError(path);
    const blob = await this.stored(entry.blob);
    try {
      return await open(this.key, entry.blob, blob);
    } catch {
      throw new IntegrityError(path);
    }
  }

  /** A blob URL for an environment file (made once per path). */
  url(path: string): Promise<string> {
    let u = this.urls.get(path);
    if (!u) {
      u = this.bytes(path).then((b) =>
        URL.createObjectURL(new Blob([new Uint8Array(b)], { type: contentType(path) })),
      );
      u.catch(() => this.urls.delete(path));
      this.urls.set(path, u);
    }
    return u;
  }

  /** A blob URL for a readable (unencrypted) package file, such as the quick start. */
  async urlOfStored(path: string): Promise<string> {
    const b = await this.stored(path);
    return URL.createObjectURL(new Blob([new Uint8Array(b)], { type: contentType(path) }));
  }

  /** Every listed file checked now (desktop-style launch check; reads everything). */
  async verifyAll(onProgress?: (done: number, total: number) => void): Promise<void> {
    const all = [...this.files.keys()];
    for (const [i, p] of all.entries()) {
      await this.stored(p);
      onProgress?.(i + 1, all.length);
    }
  }
}
