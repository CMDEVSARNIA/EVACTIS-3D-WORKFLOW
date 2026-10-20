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
    await page.goto(url);
    await ready(page, 'true');
    await expect(page.locator('body')).toHaveAttribute('data-mode', mode);
    await idle(page);
    await page.screenshot({ path: test.info().outputPath(`${mode}.png`) });
    await tour(page, kind);
  });

  const encrypted = url.replace(/(intranet|folder|single)/, '$1-enc');
  test(`${label}, encrypted: a wrong passphrase is refused, the right one opens`, async ({
    page,
  }) => {
    await page.goto(encrypted);
    await unlock(page);
    await ready(page, 'true');
    await idle(page);
    await tour(page, kind);
  });
}

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
