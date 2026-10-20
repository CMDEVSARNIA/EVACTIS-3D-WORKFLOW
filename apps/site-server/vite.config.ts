import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The Site Server's pages: served by the server itself from dist/web (or from the
// standalone binary). Absolute base: pages live at /, /admin and /view/<id>.
export default defineConfig({
  root: resolve(__dirname, 'web'),
  base: '/',
  clearScreen: false,
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'web/index.html'),
        admin: resolve(__dirname, 'web/admin.html'),
        view: resolve(__dirname, 'web/view.html'),
      },
    },
  },
});
