import type { Page } from '@playwright/test';
import { test, expect } from './offline';
import { idle, openDemo } from './viewer-helpers';

/**
 * Hotspot sizes: the tour sets a size for links, information and equipment
 * (settings.hotspotSize), and any hotspot or equipment item can add its own on top.
 * 50 % keeps every hotspot at least 24 px across (WCAG 2.2 target size).
 */
test.use({ viewport: { width: 1366, height: 768 } });

const width = (page: Page, id: string) =>
  page.locator(`[data-hotspot-id="${id}"]`).evaluate((e) => e.getBoundingClientRect().width);

/** Applies settings and per-item sizes to the shown environment, as Studio's preview does. */
async function resize(
  page: Page,
  sizes: { links: number; information: number; equipment: number },
  items: { hotspot?: [string, number]; equipment?: [string, number] } = {},
) {
  await page.evaluate(
    async ({ sizes, items }) => {
      const env = structuredClone(window.viewer.environment);
      env.settings.hotspotSize = sizes;
      if (items.hotspot)
        env.hotspots.find((h) => h.id === items.hotspot![0])!.size = items.hotspot[1];
      if (items.equipment)
        env.equipment.find((e) => e.id === items.equipment![0])!.size = items.equipment[1];
      await window.viewer.setEnvironment(env);
    },
    { sizes, items },
  );
  await idle(page);
}

test('the tour sizes links, information and equipment; items add their own size', async ({
  page,
}) => {
  await openDemo(page, '?scene=lobby');
  await page.evaluate(() => window.viewer.setView({ yaw: 0, pitch: -10, fov: 90 }));
  await idle(page);
  const info = await width(page, 'lobby-welcome');
  const sign = await width(page, 'equipment:fa-101');
  const link = await width(page, 'lobby-to-corridor');
  expect(info).toBeCloseTo(48, 0);

  await resize(page, { links: 2, information: 0.5, equipment: 1.5 });
  expect(await width(page, 'lobby-welcome')).toBeCloseTo(24, 0); // the smallest: 24 px
  expect(await width(page, 'equipment:fa-101')).toBeCloseTo(sign * 1.5, 0);
  expect(await width(page, 'lobby-to-corridor')).toBeGreaterThan(link * 1.5);

  // An item's own size multiplies the tour's (here back to 100 %, then to 150 %).
  await resize(
    page,
    { links: 1, information: 0.5, equipment: 1 },
    {
      hotspot: ['lobby-welcome', 2],
      equipment: ['fa-101', 1.5],
    },
  );
  expect(await width(page, 'lobby-welcome')).toBeCloseTo(info, 0);
  expect(await width(page, 'equipment:fa-101')).toBeCloseTo(sign * 1.5, 0);
  expect(await width(page, 'lobby-to-corridor')).toBeCloseTo(link, 0);
});
