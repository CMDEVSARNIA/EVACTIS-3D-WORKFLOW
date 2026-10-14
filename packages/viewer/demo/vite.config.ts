import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { cspPlugin } from '../../../tools/guardrail/csp.mjs';

// Demo page for the seeded demo facility (used by e2e tests and for manual review).
export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: resolve(__dirname, '../../demo-facility/dist'),
  plugins: [cspPlugin()],
  build: {
    target: 'es2022',
    outDir: resolve(__dirname, '../demo-dist'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  server: { host: '127.0.0.1', port: 1430 },
});
