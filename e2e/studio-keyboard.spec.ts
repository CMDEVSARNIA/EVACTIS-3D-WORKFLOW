import type { Page } from '@playwright/test';
import { test, expect } from './offline';

/**
 * Phase 12: authoring that used to need a mouse works from the keyboard. On a floor plan
 * a focusable crosshair moves with the arrow keys and Enter places there; in the 360°
 * preview the author turns the view with the arrow keys and places, or moves a hotspot,
 * at the centre of the view.
 */
const STUDIO = 'http://127.0.0.1:4179/index.html';

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

interface Saved {
  equipment: {
    id: string;
    placements: { sceneId: string; position: { kind: string; yaw?: number } }[];
  }[];
  scenes: {
    id: string;
    planPosition?: { x: number; y: number };
    hotspots: { id: string; position: { kind: string; yaw?: number; pitch?: number } }[];
  }[];
  buildings: { floors: { id: string; plan?: { widthPx: number; heightPx: number } }[] }[];
}
let savesSeen = 0;
async function settled(page: Page): Promise<Saved> {
  await expect
    .poll(() => page.evaluate(() => window.__evxMemory!.saves), { timeout: 10_000 })
    .toBeGreaterThan(savesSeen);
  savesSeen = await page.evaluate(() => window.__evxMemory!.saves);
  return JSON.parse(await page.evaluate(() => window.__evxMemory!.manifest)) as Saved;
}

test('places a scene on the plan and a hotspot in the preview with the keyboard only', async ({
  page,
}) => {
  await page.goto(STUDIO);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByTestId('project-name')).toHaveText('Evactis Demo Centre');
  savesSeen = await page.evaluate(() => window.__evxMemory!.saves);

  // ---------------------------------------------------------------- floor plan
  await page.getByRole('tab', { name: 'Floors' }).click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await page.getByRole('radio', { name: 'Place scene' }).click();
  const which = page.getByRole('combobox', { name: 'Scene to place' }).first();
  const sceneId = await which.inputValue();
  const cursor = page.getByRole('application', { name: /^Plan, keyboard cursor at 50% across/ });
  await cursor.focus();
  await expect(page.locator('.evx-plan__crosshair')).toBeVisible();
  // Three big steps right (5 % of the plan each), two small steps up (1 % each).
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowUp');
  await expect(cursor).toHaveAccessibleName(/65% across, 4[78]% down/);
  await page.keyboard.press('Enter');
  const doc = await settled(page);
  const scene = doc.scenes.find((s) => s.id === sceneId)!;
  const floor = doc.buildings.flatMap((b) => b.floors).find((f) => f.plan)!;
  const { widthPx: W, heightPx: H } = floor.plan!;
  const step = Math.max(W, H);
  expect(scene.planPosition!.x).toBeCloseTo(W / 2 + 0.15 * step, 0);
  expect(scene.planPosition!.y).toBeCloseTo(H / 2 - 0.02 * step, 0);

  // ---------------------------------------------------------------- 360° preview
  await page.getByRole('tab', { name: 'Tour' }).click();
  const preview = page.locator('.evx-viewer');
  await expect(preview).toBeVisible();
  const all = (d: Saved) => d.scenes.flatMap((s) => s.hotspots);
  const before = all(doc).length;
  await page.getByRole('radio', { name: 'Add information' }).click();
  // Turn the view with the keyboard, as the Viewer allows, then place at the centre.
  await preview.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Place at the centre of the view' }).click();
  const after = await settled(page);
  expect(all(after).length).toBe(before + 1);
  const added = all(after).find((h) => !all(doc).some((o) => o.id === h.id))!;

  // Move the new (selected) hotspot to the centre of another view.
  await preview.focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Move to the centre of the view' }).click();
  const moved = all(await settled(page)).find((h) => h.id === added.id)!;
  expect(Math.abs(moved.position.yaw! - added.position.yaw!)).toBeGreaterThan(5);

  // ---------------------------------------------------------------- equipment
  // Select an item from the list, choose "Place in scene", turn the view, place: all keys.
  await page.getByRole('tab', { name: 'Safety' }).click();
  const yawOf = (d: Saved) =>
    d.equipment.find((x) => x.id === 'fe-101')!.placements[0]!.position.yaw!;
  const first = yawOf(JSON.parse(await page.evaluate(() => window.__evxMemory!.manifest)));
  await page.locator('.evx-editor__scenes [data-equipment-id="fe-101"]').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('radio', { name: 'Place in scene' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('preview')).toHaveAttribute('data-ready', 'true');
  await page.locator('.evx-viewer').focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Place at the centre of the view' }).focus();
  await page.keyboard.press('Enter');
  expect(Math.abs(yawOf(await settled(page)) - first)).toBeGreaterThan(5);
});
