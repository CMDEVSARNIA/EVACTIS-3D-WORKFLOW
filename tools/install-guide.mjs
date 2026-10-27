#!/usr/bin/env node
/**
 * Writes the branded Windows installation guide (packages/print `installGuidePdf`) in
 * English and French, with the bundled Inter fonts and product lockup. Offline.
 *
 *   node tools/install-guide.mjs [--out <folder>] [--version <v>] [--date <yyyy-mm-dd>] [--test-signed]
 *
 * Writes EVACTIS-3DWORKFLOW-<version>-Windows-Install-Guide-EN.pdf and -FR.pdf
 * (default folder target/install-guide; version from apps/studio/package.json).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
// Straight from the module, not the index: it needs only the drawing layer, so it runs
// before the workspace packages are built (pnpm check runs the kit test early).
import { installGuidePdf } from '../packages/print/src/install-guide.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(repo, 'packages/brand');
const read = (p) => new Uint8Array(readFileSync(join(brand, p)));

/** Writes both languages into `out`; returns the file paths. */
export async function writeInstallGuides({ out, version, date, testSigned = false }) {
  const assets = {
    fonts: {
      regular: read('fonts/print/inter-latin-400-normal.woff'),
      semibold: read('fonts/print/inter-latin-600-normal.woff'),
      bold: read('fonts/print/inter-latin-700-normal.woff'),
      extrabold: read('fonts/print/inter-latin-800-normal.woff'),
    },
    logo: read('generated/print/product-lockup.png'),
  };
  mkdirSync(out, { recursive: true });
  const files = [];
  for (const lang of ['en', 'fr']) {
    const { pdf } = await installGuidePdf({ lang, version, date, testSigned }, assets);
    const file = join(
      out,
      `EVACTIS-3DWORKFLOW-${version}-Windows-Install-Guide-${lang.toUpperCase()}.pdf`,
    );
    writeFileSync(file, pdf);
    files.push(file);
  }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: join(repo, 'target/install-guide') },
      version: { type: 'string' },
      date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
      'test-signed': { type: 'boolean', default: false },
    },
  });
  const version =
    values.version ??
    JSON.parse(readFileSync(join(repo, 'apps/studio/package.json'), 'utf8')).version;
  const files = await writeInstallGuides({
    out: resolve(values.out),
    version,
    date: values.date,
    testSigned: values['test-signed'],
  });
  for (const f of files) console.log(f);
}
