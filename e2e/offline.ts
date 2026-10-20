import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

/**
 * "Network is blocked" test mode. Two independent layers:
 *  1. Chromium is launched (playwright.config.ts) with every hostname resolving to
 *     nothing and a dead proxy except loopback, so a request that slips past (2) still
 *     cannot leave the machine.
 *  2. Every request is intercepted; anything not on a loopback test server (HTTP(S) or
 *     WebSocket on 127.0.0.1) is aborted
 *     and recorded, and the test fails at teardown if the list is not empty.
 *  Content-Security-Policy violations are recorded and fail the test the same way.
 */
const HARDEN = fileURLToPath(new URL('../crates/evx-desktop/src/harden.js', import.meta.url));
const LOCAL = /^((https?|wss?):\/\/127\.0\.0\.1(:\d+)?\/|file:|data:|blob:|about:)/;

export const test = base.extend<{ networkGuard: { attempts: string[]; csp: string[] } }>({
  networkGuard: [
    async ({ context }, use) => {
      const attempts: string[] = [];
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (LOCAL.test(url)) return route.continue();
        attempts.push(url);
        return route.abort('blockedbyclient');
      });
      context.on('page', (page) =>
        page.on('websocket', (ws) => !LOCAL.test(ws.url()) && attempts.push(ws.url())),
      );
      // CSP violations (blocked loads, eval probes) are failures too: shipped pages must
      // never even attempt what their policy forbids.
      const csp: string[] = [];
      await context.exposeBinding('__evxCspViolation', (_src, v: string) => void csp.push(v));
      await context.addInitScript(() =>
        document.addEventListener('securitypolicyviolation', (e) =>
          (window as unknown as { __evxCspViolation(v: string): void }).__evxCspViolation(
            `${e.violatedDirective} ${e.blockedURI}`,
          ),
        ),
      );
      // The desktop apps harden Object.prototype before any script; pages under test get
      // the same treatment, so code that would break in the apps breaks here first.
      await context.addInitScript({ path: HARDEN });
      await use({ attempts, csp });
      expect(attempts, 'external network requests attempted').toEqual([]);
      expect(csp, 'Content-Security-Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
