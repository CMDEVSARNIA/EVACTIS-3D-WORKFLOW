import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * The classic player for packages opened from disk (browser folder, single HTML file):
 * one plain script and one stylesheet, nothing loaded later. Browsers refuse module
 * scripts and `import()` from file://, so lazy chunks (PDF reader, certificate, splats…)
 * are folded in, and fonts are inlined into the stylesheet as data URLs.
 */
export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: false,
  build: {
    target: 'es2022',
    outDir: resolve(__dirname, '../player-classic-dist'),
    emptyOutDir: true,
    assetsInlineLimit: 100 * 1024 * 1024,
    cssCodeSplit: false,
    modulePreload: false,
    lib: {
      entry: resolve(__dirname, 'main.ts'),
      formats: ['iife'],
      name: 'EvxPlayer',
      fileName: () => 'player.js',
      cssFileName: 'player',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
