import { resolve } from 'node:path';
import { transform } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

/**
 * Vite does not minify ES-format library builds. Minify the final chunk ourselves so
 * the shipped file carries no dead comments (and no documentation URLs) and stays small.
 */
const minifyLibrary = (): Plugin => ({
  name: 'evactis-minify-library',
  apply: 'build',
  async renderChunk(code) {
    const out = await transform(code, {
      minify: true,
      format: 'esm',
      target: 'es2022',
      legalComments: 'none',
    });
    return { code: out.code, map: null };
  },
});

// Library build: one self-contained ES module (Three.js, schema and brand bundled) and
// one stylesheet, loadable from a folder, an intranet server or a Tauri app.
export default defineConfig({
  plugins: [minifyLibrary()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    assetsInlineLimit: 0,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'evactis-viewer.js',
      cssFileName: 'evactis-viewer',
    },
  },
  test: { environment: 'jsdom' },
});
