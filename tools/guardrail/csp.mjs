/**
 * Content-Security-Policy for shipped pages. `default-src 'self'` means a page cannot
 * load or send anything outside its own package. Injected at build time only, so the
 * Vite dev server's hot-reload socket keeps working during development.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self' ipc: http://ipc.localhost",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/** Vite plugin adding the CSP <meta> to built HTML. */
export function cspPlugin() {
  return {
    name: 'evactis-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
        injectTo: 'head-prepend',
      },
    ],
  };
}
