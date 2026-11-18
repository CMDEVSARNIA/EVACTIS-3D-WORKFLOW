import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './offline';
import { idle } from './viewer-helpers';

/**
 * Phase 10 acceptance (browser deliveries), with the network blocked: the demo facility
 * as an intranet bundle (served), a browser folder and a single HTML file (both opened
 * straight from disk, file://). Each opens plain and encrypted (a wrong passphrase is
 * refused); an altered file fails the integrity check; the info panel carries the
 * version/date stamp, the offline notice and the quick-start guide.
 */
const SERVED = 'http://127.0.0.1:4181';
const DISK = `file://${resolve('target/e2e-packages')}`;
const PASSPHRASE = 'correct horse battery staple';
test.use({ viewport: { width: 1280, height: 800 } });
test.setTimeout(120_000);

const ready = (page: Page, state: string) =>
  expect(page.locator('body')).toHaveAttribute('data-ready', state, { timeout: 60_000 });

async function unlock(page: Page) {
  await ready(page, 'locked');
  const box = page.getByRole('region', { name: 'Enter the passphrase' });
  await expect(box).toContainText('This environment is encrypted');
  await box.getByLabel('Passphrase').fill('wrong horse battery staple');
  await box.getByRole('button', { name: 'Open' }).click();
  await expect(box.getByRole('status')).toHaveText(/does not open the environment/, {
    timeout: 60_000,
  });
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'locked');
  await box.getByLabel('Passphrase').fill(PASSPHRASE);
  await box.getByRole('button', { name: 'Open' }).click();
}

/**
 * The intranet page keeps its own policy (PACKAGE_CSP, which lets the PDF reader read
 * its blob), without the test server's stricter header that an intranet would not send.
 */
async function ownPolicy(page: Page) {
  await page.route(`${SERVED}/**/index.html`, async (route) => {
    const res = await route.fetch();
    const headers = { ...res.headers() };
    delete headers['content-security-policy'];
    await route.fulfill({ response: res, headers });
  });
}

/** Opens the lobby's PDF, read from the package (a blob made after verifying it). */
async function readPdf(page: Page) {
  // Behind the start view at this size; the hotspot itself is not under test here.
  await page.getByRole('button', { name: 'Emergency procedures (PDF)' }).dispatchEvent('click');
  const doc = page.getByRole('region', { name: 'Emergency procedures' });
  await expect(doc).not.toHaveAttribute('data-state', 'loading', { timeout: 30_000 });
  await expect(doc).toHaveAttribute('data-state', 'ready');
  await expect(doc.locator('.evx-viewer__pdf-text')).toContainText('EMERGENCY PROCEDURES');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

/** Walks to another floor's scene and opens the info panel: the package's stamp. */
async function tour(page: Page, kind: string) {
  await page.evaluate(() => window.viewer!.goToScene('office', { transition: { kind: 'cut' } }));
  await idle(page);
  expect(await page.evaluate(() => window.viewer!.sceneId)).toBe('office');
  await page.getByRole('button', { name: 'Information', exact: true }).click();
  const info = page.locator('dialog[open]');
  await expect(info).toContainText('Nothing is sent anywhere');
  await expect(info).toContainText(`${kind}, made `);
  await expect(info).toContainText(/Package check: [0-9a-f]{16}/);
  await expect(info.getByRole('link', { name: 'Quick start guide (PDF)' })).toBeVisible();
}

for (const [label, url, mode, kind] of [
  ['intranet bundle (served)', `${SERVED}/intranet/index.html`, 'fetch', 'Intranet bundle'],
  ['browser folder (file://)', `${DISK}/folder/index.html`, 'chunks', 'Browser folder'],
  ['single HTML file (file://)', `${DISK}/single.html`, 'inline', 'Single HTML file'],
] as const) {
  test(`${label}: opens offline, every file checked, stamp and quick start`, async ({ page }) => {
    await ownPolicy(page);
    await page.goto(url);
    await ready(page, 'true');
    await expect(page.locator('body')).toHaveAttribute('data-mode', mode);
    await idle(page);
    await page.screenshot({ path: test.info().outputPath(`${mode}.png`) });
    await readPdf(page);
    await tour(page, kind);
  });

  const encrypted = url.replace(/(intranet|folder|single)/, '$1-enc');
  test(`${label}, encrypted: a wrong passphrase is refused, the right one opens`, async ({
    page,
  }) => {
    await ownPolicy(page);
    await page.goto(encrypted);
    await unlock(page);
    await ready(page, 'true');
    await idle(page);
    await readPdf(page);
    await tour(page, kind);
  });
}

test('the PDF opens where the webview cannot request blob: URLs', async ({ page }) => {
  // In the desktop Viewer's WebView2 (page at http://tauri.localhost) pdf.js's request
  // for a package blob failed: "Unexpected server response (0)". Here every request for
  // a blob: URL fails the same way; the reader must not depend on one.
  await page.addInitScript(() => {
    const fetch0 = window.fetch;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
      String(input instanceof Request ? input.url : input).startsWith('blob:')
        ? Promise.reject(new TypeError('Failed to fetch'))
        : fetch0(input, init);
    type X = XMLHttpRequest & { __blob?: boolean };
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: X, ...a: unknown[]) {
      this.__blob = String(a[1]).startsWith('blob:');
      return (open as (...x: unknown[]) => void).apply(this, a);
    } as typeof open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (
      this: X,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      if (!this.__blob) return send.call(this, body);
      setTimeout(() => this.onerror?.(new ProgressEvent('error')));
    };
  });
  await page.goto(`${DISK}/folder/index.html`);
  await ready(page, 'true');
  await idle(page);
  await readPdf(page);
});

test('the intranet bundle carries a strict CSP and makes no outside request', async ({ page }) => {
  await page.goto(`${SERVED}/intranet/index.html`);
  await ready(page, 'true');
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).not.toMatch(/https?:|\*/);
});

test('the single HTML file is capped in resolution and declares its own script by hash', async ({
  page,
}) => {
  await page.goto(`${DISK}/single.html`);
  await ready(page, 'true');
  const faces = await page.evaluate(() =>
    window.viewer!.environment.scenes.flatMap((s) =>
      s.media.type === 'equirect' && s.media.tiles ? s.media.tiles.levels.map((l) => l.size) : [],
    ),
  );
  expect(Math.max(...faces)).toBeLessThanOrEqual(2048);
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
  expect(csp).not.toContain('unsafe-eval');
});

test('an altered file fails the integrity check and stops the environment', async ({ page }) => {
  // The environment description altered: refused as the package opens.
  await page.goto(`${SERVED}/intranet-altered/index.html`);
  await ready(page, 'integrity-error');
  await expect(page.getByRole('alert')).toContainText(
    '“environment.json” failed its integrity check',
  );
  await expect(page.locator('.evx-viewer')).toHaveCount(0);

  // One panorama tile altered: refused when the Viewer asks for it.
  const { tile } = JSON.parse(readFileSync(join('target/e2e-packages', 'altered.json'), 'utf8'));
  await page.goto(`${DISK}/folder-altered/index.html`);
  await ready(page, 'integrity-error');
  await expect(page.getByRole('alert')).toContainText(`“${tile}” failed its integrity check`);
  await expect(page.locator('.evx-viewer')).toHaveCount(0);
});
