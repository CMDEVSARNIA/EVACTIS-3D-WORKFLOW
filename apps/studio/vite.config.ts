import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { cspPlugin } from '../../tools/guardrail/csp.mjs';

const PLAYER = resolve(__dirname, '../../packages/viewer/player-dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

/**
 * The 3DWORKFLOW Viewer player, shipped inside Studio at ./player/ so packages (SCORM)
 * are assembled from the app itself, offline. Built by @evactis-3dworkflow/viewer.
 */
const player = (): Plugin => ({
  name: 'evactis-player',
  configureServer(server) {
    server.middlewares.use('/player', (req, res, next) => {
      const file = join(PLAYER, decodeURIComponent((req.url ?? '/').split('?')[0]!));
      if (!file.startsWith(PLAYER) || !existsSync(file)) return next();
      res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      res.end(readFileSync(file));
    });
  },
  writeBundle(options) {
    if (!existsSync(join(PLAYER, 'files.json')))
      throw new Error('Build @evactis-3dworkflow/viewer first: the player is missing');
    cpSync(PLAYER, join(options.dir!, 'player'), { recursive: true });
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
