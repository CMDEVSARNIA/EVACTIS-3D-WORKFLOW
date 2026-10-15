import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { cspPlugin } from '../../tools/guardrail/csp.mjs';

// Offline: relative base, every asset bundled into dist/, no CDN.
export default defineConfig({
  base: './',
  clearScreen: false,
  plugins: [react(), tailwindcss(), cspPlugin({ localFiles: true })],
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: { target: 'es2022', assetsInlineLimit: 0, sourcemap: false },
  test: { environment: 'jsdom' },
});
