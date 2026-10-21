import { test, expect } from './offline';
import { DEMO } from './viewer-helpers';

/**
 * Phase 12 performance budgets for what people wait for: the first panorama, a scene
 * change, and opening a delivered package. Measured in CI's headless Chromium with
 * software rendering, so the budgets are ceilings that catch regressions, not targets
 * for real hardware (frame rate is checked on Evactis's reference PCs; see
 * docs/performance.md).
 */
const PLAYER = 'http://127.0.0.1:4181/intranet/index.html';

const BUDGET = {
  firstScene: 4_000, // navigation to the first panorama shown
  fullyLoaded: 8_000, // ... and every tile of it loaded
  sceneChange: 3_000, // a hotspot click to the next scene fully loaded
  packageOpen: 8_000, // a delivered intranet package, every file verified as it loads
};

test.use({ viewport: { width: 1440, height: 900 } });

test('Viewer: first scene, fully loaded, and a scene change within budget', async ({ page }) => {
  const t0 = Date.now();
  await page.goto(DEMO);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  const firstScene = Date.now() - t0;
  await page.evaluate(() => window.viewer.whenIdle());
  const fullyLoaded = Date.now() - t0;

  const t1 = Date.now();
  await page.evaluate(async () => {
    await window.viewer.goToScene('office', { transition: { kind: 'cut' } });
    await window.viewer.whenIdle();
  });
  const sceneChange = Date.now() - t1;

  console.log('Viewer timings (ms):', JSON.stringify({ firstScene, fullyLoaded, sceneChange }));
  expect(firstScene, 'first scene').toBeLessThan(BUDGET.firstScene);
  expect(fullyLoaded, 'fully loaded').toBeLessThan(BUDGET.fullyLoaded);
  expect(sceneChange, 'scene change').toBeLessThan(BUDGET.sceneChange);
});

test('Packaged player: a delivered package opens within budget', async ({ page }) => {
  const t0 = Date.now();
  await page.goto(PLAYER);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  const packageOpen = Date.now() - t0;
  console.log('Player timings (ms):', JSON.stringify({ packageOpen }));
  expect(packageOpen, 'package open').toBeLessThan(BUDGET.packageOpen);
});
