import { readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { cspPlugin } from '../../../tools/guardrail/csp.mjs';

const out = resolve(__dirname, '../player-dist');

/** Lists the built files (files.json), so packagers copy exactly the player. */
const fileList = (): Plugin => ({
  name: 'evactis-player-files',
  apply: 'build',
  closeBundle() {
    const files = readdirSync(out)
      .filter((f) => f !== 'files.json')
      .sort();
    writeFileSync(resolve(out, 'files.json'), `${JSON.stringify(files, null, 2)}\n`);
  },
});

// The Viewer page shipped in packages (SCORM now; browser folder and intranet later):
// stable file names in one flat folder, strict CSP, no environment bundled.
export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: false,
  plugins: [cspPlugin(), fileList()],
  build: {
    target: 'es2022',
    outDir: out,
    emptyOutDir: true,
    assetsInlineLimit: 0,
    assetsDir: '',
    rollupOptions: {
      output: {
        entryFileNames: 'player.js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
