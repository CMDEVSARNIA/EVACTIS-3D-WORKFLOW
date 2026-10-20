import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { cspPlugin } from '../../tools/guardrail/csp.mjs';

const VIEWER = resolve(__dirname, '../../packages/viewer');
/** Served at ./<key>/: the module player (files.json lists it) and the classic one. */
const PLAYERS: Record<string, { dir: string; check: string }> = {
  player: { dir: join(VIEWER, 'player-dist'), check: 'files.json' },
  'player-classic': { dir: join(VIEWER, 'player-classic-dist'), check: 'player.js' },
};
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

/**
 * The 3DWORKFLOW Viewer players, shipped inside Studio at ./player/ (intranet, SCORM)
 * and ./player-classic/ (browser folder, single HTML file) so every package is
 * assembled from the app itself, offline. Built by @evactis-3dworkflow/viewer.
 */
const player = (): Plugin => ({
  name: 'evactis-player',
  configureServer(server) {
    for (const [at, { dir }] of Object.entries(PLAYERS))
      server.middlewares.use(`/${at}`, (req, res, next) => {
        const file = join(dir, decodeURIComponent((req.url ?? '/').split('?')[0]!));
        if (!file.startsWith(dir) || !existsSync(file)) return next();
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        res.end(readFileSync(file));
      });
  },
  writeBundle(options) {
    for (const [at, { dir, check }] of Object.entries(PLAYERS)) {
      if (!existsSync(join(dir, check)))
        throw new Error(`Build @evactis-3dworkflow/viewer first: ${dir} is missing`);
      cpSync(dir, join(options.dir!, at), { recursive: true });
    }
  },
});

// Offline: relative base, every asset bundled into dist/, no CDN.
export default defineConfig({
  base: './',
  clearScreen: false,
  plugins: [react(), tailwindcss(), cspPlugin({ localFiles: true }), player()],
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  // A desktop app loads its bundle from disk: one large chunk is fine.
  build: { target: 'es2022', assetsInlineLimit: 0, sourcemap: false, chunkSizeWarningLimit: 4096 },
  test: { environment: 'jsdom' },
});
