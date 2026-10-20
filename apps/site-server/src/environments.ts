/**
 * Environments the site serves: `.evx` packages made in Studio, uploaded by an
 * administrator. Every file is checked against the package's SHA-256 manifest before the
 * upload is accepted, so a damaged or altered copy is refused at the door; browsers check
 * each file again as they read it. Encrypted packages stay encrypted on the server: it
 * never sees the passphrase, and readers unlock them in their own browser.
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PackageReader } from '@evactis-3dworkflow/package-format';
import type { Db } from './db.ts';
import { EvxFile } from './evxfile.ts';

export interface EnvironmentInfo {
  id: string;
  title: Record<string, string>;
  size: number;
  encrypted: boolean;
  digest: string;
  uploadedAt: string;
}

interface Row {
  id: string;
  title: string;
  file: string;
  size: number;
  encrypted: number;
  digest: string;
  uploaded_at: string;
}

const toInfo = (r: Row): EnvironmentInfo => ({
  id: r.id,
  title: JSON.parse(r.title) as Record<string, string>,
  size: r.size,
  encrypted: !!r.encrypted,
  digest: r.digest,
  uploadedAt: r.uploaded_at,
});

export class UploadError extends Error {
  override name = 'UploadError';
}

export class Environments {
  private open = new Map<string, Promise<EvxFile>>();
  private dir: string;

  constructor(
    private db: Db,
    dataDir: string,
  ) {
    this.dir = join(dataDir, 'environments');
  }

  list(): EnvironmentInfo[] {
    return (
      this.db
        .prepare('SELECT * FROM environments ORDER BY uploaded_at DESC')
        .all() as unknown as Row[]
    ).map(toInfo);
  }

  get(id: string): EnvironmentInfo | null {
    const r = this.db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as Row | undefined;
    return r ? toInfo(r) : null;
  }

  /** Stores an uploaded `.evx` after checking every file in it; returns its record. */
  async add(body: Readable, maxBytes: number, userId: string): Promise<EnvironmentInfo> {
    await mkdir(this.dir, { recursive: true });
    const id = randomUUID();
    const partial = join(this.dir, `${id}.evx.partial`);
    let size = 0;
    try {
      body.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes)
          body.destroy(new UploadError('The package is larger than this server accepts'));
      });
      await pipeline(body, createWriteStream(partial, { mode: 0o600 }));
      const evx = await EvxFile.open(partial).catch((e: Error) => {
        throw new UploadError(`Not a 3DWORKFLOW package: ${e.message}`);
      });
      let pkg: PackageReader;
      try {
        pkg = await PackageReader.open((p) => evx.read(p));
        await pkg.verifyAll();
      } catch (e) {
        throw new UploadError(`The package failed its check: ${(e as Error).message}`);
      } finally {
        await evx.close();
      }
      const file = `${id}.evx`;
      await rename(partial, join(this.dir, file));
      this.db
        .prepare(
          `INSERT INTO environments (id, title, file, size, encrypted, digest, uploaded_by, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          JSON.stringify(pkg.manifest.environment.title),
          file,
          size,
          pkg.encrypted ? 1 : 0,
          pkg.digest,
          userId,
          new Date().toISOString(),
        );
      return this.get(id)!;
    } catch (e) {
      await rm(partial, { force: true });
      throw e;
    }
  }

  async remove(id: string): Promise<boolean> {
    const r = this.db.prepare('SELECT file FROM environments WHERE id = ?').get(id) as
      | { file: string }
      | undefined;
    if (!r) return false;
    const f = this.open.get(id);
    this.open.delete(id);
    if (f) await (await f).close();
    this.db.prepare('DELETE FROM environments WHERE id = ?').run(id);
    await rm(join(this.dir, r.file), { force: true });
    return true;
  }

  /** The stored bytes of one file of an environment, or null when it has no such file. */
  async read(id: string, path: string): Promise<Buffer | null> {
    const r = this.db.prepare('SELECT file FROM environments WHERE id = ?').get(id) as
      | { file: string }
      | undefined;
    if (!r) return null;
    let evx = this.open.get(id);
    if (!evx) {
      evx = EvxFile.open(join(this.dir, r.file));
      this.open.set(id, evx);
      evx.catch(() => this.open.delete(id));
    }
    const f = await evx;
    return f.has(path) ? f.read(path) : null;
  }

  async close(): Promise<void> {
    for (const f of this.open.values()) await (await f).close().catch(() => undefined);
    this.open.clear();
  }
}
