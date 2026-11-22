import type { Page } from '@playwright/test';
import { test, expect } from './offline';
import { DEMO, idle, openDemo, sceneId, view } from './viewer-helpers';

/**
 * Links as floor arrows and the walk-through: chevrons lie on the floor in perspective,
 * lit one after another towards the next scene; following one turns the view to it,
 * moves on, and opens the next scene slightly zoomed in, widening to its normal view.
 */
test.use({ viewport: { width: 1366, height: 768 } });

const arrow = (page: Page, id = 'lobby-to-corridor') => page.locator(`[data-hotspot-id="${id}"]`);

/** The chevrons' screen boxes, nearest first. */
const chevrons = (page: Page, id = 'lobby-to-corridor') =>
  arrow(page, id)
    .locator('.evx-viewer__floor-chevron')
    .evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return {
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          width: r.width,
          animation: s.animationName,
          delay: parseFloat(s.animationDelay),
        };
      }),
    );

test('links lie on the floor as chevrons, in perspective, lit towards the next scene', async ({
  page,
}) => {
  await openDemo(page, '?scene=lobby');
  await page.evaluate(() => window.viewer.setView({ yaw: 0, pitch: -15, fov: 90 }));
  await idle(page);
  // One labelled button for keyboards and screen readers.
  await expect(page.getByRole('button', { name: 'To the east corridor' })).toBeVisible();
  const c = await chevrons(page);
  expect(c).toHaveLength(3);
  const horizon = await page.evaluate(() => {
    const el = window.viewer.element;
    const v = window.viewer.getView();
    // Screen height of the horizon for this pitch and vertical field of view.
    const vfov =
      2 * Math.atan(Math.tan((v.fov * Math.PI) / 360) * (el.clientHeight / el.clientWidth));
    return (
      el.clientHeight / 2 -
      (Math.tan((-v.pitch * Math.PI) / 180) / Math.tan(vfov / 2)) * (el.clientHeight / 2)
    );
  });
  for (const k of c) expect(k.y).toBeGreaterThan(horizon); // on the floor
  // Nearest first: lower on screen and wider than the farther ones (perspective).
  expect(c[0]!.y).toBeGreaterThan(c[1]!.y);
  expect(c[1]!.y).toBeGreaterThan(c[2]!.y);
  expect(c[0]!.width).toBeGreaterThan(c[2]!.width);
  // A highlight runs from the nearest chevron to the farthest.
  expect(c.every((k) => k.animation === 'evx-floor-arrow')).toBe(true);
  expect(c[0]!.delay).toBeLessThan(c[1]!.delay);
  expect(c[1]!.delay).toBeLessThan(c[2]!.delay);
  // Not the safety green of evacuation routes: white with a navy edge.
  const colours = await arrow(page)
    .locator('.evx-viewer__floor-chevron')
    .first()
    .evaluate((e) => [getComputedStyle(e).fill, getComputedStyle(e).stroke]);
  expect(colours).toEqual(['rgb(255, 255, 255)', 'rgb(10, 47, 91)']);
});

test('reduced motion keeps the arrows still; the keyboard follows a link', async ({ page }) => {
  await openDemo(page, '?scene=lobby&reduced-motion');
  const c = await chevrons(page);
  expect(c.every((k) => k.animation === 'none')).toBe(true);
  // Focusing an arrow outside the view turns the view to it; Enter follows it.
  await page.evaluate(() => window.viewer.setView({ yaw: 180, pitch: 0 }));
  await idle(page);
  await expect(arrow(page)).toHaveClass(/evx-viewer__hotspot--offscreen/);
  await arrow(page).focus();
  await expect
    .poll(async () => Math.abs((((await view(page)).yaw - 21.8 + 540) % 360) - 180))
    .toBeLessThan(25);
  await page.keyboard.press('Enter');
  await expect.poll(() => sceneId(page)).toBe('corridor');
});

test('the walk-through turns to the link, then opens the next scene zoomed in and widens', async ({
  page,
}) => {
  await page.goto(`${DEMO}?scene=lobby`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await idle(page);
  // Facing well away from the corridor door (at about 22°), so the view must turn first.
  await page.evaluate(() => window.viewer.setView({ yaw: 120, pitch: 0, fov: 90 }));
  await idle(page);
  await page.evaluate(() => {
    const log: { scene: string | null; yaw: number; fov: number }[] = [];
    (window as unknown as { walkLog: typeof log }).walkLog = log;
    window.viewer.on('viewchange', (v) =>
      log.push({ scene: window.viewer.sceneId, yaw: v.yaw, fov: v.fov }),
    );
  });
  await arrow(page).dispatchEvent('click');
  await expect.poll(() => sceneId(page)).toBe('corridor');
  await idle(page);
  await page.waitForTimeout(900); // the arrival widening runs on after the scene change
  const log = await page.evaluate(
    () => (window as unknown as { walkLog: { scene: string; yaw: number; fov: number }[] }).walkLog,
  );
  const inLobby = log.filter((e) => e.scene === 'lobby');
  const inCorridor = log.filter((e) => e.scene === 'corridor');
  // Turned towards the link before leaving the lobby.
  const near = (yaw: number, want: number) => Math.abs(((((yaw - want) % 360) + 540) % 360) - 180);
  expect(near(inLobby.at(-1)!.yaw, 21.8)).toBeLessThan(5);
  // Arrived facing the way on (0°), zoomed in, then widened back to the normal view.
  expect(near(inCorridor.at(-1)!.yaw, 0)).toBeLessThan(1);
  const normal = await page.evaluate(
    () => window.viewer.environment.scenes.find((s) => s.id === 'corridor')!.initialView.fov,
  );
  expect(Math.min(...inCorridor.map((e) => e.fov))).toBeLessThan(normal * 0.8);
  expect(inCorridor.at(-1)!.fov).toBeCloseTo(normal, 0);
});
