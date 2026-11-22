import type { Page } from '@playwright/test';
import { test, expect } from './offline';

/**
 * Studio fits the window: the page never scrolls, whatever the tab, at the sizes of common
 * laptop windows (1366 x 768 at 100 %, 1280 x 720 = 1920 x 1080 at 150 % scaling). Side
 * panels can be resized by dragging or with the keyboard (remembered), and the interface
 * size changes with A- / A+ and Ctrl - / + / 0.
 */
const STUDIO = 'http://127.0.0.1:4178/index.html';
const DEMO = 'http://127.0.0.1:4179/index.html';
// The editors fit; Media and Versions are long lists that scroll inside their tab.
const TABS = ['Tour', 'Floors', 'Safety', 'Content', 'Training', 'Skin'];

/** The demo facility: every tab has content (plans, equipment, modules, a skin). */
async function openDemo(page: Page) {
  await page.goto(DEMO);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.locator('[role="tablist"]')).toBeVisible();
}

async function openProject(page: Page) {
  await page.goto(STUDIO);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Layout check');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Import media…' }).click();
  await expect(page.locator('.evx-asset')).toHaveCount(10);
  await page.getByRole('tab', { name: 'Tour' }).click();
  await page.getByRole('button', { name: 'Add scenes…' }).click();
  const dialog = page.getByRole('dialog');
  for (const box of await dialog.getByRole('checkbox').all()) await box.check();
  await dialog.getByRole('button', { name: 'Add 10 scenes' }).click();
  await expect(page.getByTestId('preview')).toHaveAttribute('data-ready', 'true');
}

/** How far the page, or the tab area under the project bar, can scroll. */
const pageScroll = (page: Page) =>
  page.evaluate(() =>
    Math.max(
      ...[document.scrollingElement!, document.querySelector('[role="tabpanel"]')!].map(
        (el) => el.scrollHeight - el.clientHeight,
      ),
    ),
  );

for (const size of [
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
]) {
  test(`fits ${size.width} x ${size.height} without the page scrolling, on every tab`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await openDemo(page);
    for (const tab of TABS) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      expect(await pageScroll(page), `${tab}: page scroll`).toBeLessThanOrEqual(0);
      // Nothing in a side panel is cut off at its edge (a long drop-down, a tick).
      const sideways = await page.evaluate(() =>
        [...document.querySelectorAll('.evx-editor__scenes, .evx-editor__inspector')].map(
          (el) => el.scrollWidth - el.clientWidth,
        ),
      );
      expect(Math.max(0, ...sideways), `${tab}: side panel overflow`).toBeLessThanOrEqual(0);
    }
    // The preview is wholly in the window, and a usable size.
    await page.getByRole('tab', { name: 'Tour' }).click();
    const box = (await page.getByTestId('preview').boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    expect(box.height).toBeGreaterThan(250);
  });
}

test('side panels resize by dragging or with the keyboard, and are remembered', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  const list = page.locator('.evx-editor__scenes');
  const before = (await list.boundingBox())!.width;
  const left = page.getByRole('separator', { name: /Width of the left panel/ });
  const h = (await left.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 80, h.y + h.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(Math.abs((await list.boundingBox())!.width - (before + 80))).toBeLessThan(3);

  const inspector = page.locator('.evx-editor > .evx-editor__inspector');
  const right = page.getByRole('separator', { name: /Width of the right panel/ });
  const wide = (await inspector.boundingBox())?.width;
  await right.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  if (wide !== undefined)
    expect(Math.abs((await inspector.boundingBox())!.width - (wide + 32))).toBeLessThan(3);

  const saved = await page.evaluate(() => localStorage.getItem('evx-studio-panels'));
  expect(JSON.parse(saved!).left).toBe(Math.round(before + 80));
  await left.dblclick();
  expect(Math.abs((await list.boundingBox())!.width - before)).toBeLessThan(3);
});

test('the interface size changes with A- / A+ and Ctrl - / + / 0, and is remembered', async ({
  page,
}) => {
  await page.goto(STUDIO);
  const zoom = () => page.evaluate(() => document.documentElement.style.zoom || '1');
  await page.getByRole('button', { name: 'A− Smaller interface (Ctrl −)' }).click();
  expect(await zoom()).toBe('0.9');
  await expect(page.locator('.evx-zoom__level')).toHaveText('90 %');
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  expect(await zoom()).toBe('1.1');
  await page.reload();
  expect(await zoom()).toBe('1.1');
  await page.keyboard.press('Control+0');
  expect(await zoom()).toBe('1');
});

test('the project bar is slim, and full screen is a button as well as F11', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openDemo(page);
  // Logo, project, actions and app controls in one row over the tabs: under 100 px.
  const bar = (await page.locator('.evx-projectbar').boundingBox())!;
  expect(bar.y + bar.height).toBeLessThan(100);
  await page.getByRole('button', { name: 'Full screen (F11)' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.getByRole('button', { name: 'Exit full screen (F11)' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(page.getByRole('button', { name: 'Full screen (F11)' })).toBeVisible();
});
