import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { contrastProblems } from './contrast';
import { test, expect } from './offline';

/**
 * Phase 4 acceptance: a 10-scene, 2-floor facility tour with linked hotspots, built
 * entirely in Studio's UI, then navigated in the Viewer.
 *
 * Studio runs as its browser test build (in-memory backend instead of the Rust commands);
 * the media was imported by the real Rust pipeline (e2e/fixtures/studio-project.mjs).
 */
const STUDIO = 'http://127.0.0.1:4178/index.html';
const VIEWER = 'http://127.0.0.1:4176/index.html';
const FIXTURE = 'target/e2e-studio-project/project';

const ROOMS = [
  'Main entrance',
  'Reception',
  'Corridor west',
  'Corridor east',
  'Stair A ground',
  'Stair A level 2',
  'Office 201',
  'Server room',
  'Meeting room',
  'Roof access',
];
const id = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(180_000);

interface Saved {
  scenes: {
    id: string;
    floorId?: string;
    planPosition?: { x: number; y: number };
    initialView: { yaw: number };
    northOffsetDeg: number;
  }[];
  hotspots: {
    id: string;
    sceneId: string;
    position: { yaw: number; pitch: number };
    actions: { type: string; sceneId?: string; content?: { body: Record<string, string> } }[];
  }[];
  buildings: { floors: { id: string; level: number; plan?: { pixelsPerMetre?: number } }[] }[];
  initialSceneId: string;
}

const saved = async (page: Page): Promise<Saved> =>
  JSON.parse(await page.evaluate(() => window.__evxMemory!.manifest));

let savesSeen = 0;

/**
 * Waits for the autosave that follows the last edit (the backend's save counter moves;
 * the status badge alone can lag a render behind), then returns the document on "disk".
 */
async function settled(page: Page): Promise<Saved> {
  await expect
    .poll(() => page.evaluate(() => window.__evxMemory!.saves), { timeout: 10_000 })
    .toBeGreaterThan(savesSeen);
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
  savesSeen = await page.evaluate(() => window.__evxMemory!.saves);
  return saved(page);
}

/** Waits until the preview stops moving (drag inertia, view animations). */
async function still(page: Page) {
  const preview = page.getByTestId('preview');
  await expect(async () => {
    const a = await preview.screenshot();
    await page.waitForTimeout(250);
    expect((await preview.screenshot()).equals(a)).toBe(true);
  }).toPass({ timeout: 10_000 });
}

async function clickPlan(page: Page, fx: number, fy: number) {
  const box = (await page.getByTestId('plan-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

async function selectScene(page: Page, name: string) {
  await page.locator(`.evx-scene[data-scene-id="${id(name)}"]`).click();
  await expect(page.getByTestId('scene-inspector').getByRole('heading').first()).toHaveText(name);
}

/** One floor: import its plan, set the scale, then place its scenes left to right. */
async function buildFloor(page: Page, floorButton: string, scenes: string[]) {
  await page.locator(`.evx-scene[data-floor-id="${floorButton}"]`).click();
  await page.getByRole('button', { name: 'Import plan image…' }).click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();

  // Scale: two points 80 % of the plan width apart (1280 px) are 64 m apart.
  await page.getByRole('radio', { name: 'Set scale' }).click();
  await clickPlan(page, 0.1, 0.9);
  await clickPlan(page, 0.9, 0.9);
  await page.getByLabel('Distance (m)').fill('64');
  await page.getByRole('button', { name: 'Set scale', exact: true }).click();
  await expect(page.getByTestId('plan-scale')).toHaveText(/^(19\.9|20\.0|20\.1) px per metre$/);

  const inspector = page.getByTestId('floor-inspector');
  for (const s of scenes)
    await inspector.getByRole('combobox', { name: 'Scene to place' }).selectOption(id(s));
  await expect(inspector.getByTestId('floor-scenes').getByRole('listitem')).toHaveCount(
    scenes.length,
  );
  // Place mode starts with the first unplaced scene and moves on after each click.
  await page.getByRole('radio', { name: 'Place scene' }).click();
  for (let i = 0; i < scenes.length; i++) {
    await expect(page.getByRole('combobox', { name: 'Scene to place' }).first()).toHaveValue(
      id(scenes[i]!),
    );
    // 300 px (15 m) apart along the middle of the plan.
    await clickPlan(page, (200 + 300 * i) / 1600, 0.5);
  }
  await expect(page.locator('[data-testid="plan-canvas"] g[data-scene-id]')).toHaveCount(
    scenes.length,
  );
}

test('builds a 10-scene, 2-floor tour with linked hotspots in Studio and navigates it', async ({
  page,
}) => {
  // ---------------------------------------------------------------- project + media
  await page.goto(STUDIO);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Riverside Plant');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('project-name')).toHaveText('Riverside Plant');
  await page.getByRole('button', { name: 'Import media…' }).click();
  await expect(page.locator('.evx-asset')).toHaveCount(10);

  // ---------------------------------------------------------------- scenes
  await page.getByRole('tab', { name: 'Tour' }).click();
  await page.getByRole('button', { name: 'Add scenes…' }).click();
  const dialog = page.getByRole('dialog');
  for (const box of await dialog.getByRole('checkbox').all()) await box.check();
  await dialog.getByRole('button', { name: 'Add 10 scenes' }).click();
  await expect(page.locator('.evx-scene[data-scene-id]')).toHaveCount(10);
  await expect(page.locator('.evx-viewer canvas')).toBeVisible();

  // ---------------------------------------------------------------- floors
  await page.getByRole('tab', { name: 'Floors' }).click();
  await page.getByRole('button', { name: 'Add building' }).click();
  await page.getByRole('button', { name: 'Add floor' }).click();
  await buildFloor(page, 'ground-floor', ROOMS.slice(0, 5));
  await buildFloor(page, 'level-1', ROOMS.slice(5));

  // ---------------------------------------------------------------- links
  await page.getByRole('tab', { name: 'Tour' }).click();
  for (let i = 0; i < ROOMS.length; i++) {
    await selectScene(page, ROOMS[i]!);
    const suggestions = page.getByTestId('suggestions');
    for (const j of [i - 1, i + 1]) {
      const target = ROOMS[j];
      if (!target) continue;
      await suggestions
        .locator(`[data-target="${id(target)}"]`)
        .getByRole('button', { name: 'Add link' })
        .click();
      await expect(suggestions.locator(`[data-target="${id(target)}"]`)).toHaveCount(0);
    }
  }
  let doc = await settled(page);
  expect(doc.hotspots).toHaveLength(18);

  // Plan-based links point where the neighbour is: east of the entrance is yaw 90°
  // (plan and panorama north both at 0°), 15 m away so aimed at the floor.
  const toReception = doc.hotspots.find(
    (h) => h.sceneId === 'main-entrance' && h.actions[0]?.sceneId === 'reception',
  )!;
  expect(Math.abs(toReception.position.yaw - 90)).toBeLessThan(1);
  expect(Math.abs(toReception.position.pitch + 6.1)).toBeLessThan(0.3);

  // ---------------------------------------------------------------- hand edits
  // An information point placed by clicking, with its text written in both languages.
  await selectScene(page, 'Server room');
  await page.getByRole('radio', { name: 'Add information' }).click();
  const stage = (await page.locator('.evx-viewer').boundingBox())!;
  await page.mouse.click(stage.x + stage.width * 0.3, stage.y + stage.height * 0.4);
  const hotspotPanel = page.getByTestId('hotspot-inspector');
  await hotspotPanel.getByLabel('Title (English)').fill('Electrical panel');
  await hotspotPanel.getByLabel('Title (French)').fill('Panneau électrique');
  await hotspotPanel.getByLabel('Text (English)').fill('Authorised staff only.');
  await hotspotPanel.getByLabel('Text (French)').fill('Personnel autorisé seulement.');

  // Drag it, then undo the drag and redo it. (Wait for the typing to be saved first:
  // the preview redraws its hotspots after each edit.)
  doc = await settled(page);
  const placed = doc.hotspots.find((h) => h.sceneId === 'server-room' && h.actions[0]?.content)!;
  const marker = page.locator('.evx-viewer__hotspot--selected');
  await expect(marker).toBeVisible();
  const m = (await marker.boundingBox())!;
  await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
  await page.mouse.down();
  await page.mouse.move(m.x + 150, m.y + 40, { steps: 10 });
  await page.mouse.up();
  doc = await settled(page);
  const info = doc.hotspots.find((h) => h.sceneId === 'server-room' && h.actions[0]?.content)!;
  expect(info.actions[0]!.content!.body).toEqual({
    en: 'Authorised staff only.',
    fr: 'Personnel autorisé seulement.',
  });
  const dragged = info.position.yaw;
  expect(Math.abs(dragged - placed.position.yaw)).toBeGreaterThan(5);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  doc = await settled(page);
  const undone = doc.hotspots.find((h) => h.id === info.id)!.position.yaw;
  expect(Math.abs(undone - dragged)).toBeGreaterThan(5);
  await page.keyboard.press('Control+y');
  doc = await settled(page);
  expect(doc.hotspots.find((h) => h.id === info.id)!.position.yaw).toBe(dragged);

  // Start view and north from the live preview.
  await selectScene(page, 'Main entrance');
  // Look to the right by dragging the panorama to the left.
  const pano = (await page.locator('.evx-viewer').boundingBox())!;
  await page.mouse.move(pano.x + pano.width * 0.7, pano.y + pano.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(pano.x + pano.width * 0.3, pano.y + pano.height * 0.6, { steps: 12 });
  await page.mouse.up();
  await still(page);
  await page.getByRole('button', { name: 'Use current view as start view' }).click();
  await page.getByRole('button', { name: 'North is where I am looking' }).click();
  doc = await settled(page);
  const entrance = doc.scenes.find((s) => s.id === 'main-entrance')!;
  expect(entrance.initialView.yaw).toBeGreaterThan(5);
  expect(entrance.northOffsetDeg).toBe(entrance.initialView.yaw);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  doc = await settled(page);
  expect(doc.scenes.find((s) => s.id === 'main-entrance')!.northOffsetDeg).toBe(0);

  // ---------------------------------------------------------------- saved document
  expect(doc.scenes.map((s) => s.id)).toEqual(ROOMS.map(id));
  expect(doc.initialSceneId).toBe('main-entrance');
  const floors = doc.buildings.flatMap((b) => b.floors);
  expect(floors.map((f) => [f.id, f.level])).toEqual([
    ['ground-floor', 0],
    ['level-1', 1],
  ]);
  // Clicks land within a pixel of their target on screen; the plan is larger.
  for (const f of floors) expect(f.plan?.pixelsPerMetre).toBeCloseTo(20, 0);
  for (const [i, s] of doc.scenes.entries()) {
    expect(s.floorId).toBe(i < 5 ? 'ground-floor' : 'level-1');
    expect(Math.abs(s.planPosition!.x - (200 + 300 * (i % 5)))).toBeLessThan(3);
    expect(Math.abs(s.planPosition!.y - 500)).toBeLessThan(3);
  }
  const ids = new Set(doc.scenes.map((s) => s.id));
  for (const h of doc.hotspots)
    for (const a of h.actions) if (a.type === 'goToScene') expect(ids.has(a.sceneId!)).toBe(true);

  // ---------------------------------------------------------------- versions
  await page.getByRole('tab', { name: 'Versions' }).click();
  await page.getByLabel('Version name').fill('Tour linked');
  await page.getByRole('button', { name: 'Save version' }).click();
  await expect(page.getByTestId('versions').getByText('Tour linked')).toBeVisible();

  // ---------------------------------------------------------------- walk the tour
  // Studio's "Test the tour": the Viewer runs the hotspots as the client will see them.
  await page.getByRole('tab', { name: 'Tour' }).click();
  await selectScene(page, 'Main entrance');
  await page.getByRole('button', { name: 'Test the tour' }).click();
  for (const next of ROOMS.slice(1)) {
    const link = page.locator('.evx-viewer').getByRole('button', { name: next, exact: true });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.evx-scene[aria-current="true"]')).toHaveAttribute(
      'data-scene-id',
      id(next),
    );
  }
  await page.getByRole('button', { name: 'Back to editing' }).click();
  await expect(page.getByRole('radio', { name: 'Select and move' })).toBeVisible();

  // ---------------------------------------------------------------- the shipped Viewer
  // The saved environment and project media, played by the Viewer page (demo build).
  const manifest = await page.evaluate(() => window.__evxMemory!.manifest);
  const viewer = await page.context().newPage();
  await viewer.route(`${VIEWER.replace('index.html', '')}environment.json`, (r) =>
    r.fulfill({ body: manifest, contentType: 'application/json' }),
  );
  await viewer.route(`${VIEWER.replace('index.html', '')}media/**`, (r) =>
    r.fulfill({
      body: readFileSync(join(FIXTURE, new URL(r.request().url()).pathname)),
      contentType: r.request().url().endsWith('.png') ? 'image/png' : 'image/jpeg',
    }),
  );
  await viewer.goto(VIEWER);
  await expect(viewer.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  expect(await viewer.evaluate(() => window.viewer!.sceneId)).toBe('main-entrance');
  for (const next of ROOMS.slice(1, 7)) {
    const link = viewer.getByRole('button', { name: next, exact: true });
    await link.focus();
    await viewer.keyboard.press('Enter');
    await expect.poll(() => viewer.evaluate(() => window.viewer!.sceneId)).toBe(id(next));
  }
});

// The editor screens, in both themes and both languages, with something selected in
// each: every visible text must meet WCAG AA (e2e/contrast.ts).
test('the editor screens meet WCAG text contrast', async ({ page }) => {
  await page.goto(STUDIO);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Contrast');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Import media…' }).click();
  await expect(page.locator('.evx-asset')).toHaveCount(10);
  await page.getByRole('tab', { name: 'Tour' }).click();
  await page.getByRole('button', { name: 'Add scenes…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').first().check();
  await dialog.getByRole('checkbox').nth(1).check();
  expect(await contrastProblems(page, '[role="dialog"]'), 'add scenes dialog').toEqual([]);
  await dialog.getByRole('button', { name: 'Add 2 scenes' }).click();
  await page.getByRole('tab', { name: 'Floors' }).click();
  await page.getByRole('button', { name: 'Add building' }).click();
  await page.getByRole('button', { name: 'Import plan image…' }).click();

  const tabs = /^(Tour|Visite|Floors|Étages|Versions)$/;
  for (const theme of ['dark', 'light']) {
    for (const lang of ['en', 'fr']) {
      for (const tab of await page.getByRole('tab', { name: tabs }).all()) {
        await tab.click();
        const where = `${theme}, ${lang}, ${await tab.textContent()}`;
        // The preview (a panorama) and the plan image are pictures, not text.
        expect(await contrastProblems(page, '.evx-projectbar'), where).toEqual([]);
        expect(await contrastProblems(page, '[role="tabpanel"]'), where).toEqual([]);
      }
      // A hotspot selected: its inspector and the action editor.
      await page.getByRole('tab', { name: /^(Tour|Visite)$/ }).click();
      await page
        .getByRole('radio', { name: /^(Add information|Ajouter une information)$/ })
        .click();
      // The tab remounts the preview: click only once its viewer is listening.
      await expect(page.getByTestId('preview')).toHaveAttribute('data-ready', 'true');
      const stage = (await page.locator('.evx-viewer').boundingBox())!;
      await page.mouse.click(stage.x + stage.width * 0.4, stage.y + stage.height * 0.4);
      await expect(page.getByTestId('hotspot-inspector')).toBeVisible();
      expect(
        await contrastProblems(page, '[role="tabpanel"]'),
        `${theme}, ${lang}, hotspot`,
      ).toEqual([]);
      await page.getByRole('button', { name: /^(Français|English)$/ }).click();
    }
    await page.getByRole('button', { name: /light\/dark|clair\/sombre/ }).click();
  }
});

declare global {
  interface Window {
    __evxMemory?: { manifest: string; saves: number };
  }
}
