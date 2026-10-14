import { test, expect } from './offline';

const tryFetch = (page: import('@playwright/test').Page, url: string) =>
  page.evaluate(async (u) => {
    try {
      await fetch(u, { mode: 'no-cors' });
      return 'reached';
    } catch {
      return 'blocked';
    }
  }, url);

// Proves the guard itself works: an external request is intercepted and recorded.
test('the network guard blocks and reports external requests', async ({ page, networkGuard }) => {
  await page.goto('about:blank');
  expect(await tryFetch(page, 'https://example.com/telemetry')).toBe('blocked');
  expect(networkGuard.attempts).toEqual(['https://example.com/telemetry']);
  networkGuard.attempts.length = 0; // expected attempt; keep the teardown check for others
});

// Shipped pages carry default-src 'self', so the browser refuses before any socket opens.
test('the page CSP refuses external requests on its own', async ({ page, networkGuard }) => {
  await page.goto('/index.html');
  expect(await tryFetch(page, 'https://example.com/telemetry')).toBe('blocked');
  expect(networkGuard.attempts).toEqual([]);
  // One report per policy (the page's <meta> CSP and the server header).
  await expect.poll(() => networkGuard.csp.length).toBeGreaterThan(0);
  for (const v of networkGuard.csp) expect(v).toBe('connect-src https://example.com/telemetry');
  networkGuard.csp.length = 0; // expected violations; any other fails the test
});
