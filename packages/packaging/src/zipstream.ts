/**
 * A ZIP written as it goes (stored entries, UTF-8 names, fixed 1980-01-01 timestamps):
 * each `add` returns the bytes to append to the file, `finish` the central directory.
 * Large `.evx` packages and SCORM exports stream to disk without being held in memory.
 * Plain ZIP limits apply (65,535 entries, 4 GB); the desktop reader refuses anything else.
 */
import { crc32 } from '@evactis-3dworkflow/print/zip';

export const ZIP_LIMITS = { files: 65_535, bytes: 0xffff_ffff };

export class ZipLimitError extends Error {
  override name = 'ZipLimitError';
}

const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export class ZipStream {
  private central: Uint8Array[] = [];
  private offset = 0;
  private count = 0;

  /** The local header and data for one entry. */
  add(name: string, data: Uint8Array): Uint8Array {
    const n = new TextEncoder().encode(name);
    if (++this.count > ZIP_LIMITS.files) throw new ZipLimitError('too many files for one package');
    if (this.offset + 30 + n.length + data.length > ZIP_LIMITS.bytes)
      throw new ZipLimitError('the package would be larger than 4 GB');
    const crc = crc32(data);
    const out = new Uint8Array(30 + n.length + data.length);
    const h = new DataView(out.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint16(12, DOS_DATE, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, n.length, true);
    out.set(n, 30);
    out.set(data, 30 + n.length);

    const dir = new Uint8Array(46 + n.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint16(14, DOS_DATE, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, data.length, true);
    d.setUint32(24, data.length, true);
    d.setUint16(28, n.length, true);
    d.setUint32(42, this.offset, true);
    dir.set(n, 46);
    this.central.push(dir);
    this.offset += out.length;
    return out;
  }

  /** The central directory and end record: append last. */
  finish(): Uint8Array {
    const size = this.central.reduce((s, b) => s + b.length, 0);
    const out = new Uint8Array(size + 22);
    let at = 0;
    for (const b of this.central) {
      out.set(b, at);
      at += b.length;
    }
    const e = new DataView(out.buffer, size);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, this.count, true);
    e.setUint16(10, this.count, true);
    e.setUint32(12, size, true);
    e.setUint32(16, this.offset, true);
    return out;
  }
}
