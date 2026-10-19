import { test, expect } from './offline';
import type { Page } from '@playwright/test';
import { idle, openDemo, sceneId } from './viewer-helpers';

/** Focusing an off-screen hotspot turns the view to it; then it can be pressed. */
async function go(page: Page, name: string) {
  const b = page.getByRole('button', { name, exact: true });
  await b.focus();
  await expect(b).not.toHaveClass(/offscreen/);
  await b.click();
}

// Runs on desktop and mobile: the demo facility is navigable with the network blocked.
test('demo facility opens offline and is navigable through hotspots', async ({ page }) => {
  await openDemo(page);
  expect(await sceneId(page)).toBe('lobby');
  await expect(page.getByRole('application')).toHaveAttribute('aria-label', 'Main lobby');
  await go(page, 'To the east corridor');
  await expect.poll(() => sceneId(page)).toBe('corridor');
  await go(page, 'Back to the lobby');
  await expect.poll(() => sceneId(page)).toBe('lobby');
  await go(page, 'To stairwell A');
  await expect.poll(() => sceneId(page)).toBe('stairwell');
  await idle(page);
  await go(page, 'Up to the second floor');
  await expect.poll(() => sceneId(page)).toBe('office');
  await idle(page);
  expect(await page.evaluate(() => window.viewer.visitedScenes)).toEqual([
    'lobby',
    'corridor',
    'stairwell',
    'office',
  ]);
});
