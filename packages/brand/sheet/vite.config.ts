import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Brand sheet: a static page that recreates brand/evactis-button-kit.png from the
// real components so the two can be compared side by side. Relative base so it
// opens from disk and from the offline test server alike.
export default defineConfig({
  root: __dirname,
  base: './',
  build: {
    outDir: resolve(__dirname, '../sheet-dist'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        legibility: resolve(__dirname, 'legibility.html'),
      },
    },
  },
  server: { host: '127.0.0.1' },
});
