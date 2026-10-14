import { test, expect } from './offline';

const ready = async (page: import('@playwright/test').Page) => {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-testid="sign-warning-B"]')).toBeVisible();
};

test.use({ viewport: { width: 1200, height: 1300 } });

test('brand sheet matches the approved rendering', async ({ page }) => {
  await page.goto('/index.html');
  await ready(page);
  await expect(page.locator('#sheet')).toHaveScreenshot('brand-sheet.png');
});

test('product lockup and chrome', async ({ page }) => {
  await page.goto('/index.html');
  await ready(page);
  await expect(page.locator('#extras')).toHaveScreenshot('brand-extras.png');
});

test('all 18 icons × 3 states, 2 markers × 2 states and 7 signs × 2 styles render', async ({
  page,
}) => {
  await page.goto('/index.html');
  await ready(page);
  await expect(page.locator('#sheet .evx-btn')).toHaveCount(54);
  await expect(page.locator('#sheet .evx-marker')).toHaveCount(4);
  await expect(page.locator('#sheet .evx-sign')).toHaveCount(14);
  // Every control has an accessible name and meets the 44 px touch-target minimum.
  for (const el of await page.locator('#sheet button').all()) {
    expect(await el.getAttribute('aria-label')).toBeTruthy();
    const box = (await el.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  }
});

test('button states come from real interaction, not only data-state', async ({ page }) => {
  await page.goto('/index.html');
  await ready(page);
  const b = page.locator('[data-testid="btn-home-default"]');
  const bar = b.locator('.evx-btn__bar');
  const width = async () => (await bar.boundingBox())!.width;
  const short = await width();
  await b.hover();
  await expect.poll(width).toBeGreaterThan(short * 2);
  await page.mouse.move(0, 0);
  await b.evaluate((el) => el.setAttribute('aria-pressed', 'true'));
  await expect(b).toHaveCSS('background-color', 'rgb(93, 149, 24)');
});
