import { test, expect } from './offline';
import { idle, openDemo } from './viewer-helpers';

// Authoring mode used by Studio's live preview (Phase 4).
test.use({ viewport: { width: 1280, height: 720 } });

test.describe('Viewer editing mode', () => {
  test('a click on the panorama reports the direction under the pointer', async ({ page }) => {
    await openDemo(page, '?editing');
    await page.evaluate(() => window.viewer.setView({ yaw: 30, pitch: 10, fov: 90 }));
    await idle(page);
    const event = page.evaluate(
      () =>
        new Promise<{ yaw: number; pitch: number }>((r) =>
          window.viewer.on('panoramaclick', (e) => r(e)),
        ),
    );
    const box = (await page.locator('.evx-viewer').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const e = await event;
    expect(e.yaw).toBeCloseTo(30, 0);
    expect(e.pitch).toBeCloseTo(10, 0);
  });

  test('dragging the panorama is not a click', async ({ page }) => {
    await openDemo(page, '?editing');
    await page.evaluate(() => {
      (window as unknown as { clicks: number }).clicks = 0;
      window.viewer.on('panoramaclick', () => (window as unknown as { clicks: number }).clicks++);
    });
    const box = (await page.locator('.evx-viewer').boundingBox())!;
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 500, box.y + 320, { steps: 8 });
    await page.mouse.up();
    expect(await page.evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(0);
  });

  test('clicking a hotspot selects it instead of running its actions', async ({ page }) => {
    await openDemo(page, '?editing');
    await page.evaluate(() => window.viewer.setView({ yaw: -20 }));
    await idle(page);
    const clicked = page.evaluate(
      () => new Promise<string>((r) => window.viewer.on('hotspotclick', (e) => r(e.hotspotId))),
    );
    await page.getByRole('button', { name: 'Welcome' }).click();
    expect(await clicked).toBeTruthy();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.viewer.variables.welcomed)).toBe(false);
  });

  test('dragging a hotspot reports its new direction and highlights selection', async ({
    page,
  }) => {
    await openDemo(page, '?editing');
    await page.evaluate(() => window.viewer.setView({ yaw: -20, pitch: 0 }));
    await idle(page);
    const hotspot = page.getByRole('button', { name: 'Welcome' });
    const id = (await hotspot.getAttribute('data-hotspot-id'))!;
    await page.evaluate((h) => window.viewer.selectHotspot(h), id);
    await expect(hotspot).toHaveClass(/evx-viewer__hotspot--selected/);

    const moved = page.evaluate(
      () =>
        new Promise<{ hotspotId: string; yaw: number; pitch: number }>((r) =>
          window.viewer.on('hotspotmove', (e) => r(e)),
        ),
    );
    const b = (await hotspot.boundingBox())!;
    const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const host = (await page.locator('.evx-viewer').boundingBox())!;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 150, from.y + 60, { steps: 10 });
    await page.mouse.up();
    const e = await moved;
    const want = await page.evaluate(
      ([x, y]) => window.viewer.screenToView(x!, y!),
      [from.x + 150 - host.x, from.y + 60 - host.y],
    );
    expect(e.hotspotId).toBe(id);
    expect(e.yaw).toBeCloseTo(want.yaw, 0);
    expect(e.pitch).toBeCloseTo(want.pitch, 0);
    // The drag neither ran the hotspot's actions nor panned the camera.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await page.evaluate(() => window.viewer.getView())).yaw).toBeCloseTo(-20, 0);
  });

  test('setEnvironment shows edits live without reloading the scene', async ({ page }) => {
    await openDemo(page, '?editing');
    await page.evaluate(async () => {
      const env = structuredClone(window.viewer.environment);
      const scene = window.viewer.sceneId!;
      env.hotspots.push({
        id: 'added-in-studio',
        sceneId: scene,
        title: { en: 'Added in Studio', fr: 'Ajouté dans Studio' },
        position: { kind: 'spherical', yaw: 0, pitch: 0 },
        appearance: { kind: 'button', icon: 'info' },
        actions: [],
        audienceIds: [],
        hidden: false,
      });
      env.scenes.find((s) => s.id === scene)!.name.en = 'Renamed lobby';
      await window.viewer.setEnvironment(env);
      window.viewer.setView({ yaw: 0, pitch: 0 });
    });
    await expect(page.getByRole('button', { name: 'Added in Studio' })).toBeVisible();
    await expect(page.locator('.evx-viewer')).toHaveAttribute('aria-label', 'Renamed lobby');
  });
});
