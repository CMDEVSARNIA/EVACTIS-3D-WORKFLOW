import { test, expect } from './offline';
import { contrastProblems } from './contrast';

// The built Studio and Viewer front ends load and render with the network blocked.
// (Inside Tauri the same bundles are served from the app; see the Windows smoke test.)
const STUDIO = 'http://127.0.0.1:4174/index.html';
const VIEWER = 'http://127.0.0.1:4175/index.html';

test('Studio start screen renders offline in both languages', async ({ page }) => {
  await page.goto(STUDIO);
  await expect(page.getByRole('img', { name: 'EVACTIS 3DWORKFLOW' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /^(Français|English)$/ }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', /^(en|fr)$/);
  await page.getByRole('button', { name: /About|À propos/ }).click();
  await expect(page.getByRole('dialog')).toContainText('EVACTIS 3DWORKFLOW Studio');
});

test('Viewer shell renders the lockup, language and a working full-screen button offline', async ({
  page,
}) => {
  await page.goto(VIEWER);
  await expect(page.getByRole('img', { name: 'EVACTIS 3DWORKFLOW' })).toBeVisible();
  // Only controls that work: no decorative toolbar on the start screen.
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.getByRole('button', { name: 'Exit full screen' })).toBeVisible();
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible();
  await page.getByRole('button', { name: 'Français' }).click();
  await expect(page.getByRole('button', { name: 'Ouvrir un environnement…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plein écran' })).toBeVisible();
});

// Every visible text in both themes and both languages, measured from the rendered
// page. (This is the check that would have caught the near-white top-bar buttons.)
test('Studio text meets WCAG contrast in dark and light themes', async ({ page }) => {
  await page.goto(STUDIO);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (const theme of ['dark', 'light']) {
    for (const lang of ['first', 'second']) {
      const problems = await contrastProblems(page);
      expect(problems, `${theme} theme, ${lang} language`).toEqual([]);
      await page.getByRole('button', { name: /^(Français|English)$/ }).click();
    }
    await page.getByRole('button', { name: /About|À propos/ }).click();
    expect(await contrastProblems(page, '[role="dialog"]'), `${theme} About dialog`).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /light\/dark|clair\/sombre/ }).click();
  }
});

test('Viewer shell text meets WCAG contrast', async ({ page }) => {
  await page.goto(VIEWER);
  await expect(page.getByRole('img', { name: 'EVACTIS 3DWORKFLOW' })).toBeVisible();
  expect(await contrastProblems(page)).toEqual([]);
});
