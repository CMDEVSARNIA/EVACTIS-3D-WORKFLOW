/**
 * Photos attached to notes. The type is decided from the bytes, never from what the
 * browser claims, and metadata is removed before storing: EXIF can carry GPS
 * coordinates, device serial numbers and capture times of a facility. Pixels are kept
 * as they are (no re-encoding, no image library).
 */

export type PhotoType = 'image/jpeg' | 'image/png' | 'image/webp';

export class PhotoError extends Error {
  override name = 'PhotoError';
}

export function photoType(b: Buffer): PhotoType | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length > 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (
    b.length > 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** JPEG without APP1 (EXIF, XMP), APP13 (IPTC) and comments; ICC (APP2) and JFIF kept. */
function stripJpeg(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) throw new PhotoError('damaged JPEG');
    const marker = b[at + 1]!;
    if (marker === 0xda) {
      out.push(b.subarray(at)); // start of scan: the rest is image data
      return Buffer.concat(out);
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(b.subarray(at, at + 2));
      at += 2;
      continue;
    }
    const length = b.readUInt16BE(at + 2);
    const end = at + 2 + length;
    if (length < 2 || end > b.length) throw new PhotoError('damaged JPEG');
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) out.push(b.subarray(at, end));
    at = end;
  }
  throw new PhotoError('damaged JPEG');
}

const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
function stripPng(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= b.length) {
    const length = b.readUInt32BE(at);
    const type = b.toString('ascii', at + 4, at + 8);
    const end = at + 12 + length;
    if (end > b.length) throw new PhotoError('damaged PNG');
    if (!PNG_DROP.has(type)) out.push(b.subarray(at, end));
    at = end;
    if (type === 'IEND') return Buffer.concat(out);
  }
  throw new PhotoError('damaged PNG');
}

function stripWebp(b: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let at = 12;
  while (at + 8 <= b.length) {
    const type = b.toString('ascii', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    const end = at + 8 + size + (size & 1);
    if (at + 8 + size > b.length) throw new PhotoError('damaged WebP');
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = Buffer.from(b.subarray(at, Math.min(end, b.length)));
      // VP8X flags: clear the EXIF (0x08) and XMP (0x04) bits.
      if (type === 'VP8X') chunk[8] = chunk[8]! & ~0x0c;
      chunks.push(chunk);
    }
    at = end;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, body]);
}

/** The photo's type and its bytes without metadata; throws for anything else. */
export function cleanPhoto(b: Buffer): { type: PhotoType; data: Buffer } {
  const type = photoType(b);
  if (!type) throw new PhotoError('Photos must be JPEG, PNG or WebP');
  const data =
    type === 'image/jpeg' ? stripJpeg(b) : type === 'image/png' ? stripPng(b) : stripWebp(b);
  return { type, data };
}
