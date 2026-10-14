import { defineConfig } from 'vite';
import { cspPlugin } from '../../tools/guardrail/csp.mjs';

// Framework-free, offline: relative base, no CDN, assets copied into dist/.
export default defineConfig({
  base: './',
  plugins: [cspPlugin()],
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1421, strictPort: true },
  build: { target: 'es2022', assetsInlineLimit: 0, sourcemap: false },
});
