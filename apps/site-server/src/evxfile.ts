/**
 * Reads an uploaded `.evx` (a stored ZIP) by random access: the central directory is read
 * once, then each request reads one entry's bytes from disk. Packages can be gigabytes;
 * nothing is loaded whole. Compressed, encrypted-ZIP, ZIP64 and duplicate entries are
 * refused, as by the desktop Viewer (crates/evx-package).
 */
import { open, type FileHandle } from 'node:fs/promises';

interface Entry {
  offset: number;
  size: number;
}

export class EvxFileError extends Error {
  override name = 'EvxFileError';
}

export class EvxFile {
  private constructor(
    private fh: FileHandle,
    private entries: Map<string, Entry>,
  ) {}

  static async open(path: string): Promise<EvxFile> {
    const fh = await open(path, 'r');
    try {
      const { size } = await fh.stat();
      const tailSize = Math.min(size, 22 + 0xffff);
      const tail = Buffer.alloc(tailSize);
      await fh.read(tail, 0, tailSize, size - tailSize);
      let eocd = -1;
      for (let i = tailSize - 22; i >= 0; i--)
        if (tail.readUInt32LE(i) === 0x06054b50) {
          eocd = i;
          break;
        }
      if (eocd < 0) throw new EvxFileError('not a ZIP file');
      const count = tail.readUInt16LE(eocd + 10);
      const cdSize = tail.readUInt32LE(eocd + 12);
      const cdOffset = tail.readUInt32LE(eocd + 16);
      if (cdOffset === 0xffffffff || count === 0xffff)
        throw new EvxFileError('ZIP64 is not supported');
      if (cdOffset + cdSize > size) throw new EvxFileError('damaged ZIP directory');
      const cd = Buffer.alloc(cdSize);
      await fh.read(cd, 0, cdSize, cdOffset);
      const entries = new Map<string, Entry>();
      let at = 0;
      for (let n = 0; n < count; n++) {
        if (cd.readUInt32LE(at) !== 0x02014b50) throw new EvxFileError('damaged ZIP directory');
        const flags = cd.readUInt16LE(at + 8);
        const method = cd.readUInt16LE(at + 10);
        const compressed = cd.readUInt32LE(at + 20);
        const plain = cd.readUInt32LE(at + 24);
        const nameLen = cd.readUInt16LE(at + 28);
        const extraLen = cd.readUInt16LE(at + 30);
        const commentLen = cd.readUInt16LE(at + 32);
        const local = cd.readUInt32LE(at + 42);
        const name = cd.toString('utf8', at + 46, at + 46 + nameLen);
        if (method !== 0 || compressed !== plain)
          throw new EvxFileError(`${name}: compressed entries are not supported`);
        if (flags & 1) throw new EvxFileError(`${name}: encrypted ZIP entries are not supported`);
        if (entries.has(name)) throw new EvxFileError(`${name}: listed twice`);
        // The data starts after the local header, whose name/extra lengths may differ.
        const header = Buffer.alloc(30);
        await fh.read(header, 0, 30, local);
        if (header.readUInt32LE(0) !== 0x04034b50) throw new EvxFileError(`${name}: damaged entry`);
        const offset = local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
        if (offset + plain > size) throw new EvxFileError(`${name}: truncated`);
        entries.set(name, { offset, size: plain });
        at += 46 + nameLen + extraLen + commentLen;
      }
      return new EvxFile(fh, entries);
    } catch (e) {
      await fh.close();
      throw e;
    }
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  size(name: string): number | null {
    return this.entries.get(name)?.size ?? null;
  }

  /** The stored bytes of one entry (the package format checks them, not this reader). */
  async read(name: string): Promise<Buffer> {
    const e = this.entries.get(name);
    if (!e) throw new EvxFileError(`${name}: not in the package`);
    const out = Buffer.alloc(e.size);
    if (e.size) await this.fh.read(out, 0, e.size, e.offset);
    return out;
  }

  close(): Promise<void> {
    return this.fh.close();
  }
}
