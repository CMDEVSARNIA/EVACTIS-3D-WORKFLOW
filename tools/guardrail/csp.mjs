/**
 * Content-Security-Policy for shipped pages. `default-src 'self'` means a page cannot
 * load or send anything outside its own package. Injected at build time only, so the
 * Vite dev server's hot-reload socket keeps working during development.
 */
const BASE = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'"],
  'media-src': ["'self'", 'blob:'],
  'connect-src': ["'self'", 'ipc:', 'http://ipc.localhost'],
  // No web workers: the PDF reader runs pdf.js on the page itself (packages/viewer/src/pdf.ts).
  'worker-src': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'none'"],
};

/**
 * Tauri's local-file protocol: `asset:` (Linux/macOS) and `http://asset.localhost`
 * (Windows WebView2). Both are served from disk by the webview itself, never the
 * network, and Rust limits them to the open project's media folder.
 */
const LOCAL_FILES = ['asset:', 'http://asset.localhost'];

/** @param {{ localFiles?: boolean }} [options] */
export function buildCsp({ localFiles = false } = {}) {
  return Object.entries(BASE)
    .map(([k, v]) => {
      // connect-src: the PDF reader reads documents from the package with fetch.
      const local = k === 'img-src' || k === 'media-src' || k === 'connect-src';
      const extra = localFiles && local ? LOCAL_FILES : [];
      return [k, ...v, ...extra].join(' ');
    })
    .join('; ');
}

export const CSP = buildCsp();

/**
 * Vite plugin adding the CSP <meta> to built HTML.
 * @param {{ localFiles?: boolean }} [options] allow the desktop local-file protocol
 */
export function cspPlugin(options) {
  const content = buildCsp(options);
  return {
    name: 'evactis-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content },
        injectTo: 'head-prepend',
      },
    ],
  };
}
