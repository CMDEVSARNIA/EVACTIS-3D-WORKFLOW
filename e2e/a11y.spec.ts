import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './offline';

/**
 * Phase 12: automated accessibility checks (axe-core, WCAG 2.1 A and AA rules) on every
 * screen people use: Studio (start screen in both themes and languages, each editor
 * tab), the Viewer (with its panels open), the packaged player, and the Site Server
 * pages. Contrast has its own, stricter check (e2e/contrast.ts); axe's colour rule is
 * left on as a second opinion. Interactive targets must be at least 24 × 24 px (WCAG
 * 2.2 2.5.8); the 44 px goal for touch is checked on the Viewer toolbar.
 */
const STUDIO = 'http://127.0.0.1:4174/index.html';
const STUDIO_DEMO = 'http://127.0.0.1:4179/index.html';
const VIEWER = 'http://127.0.0.1:4176/index.html';
const PLAYER = 'http://127.0.0.1:4181/intranet/index.html';
const SITE = 'https://127.0.0.1:4190';

test.setTimeout(180_000);
test.use({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });

/** Violations as short lines ("rule (impact): target"), so a failure reads at a glance. */
async function audit(page: Page, include?: string): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  return violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id} (${v.impact}): ${n.target.join(' ')} — ${v.help}`),
  );
}

/**
 * Visible interactive elements smaller than min × min CSS pixels, measured at their own
 * layout size (so the Viewer shown scaled down in Studio's device previews counts at its
 * real size). A checkbox or radio button counts together with its label, which is part
 * of its target.
 */
const smallTargets = (page: Page, scope: string, min: number) =>
  page.evaluate(
    ({ scope, min }) =>
      [
        ...document.querySelectorAll<HTMLElement>(
          `${scope} :is(button, a[href], input, select, [role="button"], [tabindex="0"])`,
        ),
      ]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          if (
            r.width === 0 ||
            s.visibility === 'hidden' ||
            (e as HTMLInputElement).type === 'hidden'
          )
            return false;
          let w = e.offsetWidth;
          let hgt = e.offsetHeight;
          const labels = (e as HTMLInputElement).labels;
          if (labels?.length && /^(checkbox|radio)$/.test((e as HTMLInputElement).type)) {
            const boxes = [r, ...[...labels].map((l) => l.getBoundingClientRect())];
            w = Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.left));
            hgt = Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top));
          }
          return w < min || hgt < min;
        })
        .map((e) => {
          const name =
            e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 30) ?? e.tagName;
          return `${e.tagName.toLowerCase()} "${name}" ${e.offsetWidth}×${e.offsetHeight}`;
        }),
    { scope, min },
  );

test('Studio start screen: both themes, both languages', async ({ page }) => {
  await page.goto(STUDIO);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const found: string[] = [];
  for (const theme of ['dark', 'light']) {
    for (const lang of ['first', 'second']) {
      found.push(...(await audit(page)).map((v) => `${theme}/${lang}: ${v}`));
      await page.getByRole('button', { name: /^(Français|English)$/ }).click();
    }
    await page.getByRole('button', { name: /About|À propos/ }).click();
    found.push(...(await audit(page, '[role="dialog"]')).map((v) => `${theme}/about: ${v}`));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /light\/dark|clair\/sombre/ }).click();
  }
  expect(found).toEqual([]);
  expect(await smallTargets(page, 'body', 24)).toEqual([]);
});

test('Studio editor: every tab of the demo facility', async ({ page }) => {
  await page.goto(STUDIO_DEMO);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByTestId('project-name')).toHaveText('Evactis Demo Centre');
  const found: string[] = [];
  const small: string[] = [];
  for (const tab of ['Tour', 'Floors', 'Safety', 'Content', 'Training', 'Skin', 'Versions']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(500);
    found.push(...(await audit(page)).map((v) => `${tab}: ${v}`));
    small.push(...(await smallTargets(page, 'body', 24)).map((v) => `${tab}: ${v}`));
  }
  expect(found).toEqual([]);
  expect(small).toEqual([]);
});

test('Viewer: scene, menu, information and floor plan', async ({ page }) => {
  await page.goto(VIEWER);
  await expect(page.locator('.evx-skin__heading')).toBeVisible({ timeout: 30_000 });
  const found = (await audit(page)).map((v) => `scene: ${v}`);
  for (const name of [/^Menu$/, /^Floor plan$/]) {
    const button = page.getByRole('button', { name }).first();
    if (!(await button.isVisible())) continue;
    await button.click();
    await page.waitForTimeout(400);
    found.push(...(await audit(page)).map((v) => `${name.source}: ${v}`));
    await page.keyboard.press('Escape');
  }
  expect(found).toEqual([]);
  // Every target meets 24 px (WCAG 2.2 AA); the toolbar, what people tap on tablets
  // and kiosks, meets 44 px. Radar dots stay 24 px on purpose: they sit close together
  // on a small map, and hotspots and the floor plan reach the same places.
  expect(await smallTargets(page, '.evx-skin', 24)).toEqual([]);
  expect(await smallTargets(page, '.evx-skin__toolbar', 44)).toEqual([]);
});

test('Packaged player (intranet)', async ({ page }) => {
  await page.goto(PLAYER);
  await expect(page.locator('.evx-skin__heading')).toBeVisible({ timeout: 60_000 });
  expect(await audit(page)).toEqual([]);
});

test('Site Server: sign-in, portal, administration, environment view', async ({ page }) => {
  const fx = JSON.parse(
    await (await import('node:fs/promises')).readFile('target/e2e-site/fixture.json', 'utf8'),
  ) as { environmentId: string; password: string };
  await page.goto(`${SITE}/`);
  const found = (await audit(page)).map((v) => `sign-in: ${v}`);
  await page.getByLabel('Username').fill('ada');
  await page.getByLabel('Password').fill(fx.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Environments' })).toBeVisible();
  found.push(...(await audit(page)).map((v) => `portal: ${v}`));
  await page.getByRole('link', { name: 'Administration' }).click();
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
  found.push(...(await audit(page)).map((v) => `admin: ${v}`));
  await page.goto(`${SITE}/view/${fx.environmentId}`);
  await expect(page.locator('body')).toHaveAttribute('data-site', 'ready', { timeout: 60_000 });
  found.push(...(await audit(page)).map((v) => `view: ${v}`));
  await page.getByRole('tab', { name: 'Guided session' }).click();
  found.push(...(await audit(page)).map((v) => `session: ${v}`));
  expect(found).toEqual([]);
});
