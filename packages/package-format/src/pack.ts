/**
 * Writing a package: files go in one at a time (so large tours never sit in memory at
 * once); each comes out ready to store. With a passphrase, environment files become
 * numbered encrypted blobs and their real names live only in the encrypted index; files
 * the reader needs before unlocking (the player, the quick-start PDF, the README) stay
 * readable. `finish()` returns the index and the manifest, which list everything.
 */
import { deriveKey, newKdf, seal, sha256Hex, type KdfParams } from './crypto.ts';
import {
  FORMAT,
  FORMAT_VERSION,
  INDEX_PATH,
  MANIFEST_PATH,
  type EncryptedIndex,
  type ManifestFile,
  type PackageKind,
  type PackageManifest,
} from './manifest.ts';

export interface StoredFile {
  path: string;
  data: Uint8Array;
}

export interface PackerOptions {
  kind: PackageKind;
  producer: string;
  environment: PackageManifest['environment'];
  /** Defaults to now. */
  createdAt?: string;
  kiosk?: boolean;
  /** Encrypts the environment's files when set (never stored anywhere). */
  passphrase?: string;
  onKeyProgress?: (fraction: number) => void;
}

export class Packer {
  private files: ManifestFile[] = [];
  private index: EncryptedIndex = { entries: [] };
  private key: Uint8Array | null = null;
  private kdf: KdfParams | null = null;
  private next = 1;
  private opts: PackerOptions;

  private constructor(opts: PackerOptions) {
    this.opts = opts;
  }

  static async create(opts: PackerOptions): Promise<Packer> {
    const p = new Packer(opts);
    if (opts.passphrase !== undefined) {
      if (opts.passphrase.length < 8) throw new Error('The passphrase needs at least 8 characters');
      p.kdf = newKdf();
      p.key = await deriveKey(opts.passphrase, p.kdf, opts.onKeyProgress);
    }
    return p;
  }

  get encrypted(): boolean {
    return this.key !== null;
  }

  /**
   * Adds a file. `content` files (the environment and its media) are encrypted in an
   * encrypted package; others (player, quick start, README) are stored as they are.
   */
  async add(path: string, data: Uint8Array, content = true): Promise<StoredFile> {
    if (path === MANIFEST_PATH || path === INDEX_PATH) throw new Error(`Reserved name ${path}`);
    let stored: StoredFile = { path, data };
    if (this.key && content) {
      const blob = `content/${String(this.next++).padStart(6, '0')}.bin`;
      this.index.entries.push({ path, blob, size: data.length });
      stored = { path: blob, data: await seal(this.key, blob, data) };
    }
    await this.record(stored);
    return stored;
  }

  private async record(f: StoredFile) {
    if (this.files.some((x) => x.path === f.path)) throw new Error(`Duplicate file ${f.path}`);
    this.files.push({ path: f.path, size: f.data.length, sha256: await sha256Hex(f.data) });
  }

  /** The encrypted index (if any) and the manifest: store both, the manifest last. */
  async finish(): Promise<{ files: StoredFile[]; manifest: PackageManifest }> {
    const out: StoredFile[] = [];
    if (this.key) {
      const json = new TextEncoder().encode(JSON.stringify(this.index));
      const idx = { path: INDEX_PATH, data: await seal(this.key, INDEX_PATH, json) };
      await this.record(idx);
      out.push(idx);
      this.key.fill(0);
    }
    const o = this.opts;
    const manifest: PackageManifest = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      kind: o.kind,
      createdAt: o.createdAt ?? new Date().toISOString(),
      producer: o.producer,
      environment: o.environment,
      offline: true,
      ...(o.kiosk && { kiosk: true }),
      encryption: this.kdf ? { cipher: 'AES-256-GCM', kdf: this.kdf, index: INDEX_PATH } : null,
      files: [...this.files].sort((a, b) => (a.path < b.path ? -1 : 1)),
    };
    out.push({
      path: MANIFEST_PATH,
      data: new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n'),
    });
    return { files: out, manifest };
  }
}
