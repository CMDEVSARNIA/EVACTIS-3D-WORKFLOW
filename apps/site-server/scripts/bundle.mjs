#!/usr/bin/env node
/**
 * Bundles the server into one CommonJS file (dist/server.cjs) for `node`, the Docker
 * image and the standalone binary. Node built-ins stay external; everything else
 * (Fastify, ws, ldapts, the package format) is inside. dist/NOTICES.txt carries the
 * licence of every third-party package that ended up in the bundle.
 */
import { build } from 'esbuild';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  entryPoints: [join(root, 'src/bin.ts')],
  outfile: join(root, 'dist/server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});

/** The package.json directory a bundled file belongs to. */
const packageOf = (file) => {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir))
    if (existsSync(join(dir, 'package.json'))) return dir;
  return null;
};
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const dir = packageOf(resolve(process.cwd(), input));
  if (!dir) continue;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (!pkg.name || pkg.name.startsWith('@evactis-3dworkflow/')) continue;
  packages.set(`${pkg.name}@${pkg.version}`, { dir, pkg });
}
// The standard MIT text, for the rare package that declares MIT but ships no licence file.
const MIT = (holder) => `Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;
const author = (a) => (typeof a === 'string' ? a : a?.name)?.replace(/\s*[<(].*$/, '');
const notices = [...packages.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, { dir, pkg }]) => {
    const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
    let text;
    if (file) text = readFileSync(join(dir, file), 'utf8').trim();
    else if (pkg.license === 'MIT' && author(pkg.author)) text = MIT(author(pkg.author));
    else throw new Error(`${id}: no licence text to ship`);
    return `${id} (${pkg.license})\n${'-'.repeat(id.length)}\n\n${text}\n`;
  });
writeFileSync(
  join(root, 'dist/NOTICES.txt'),
  `EVACTIS 3DWORKFLOW Site Server includes the following third-party packages.\n\n${notices.join('\n\n')}`,
);
console.log(
  `dist/server.cjs (${packages.size} third-party packages, licences in dist/NOTICES.txt)`,
);
