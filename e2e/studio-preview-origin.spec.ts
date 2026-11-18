import { PNG } from 'pngjs';
import { test, expect } from './offline';

/**
 * Studio on Windows serves project files from http://asset.localhost while its page is
 * http://tauri.localhost: another origin. Tiles loaded without CORS are "tainted" and
 * WebGL refuses them, so the Tour preview stayed black on Windows although the library
 * thumbnails showed. Here the test backend hands out http://asset.localhost URLs and the
 * test answers them from the local server with the header the desktop protocol sends.
 */
const STUDIO = 'http://127.0.0.1:4178';

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

test('the Tour preview shows a panorama served from another origin, as on Windows', async ({
  page,
}) => {
  const served: string[] = [];
  await page.route('http://asset.localhost/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const res = await fetch(`${STUDIO}${path}`);
    served.push(`${res.status} ${path}`);
    await route.fulfill({
      status: res.status,
      body: Buffer.from(await res.arrayBuffer()),
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
        // What Tauri's asset protocol sends (tauri/src/protocol/asset.rs).
        'access-control-allow-origin': STUDIO,
      },
    });
  });
  // The page keeps its own policy (the app's, with http://asset.localhost), without the
  // test server's stricter header, which knows nothing of the desktop file origin.
  await page.route(`${STUDIO}/index.html?*`, async (route) => {
    const res = await route.fetch();
    const headers = { ...res.headers() };
    delete headers['content-security-policy'];
    await route.fulfill({ response: res, headers });
  });
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${STUDIO}/index.html?assets=asset.localhost`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Origin check');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Import media…' }).click();
  await expect(page.locator('.evx-asset').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Tour' }).click();
  await page.getByRole('button', { name: 'Add scenes…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').first().check();
  await dialog.getByRole('button', { name: /^Add 1 scene/ }).click();
  const preview = page.getByTestId('preview');
  await expect(preview).toHaveAttribute('data-ready', 'true');

  // The panorama is drawn: the preview is no longer (nearly) all black.
  await expect
    .poll(
      async () => {
        const shot = PNG.sync.read(await preview.screenshot());
        let lit = 0;
        for (let i = 0; i < shot.data.length; i += 4 * 97)
          if (shot.data[i]! + shot.data[i + 1]! + shot.data[i + 2]! > 60) lit++;
        return lit / (shot.data.length / (4 * 97));
      },
      { timeout: 30_000, message: 'share of lit pixels in the Tour preview' },
    )
    .toBeGreaterThan(0.5);
  expect(served.some((s) => s.startsWith('200 ') && s.includes('/tiles/'))).toBe(true);
  expect(errors.filter((e) => /SecurityError|cross-origin|tainted/i.test(e))).toEqual([]);
});
