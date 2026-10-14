import { test, expect } from './offline';
import { idle, openDemo, sceneId, view } from './viewer-helpers';

test.use({ viewport: { width: 1280, height: 720 } });

test.describe('Viewer core (desktop)', () => {
  test('initial panorama and hotspots match the approved rendering', async ({ page }) => {
    await openDemo(page);
    await expect(page).toHaveScreenshot('viewer-lobby.png');
    await page.evaluate(() => window.viewer.setView({ yaw: -90, pitch: 0 }));
    await idle(page);
    await expect(page).toHaveScreenshot('viewer-lobby-west.png');
  });

  test('every scene renders', async ({ page }) => {
    await openDemo(page, '?audience=first-responders');
    for (const id of ['corridor', 'stairwell', 'office', 'electrical', 'assembly']) {
      await page.evaluate((s) => window.viewer.goToScene(s, { transition: { kind: 'cut' } }), id);
      await idle(page);
      await expect(page).toHaveScreenshot(`viewer-${id}.png`);
    }
  });

  test('mouse drag pans, wheel zooms, keyboard pans and zooms', async ({ page }) => {
    await openDemo(page);
    const before = await view(page);
    await page.mouse.move(640, 300);
    await page.mouse.down();
    await page.mouse.move(840, 300, { steps: 10 });
    await page.mouse.up();
    const dragged = await view(page);
    expect(dragged.yaw).toBeLessThan(before.yaw - 20);

    await page.mouse.wheel(0, -400);
    await expect.poll(async () => (await view(page)).fov).toBeLessThan(dragged.fov);

    await page.getByRole('application').focus();
    const k0 = await view(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    const k1 = await view(page);
    expect(k1.yaw).toBeCloseTo(k0.yaw + 5, 5);
    expect(k1.pitch).toBeCloseTo(k0.pitch + 5, 5);
    await page.keyboard.press('-');
    expect((await view(page)).fov).toBeGreaterThan(k1.fov);
  });

  test('hotspots are keyboard reachable and announce their titles', async ({ page }) => {
    await openDemo(page);
    const sign = page.getByRole('button', { name: 'Fire alarm pull station' });
    await sign.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Fire alarm pull station' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Pull down firmly');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  test('conditions, variables and quiz questions', async ({ page }) => {
    await openDemo(page);
    await page.evaluate(() => window.viewer.setView({ yaw: 180 }));
    await expect(page.getByRole('button', { name: 'Quick question' })).toHaveCount(0);
    await page.evaluate(() => window.viewer.setView({ yaw: -20 }));
    await page.getByRole('button', { name: 'Welcome' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    expect(await page.evaluate(() => window.viewer.variables.welcomed)).toBe(true);
    await page.evaluate(() => window.viewer.setView({ yaw: 160 }));
    const answer = page.evaluate(() => new Promise((r) => window.viewer.on('answer', (a) => r(a))));
    await page.getByRole('button', { name: 'Quick question' }).click();
    await page.getByRole('button', { name: 'On the west wall of the lobby' }).click();
    await expect(page.getByRole('status')).toHaveText('Correct');
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    expect(await answer).toMatchObject({ correct: true, choiceId: 'west', points: 1 });
  });

  test('audiences gate scenes and hotspots; the switcher re-filters live', async ({ page }) => {
    await openDemo(page, '?scene=office');
    await expect(page.getByRole('button', { name: 'Electrical room' })).toHaveCount(0);
    const err = await page.evaluate(
      () =>
        new Promise<string>((r) => {
          window.viewer.on('error', ({ error }) => r(error.message));
          void window.viewer.goToScene('electrical');
        }),
    );
    expect(err).toMatch(/not available to this audience/);
    await page.evaluate(() => window.viewer.setAudience('first-responders'));
    await page.evaluate(() => window.viewer.setView({ yaw: -90 }));
    await page.getByRole('button', { name: 'Electrical room' }).click();
    await expect.poll(() => sceneId(page)).toBe('electrical');
    await expect(page.getByRole('button', { name: /Main electrical panel/ })).toHaveCount(1);
  });

  test('external links are refused offline and never requested', async ({ page }) => {
    await openDemo(page);
    const blocked = await page.evaluate(
      () =>
        new Promise((r) => {
          window.viewer.on('blocked', (b) => r(b));
          void window.viewer.runActions([
            { type: 'openUrl', url: 'https://example.com/manual.pdf' },
          ]);
        }),
    );
    expect(blocked).toEqual({ url: 'https://example.com/manual.pdf', reason: 'offline-policy' });
    await expect(page.getByRole('dialog')).toContainText('External links are disabled');
  });

  test('French interface and content', async ({ page }) => {
    await openDemo(page, '?lang=fr');
    await expect(page.getByRole('application')).toHaveAttribute('aria-label', 'Hall principal');
    await expect(page.getByRole('application')).toHaveAttribute(
      'aria-roledescription',
      'Panorama à 360°',
    );
    await expect(page.getByRole('button', { name: 'Vers le couloir est' })).toBeVisible();
  });

  test('transitions run and finish (fade, walk, reduced motion)', async ({ page }) => {
    await openDemo(page);
    const t0 = Date.now();
    await page.evaluate(() =>
      window.viewer.goToScene('corridor', { transition: { kind: 'walk', durationMs: 600 } }),
    );
    expect(Date.now() - t0).toBeGreaterThanOrEqual(550);
    await expect(page.locator('.evx-viewer__snapshot')).toHaveCount(0);
    await openDemo(page, '?reduced-motion');
    const t1 = Date.now();
    await page.evaluate(() =>
      window.viewer.goToScene('corridor', { transition: { kind: 'zoom', durationMs: 2000 } }),
    );
    expect(Date.now() - t1).toBeLessThan(1500);
  });

  test('loads only from the package folder', async ({ page }) => {
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));
    await openDemo(page);
    expect(urls.length).toBeGreaterThan(5);
    for (const u of urls)
      expect(u.startsWith('http://127.0.0.1:4176/') || u.startsWith('data:')).toBe(true);
  });
});
