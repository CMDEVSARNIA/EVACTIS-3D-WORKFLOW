#!/usr/bin/env node
/**
 * Bundles the server into one CommonJS file (dist/server.cjs) for `node`, the Docker
 * image and the standalone binary. Node built-ins stay external; everything else
 * (Fastify, ws, ldapts, the package format) is inside.
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [join(root, 'src/bin.ts')],
  outfile: join(root, 'dist/server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  legalComments: 'external',
  logLevel: 'warning',
});
console.log('dist/server.cjs');
