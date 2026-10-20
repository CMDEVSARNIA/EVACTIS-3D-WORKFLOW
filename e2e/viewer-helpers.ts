import type { Page } from '@playwright/test';
import { expect } from './offline';

export const DEMO = 'http://127.0.0.1:4176/index.html';

declare global {
  interface Window {
    viewer: import('../packages/viewer/src/index.ts').Viewer;
  }
}

/** Opens the demo facility and waits until the first panorama is fully loaded. */
export async function openDemo(page: Page, query = '') {
  await page.goto(`${DEMO}${query}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await idle(page);
}

export const idle = (page: Page) => page.evaluate(() => window.viewer.whenIdle());
export const view = (page: Page) => page.evaluate(() => window.viewer.getView());
export const sceneId = (page: Page) => page.evaluate(() => window.viewer.sceneId);

/** Picks a setting in the skin's menu (audience, conditions, language), then closes it. */
export async function chooseInMenu(page: Page, label: string, value: string) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await menu.getByRole('combobox', { name: label }).selectOption(value);
  if (await menu.isVisible()) await menu.getByRole('button', { name: 'Close' }).click();
  await expect(menu).toBeHidden();
}
