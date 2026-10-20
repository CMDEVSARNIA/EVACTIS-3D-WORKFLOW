/**
 * Bundles IWER (test-only WebXR emulator) into one classic script for Playwright's
 * addInitScript: target/e2e-iwer.js. Uses the Viewer package's Vite (no extra tool).
 */
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const entry = fileURLToPath(new URL('./iwer-entry.js', import.meta.url));
export const IWER_SCRIPT = `${root}target/e2e-iwer.js`;

export async function buildIwer() {
  if (existsSync(IWER_SCRIPT) && statSync(IWER_SCRIPT).mtimeMs > statSync(entry).mtimeMs)
    return IWER_SCRIPT;
  const require = createRequire(`${root}packages/viewer/package.json`);
  const { build } = await import(pathToFileURL(require.resolve('vite')).href);
  await build({
    root,
    logLevel: 'warn',
    configFile: false,
    build: {
      outDir: `${root}target`,
      emptyOutDir: false,
      minify: false,
      lib: { entry, formats: ['iife'], name: 'EvxIwer', fileName: () => 'e2e-iwer.js' },
    },
  });
  return IWER_SCRIPT;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildIwer();
