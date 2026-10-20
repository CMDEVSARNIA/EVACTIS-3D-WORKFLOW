#!/usr/bin/env node
/**
 * Makes a damaged copy of a delivery package for the integrity tests: one byte of the
 * first panorama tile inside a .evx (a stored ZIP, so the bytes are the file's own) is
 * flipped. The Viewer must refuse the copy.
 *
 *   node tools/smoke/alter-package.mjs <in.evx> <out.evx>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error('usage: alter-package.mjs <in.evx> <out.evx>');
  process.exit(2);
}
const zip = readFileSync(src);
// Walk the local file headers (PK\x03\x04) from the start of the archive.
for (let at = 0; zip.readUInt32LE(at) === 0x04034b50; ) {
  const size = zip.readUInt32LE(at + 18);
  const nameLength = zip.readUInt16LE(at + 26);
  const extraLength = zip.readUInt16LE(at + 28);
  const name = zip.toString('utf8', at + 30, at + 30 + nameLength);
  const data = at + 30 + nameLength + extraLength;
  if (name.includes('/tiles/') && size > 0) {
    zip[data + (size >> 1)] ^= 0xff;
    writeFileSync(dst, zip);
    console.log(`   altered ${name}`);
    process.exit(0);
  }
  at = data + size;
}
console.error(`no panorama tile found in ${src}`);
process.exit(1);
