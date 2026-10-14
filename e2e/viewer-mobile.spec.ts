import { test, expect } from './offline';
import { openDemo, view } from './viewer-helpers';

// Touch gestures through the Chrome DevTools protocol (real touch events, not mouse).
test('touch drag pans and pinch zooms', async ({ page }) => {
  await openDemo(page);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, points: { x: number; y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p, i) => ({ ...p, id: i })),
    });

  const v0 = await view(page);
  await touch('touchStart', [{ x: 150, y: 140 }]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: 150 + i * 20, y: 140 }]);
  await touch('touchEnd', []);
  const v1 = await view(page);
  expect(v1.yaw).toBeLessThan(v0.yaw - 10);

  await touch('touchStart', [
    { x: 180, y: 120 },
    { x: 220, y: 160 },
  ]);
  for (let i = 1; i <= 8; i++)
    await touch('touchMove', [
      { x: 180 - i * 12, y: 120 - i * 6 },
      { x: 220 + i * 12, y: 160 + i * 6 },
    ]);
  await touch('touchEnd', []);
  await expect.poll(async () => (await view(page)).fov).toBeLessThan(v1.fov);
});

test('mobile layout renders the panorama and kit-sized controls', async ({ page }) => {
  await openDemo(page);
  await expect(page).toHaveScreenshot('viewer-mobile-lobby.png');
  for (const b of await page.locator('.evx-btn, .evx-sign, .evx-marker').all()) {
    const box = await b.boundingBox();
    if (box) expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  }
});

test('gyroscope look-around follows device orientation', async ({ page }) => {
  await openDemo(page);
  expect(await page.evaluate(() => window.viewer.enableGyro())).toBe(true);
  const turn = (alpha: number) =>
    page.evaluate((a) => {
      // Phone held upright (beta 90) facing the scene, turned about the vertical axis.
      window.dispatchEvent(
        new DeviceOrientationEvent('deviceorientation', { alpha: a, beta: 90, gamma: 0 }),
      );
    }, alpha);
  await turn(0);
  const start = (await view(page)).yaw;
  await turn(30);
  const turned = (await view(page)).yaw;
  // Turning the phone left (alpha +30°) looks 30° to the left.
  expect(Math.abs(((turned - start + 540) % 360) - 180 - -30)).toBeLessThan(1);
  await page.evaluate(() => window.viewer.disableGyro());
});
