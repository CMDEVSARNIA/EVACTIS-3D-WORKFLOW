import type { Page } from '@playwright/test';
import type { XRDevice } from 'iwer';
import { PNG } from 'pngjs';
import { buildIwer } from './fixtures/iwer.mjs';
import { test, expect } from './offline';
import { idle, openDemo, sceneId } from './viewer-helpers';

/**
 * Phase 9 acceptance (VR): the demo facility in the WebXR emulator (IWER, a Meta Quest 3
 * emulated in the page; test-only). The VR button appears only where a headset session is
 * possible; in the headset the reader gets the VR toolbar subset, the scene's hotspots and
 * equipment signs, dialogs as panels, and selects by controller (trigger) or by gaze.
 */
declare global {
  interface Window {
    __xrDevice: XRDevice;
  }
}

test.use({ viewport: { width: 1280, height: 720 } });
test.setTimeout(120_000);

let iwer = '';
test.beforeAll(async () => {
  iwer = await buildIwer();
});

interface Item {
  id: string;
  kind: string;
  label: string;
  x: number;
  y: number;
  z: number;
}
const items = (page: Page): Promise<Item[]> => page.evaluate(() => window.viewer.vrItems);
const item = async (page: Page, id: string) => {
  const found = (await items(page)).find((i) => i.id === id);
  expect(found, `VR item ${id}`).toBeTruthy();
  return found!;
};

/** Rotation turning -Z (where controllers and heads point) towards a direction. */
function towards(d: { x: number; y: number; z: number }) {
  const n = Math.hypot(d.x, d.y, d.z);
  const [x, y, z] = [d.x / n, d.y / n, d.z / n];
  const q = [y, -x, 0, 1 - z];
  const m = Math.hypot(...q);
  return q.map((c) => c / m) as [number, number, number, number];
}

/** Points the right controller at a VR item and pulls the trigger. */
async function pointAndSelect(page: Page, id: string) {
  const target = await item(page, id);
  await page.evaluate(
    ([t]) => {
      const dev = window.__xrDevice;
      const c = dev.controllers.right!;
      // The 'local' space starts at the head: controller positions are relative to it.
      const head = dev.position.vec3;
      const p = c.position.vec3;
      const local = { x: p[0] - head[0], y: p[1] - head[1], z: p[2] - head[2] };
      (window as unknown as { __aim: unknown }).__aim = {
        x: t.x - local.x,
        y: t.y - local.y,
        z: t.z - local.z,
      };
    },
    [target],
  );
  const dir = await page.evaluate(
    () => (window as unknown as { __aim: { x: number; y: number; z: number } }).__aim,
  );
  const q = towards(dir);
  await page.evaluate((q) => window.__xrDevice.controllers.right!.quaternion.set(...q), q);
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('trigger', 1));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('trigger', 0));
}

/** Turns the head towards a VR item (gaze). */
async function lookAt(page: Page, id: string) {
  const t = await item(page, id);
  const q = towards(t);
  await page.evaluate((q) => window.__xrDevice.quaternion.set(...q), q);
}

async function enterVr(page: Page) {
  await page.getByRole('button', { name: 'VR headset', exact: true }).click();
  // Software rendering of two eyes is slow in CI: allow time for the first frames.
  await expect.poll(() => page.evaluate(() => window.viewer.inVr), { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await items(page)).length, { timeout: 30_000 }).toBeGreaterThan(5);
}

test('without a headset runtime there is no VR button', async ({ page }) => {
  await openDemo(page, '?scene=lobby');
  await expect(page.locator('.evx-skin__toolbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'VR headset', exact: true })).toHaveCount(0);
});

test('VR in the WebXR emulator: toolbar subset, controller and gaze selection, panels', async ({
  page,
}) => {
  await page.addInitScript({ path: iwer });
  await openDemo(page, '?scene=lobby');
  await page.evaluate(() => {
    const w = window as unknown as { vrLog: string[] };
    w.vrLog = [];
    for (const e of ['vrstart', 'vrend', 'routechange'] as const)
      window.viewer.on(e, () => w.vrLog.push(e));
  });
  await enterVr(page);

  // The VR-friendly subset of the toolbar, and every hotspot and sign of the scene.
  const all = await items(page);
  expect(all.filter((i) => i.kind === 'toolbar').map((i) => i.id)).toEqual([
    'toolbar:home',
    'toolbar:previous',
    'toolbar:next',
    'toolbar:evac-route',
    'toolbar:exit',
  ]);
  const hotspots = all.filter((i) => i.kind === 'hotspot').map((i) => i.id);
  expect(hotspots).toEqual(
    expect.arrayContaining(['lobby-to-corridor', 'lobby-welcome', 'equipment:fe-101']),
  );
  await page.screenshot({ path: test.info().outputPath('vr-lobby.png') });

  // Controller: an information hotspot opens its dialog as a panel; its button closes it.
  await pointAndSelect(page, 'lobby-welcome');
  await expect(page.locator('dialog[open]')).toBeVisible();
  await expect
    .poll(async () => (await items(page)).map((i) => i.kind))
    .toEqual(expect.arrayContaining(['panel']));
  const panel = (await items(page)).filter((i) => i.kind === 'panel');
  expect(panel.map((i) => i.label)).toContain('Close');
  // While the panel is open nothing else answers (the dialog is modal on screen too).
  expect((await items(page)).every((i) => i.kind === 'panel')).toBe(true);
  await page.screenshot({ path: test.info().outputPath('vr-panel.png') });
  await pointAndSelect(page, panel.find((i) => i.label === 'Close')!.id);
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  // The evacuation route from the VR toolbar.
  await expect.poll(async () => (await items(page)).some((i) => i.kind === 'toolbar')).toBe(true);
  await pointAndSelect(page, 'toolbar:evac-route');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { vrLog: string[] }).vrLog))
    .toContain('routechange');
  await page.screenshot({ path: test.info().outputPath('vr-route.png') });

  // Gaze: without controllers, looking at a link hotspot until the ring fills selects it.
  await page.evaluate(() => {
    for (const c of Object.values(window.__xrDevice.controllers)) c!.connected = false;
  });
  await lookAt(page, 'lobby-to-corridor');
  await expect.poll(() => sceneId(page), { timeout: 10_000 }).toBe('corridor');
  await idle(page);

  // Exit by gaze on the toolbar's exit button.
  await expect
    .poll(async () => (await items(page)).some((i) => i.id === 'toolbar:exit'))
    .toBe(true);
  await lookAt(page, 'toolbar:exit');
  await expect.poll(() => page.evaluate(() => window.viewer.inVr), { timeout: 10_000 }).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { vrLog: string[] }).vrLog)).toEqual(
    expect.arrayContaining(['vrstart', 'vrend']),
  );
});

test('GLB and splat scenes show equipment hotspots, on screen and in VR', async ({ page }) => {
  await page.addInitScript({ path: iwer });
  for (const [scene, ids] of [
    ['dock', ['equipment:fe-105', 'equipment:exit-dock', 'equipment:fak-103']],
    ['mechanical', ['equipment:fe-106']],
  ] as const) {
    await openDemo(page, `?scene=${scene}`);
    for (const id of ids) {
      const h = page.locator(`[data-hotspot-id="${id}"]`);
      await expect(h, id).toHaveCount(1);
    }
    // Facing the first sign, it is on screen near the centre.
    await page.evaluate((id) => {
      const el = document.querySelector(`[data-hotspot-id="${id}"]`) as HTMLElement;
      el.focus();
    }, ids[0]);
    await idle(page);
    await page.waitForTimeout(600);
    await idle(page);
    await expect(page.locator(`[data-hotspot-id="${ids[0]}"]`)).not.toHaveClass(/offscreen/);
    // The scene itself is drawn (not just the hotspots over a blank canvas).
    const shot = PNG.sync.read(
      await page.locator('.evx-viewer canvas').screenshot({
        path: test.info().outputPath(`${scene}.png`),
      }),
    );
    const colours = new Set<number>();
    for (let i = 0; i < shot.data.length; i += 4 * 97)
      colours.add(
        (shot.data[i]! >> 3) * 1024 + (shot.data[i + 1]! >> 3) * 32 + (shot.data[i + 2]! >> 3),
      );
    expect(colours.size, `${scene} renders`).toBeGreaterThan(40);

    await enterVr(page);
    const vr = await items(page);
    for (const id of ids)
      expect(
        vr.map((i) => i.id),
        id,
      ).toContain(id);
    await page.screenshot({ path: test.info().outputPath(`vr-${scene}.png`) });
    await page.evaluate(() => window.viewer.exitVr());
    await expect.poll(() => page.evaluate(() => window.viewer.inVr)).toBe(false);
  }
});
