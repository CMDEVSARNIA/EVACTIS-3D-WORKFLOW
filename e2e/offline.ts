import { test as base, expect } from '@playwright/test';

/**
 * "Network is blocked" test mode. Two independent layers:
 *  1. Chromium is launched (playwright.config.ts) with every hostname resolving to
 *     nothing and a dead proxy except loopback, so a request that slips past (2) still
 *     cannot leave the machine.
 *  2. Every request is intercepted; anything not on the loopback test server is aborted
 *     and recorded, and the test fails at teardown if the list is not empty.
 */
const LOCAL = /^(http:\/\/127\.0\.0\.1(:\d+)?\/|data:|blob:|about:)/;

export const test = base.extend<{ networkGuard: { attempts: string[] } }>({
  networkGuard: [
    async ({ context }, use) => {
      const attempts: string[] = [];
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (LOCAL.test(url)) return route.continue();
        attempts.push(url);
        return route.abort('blockedbyclient');
      });
      context.on('page', (page) => page.on('websocket', (ws) => attempts.push(ws.url())));
      await use({ attempts });
      expect(attempts, 'external network requests attempted').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
