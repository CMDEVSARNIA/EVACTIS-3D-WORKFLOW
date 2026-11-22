import type { Page } from '@playwright/test';
import { test, expect } from './offline';

/**
 * Hotspot sizes in Studio: the Tour tab sizes links, information and equipment for the
 * whole tour (live in the preview, undoable), a hotspot or an equipment item can have
 * its own size, and an equipment item's size keeps its safety confirmation.
 */
const DEMO = 'http://127.0.0.1:4179/index.html';
test.use({ viewport: { width: 1440, height: 900 } });

interface Doc {
  settings: { hotspotSize: { links: number; information: number; equipment: number } };
  hotspots: { id: string; size?: number }[];
  equipment: { id: string; size?: number; confirmed?: unknown }[];
}
const doc = async (page: Page): Promise<Doc> =>
  JSON.parse(await page.evaluate(() => window.__evxMemory!.manifest));

/** Waits for the next save of the document and returns it. */
async function saved(page: Page, after: number): Promise<Doc> {
  await expect
    .poll(() => page.evaluate(() => window.__evxMemory!.saves), { timeout: 10_000 })
    .toBeGreaterThan(after);
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
  return doc(page);
}
const saves = (page: Page) => page.evaluate(() => window.__evxMemory!.saves);

const widthIn = (page: Page, id: string) =>
  page
    .getByTestId('preview')
    .locator(`[data-hotspot-id="${id}"]`)
    .evaluate((e) => e.getBoundingClientRect().width);

test('sizes hotspots for the whole tour, one hotspot, and one equipment item', async ({ page }) => {
  await page.goto(DEMO);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByTestId('preview')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');

  // The whole tour: information at 150 %; the preview follows.
  const info = await widthIn(page, 'lobby-welcome');
  let n = await saves(page);
  await page.getByTestId('size-information').fill('150');
  let d = await saved(page, n);
  expect(d.settings.hotspotSize).toEqual({ links: 1, information: 1.5, equipment: 1 });
  await expect.poll(() => widthIn(page, 'lobby-welcome')).toBeCloseTo(info * 1.5, 0);
  // One undo step takes it back.
  n = await saves(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  d = await saved(page, n);
  expect(d.settings.hotspotSize.information).toBe(1);

  // One hotspot: select it in the preview, then size it.
  await page.getByTestId('preview').locator('[data-hotspot-id="lobby-welcome"]').click();
  n = await saves(page);
  await page.getByTestId('hotspot-size').fill('60');
  d = await saved(page, n);
  expect(d.hotspots.find((h) => h.id === 'lobby-welcome')!.size).toBe(0.6);
  await expect.poll(() => widthIn(page, 'lobby-welcome')).toBeCloseTo(info * 0.6, 0);

  // One equipment item, in the Safety tab: confirmed before and after.
  await page.getByRole('tab', { name: 'Safety' }).click();
  await page.locator('[data-equipment-id="fe-101"]').first().click();
  expect((await doc(page)).equipment.find((e) => e.id === 'fe-101')!.confirmed).toBeTruthy();
  n = await saves(page);
  await page.getByTestId('equipment-size').fill('200');
  d = await saved(page, n);
  const fe = d.equipment.find((e) => e.id === 'fe-101')!;
  expect(fe.size).toBe(2);
  expect(fe.confirmed).toBeTruthy();
});
