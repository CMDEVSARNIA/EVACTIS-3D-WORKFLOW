import type { Page } from '@playwright/test';
import { contrastProblems } from './contrast';
import { test, expect } from './offline';

/**
 * Phase 6, Studio side: in the demo facility, an author imports a sound, a PDF and
 * photos (through the real Rust pipeline, e2e/fixtures/studio-demo.mjs), makes the sound
 * spatial and places it by clicking the preview, builds an album, adjusts the smoke
 * layer and previews it, draws an animated region, wires actions to a hotspot, and
 * times a hotspot of the 360° video. Every change lands in the saved document.
 */
const STUDIO = 'http://127.0.0.1:4179/index.html';

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(180_000);

interface Saved {
  audio: { id: string; kind: string; sceneIds: string[]; position?: { yaw: number } }[];
  documents: { id: string; title: { en: string; fr: string }; source: string }[];
  albums: { id: string; items: { source: string; caption?: { en: string } }[] }[];
  liveLayers: {
    id: string;
    overrides: { sceneId: string; stateId: string; lighting?: { visibilityM?: number } }[];
  }[];
  animatedRegions: { id: string; sceneId: string; polygon: unknown[]; source: string }[];
  hotspots: {
    id: string;
    actions: { type: string }[];
    timeRange?: { start: number; end: number };
  }[];
}

let savesSeen = 0;
async function settled(page: Page): Promise<Saved> {
  await expect
    .poll(() => page.evaluate(() => window.__evxMemory!.saves), { timeout: 10_000 })
    .toBeGreaterThan(savesSeen);
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
  savesSeen = await page.evaluate(() => window.__evxMemory!.saves);
  return JSON.parse(await page.evaluate(() => window.__evxMemory!.manifest));
}

async function clickPreview(page: Page, fx: number, fy: number) {
  await expect(page.getByTestId('preview')).toHaveAttribute('data-ready', 'true');
  const box = (await page.getByTestId('preview').boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

const section = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });

test('authors sounds, documents, albums, live layers, regions and timed hotspots in Studio', async ({
  page,
}) => {
  await page.goto(STUDIO);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByTestId('project-name')).toHaveText('Evactis Demo Centre');
  await page.getByRole('tab', { name: 'Content' }).click();
  savesSeen = await page.evaluate(() => window.__evxMemory!.saves);

  // ---------------------------------------------------------------- a spatial sound
  await page.getByRole('combobox', { name: 'Scene' }).selectOption('corridor');
  await page.getByRole('button', { name: 'Import sounds…' }).click();
  const sound = page.getByTestId('sound-inspector');
  await expect(sound.getByRole('heading')).toHaveText('Fire alarm');
  await sound.getByLabel('Kind').selectOption('spatial');
  await sound
    .getByRole('button', { name: 'Click in the preview where the sound comes from' })
    .click();
  await clickPreview(page, 0.75, 0.5);
  await expect(sound.getByTestId('sound-position')).not.toContainText('not placed');
  let doc = await settled(page);
  const added = doc.audio.find((a) => a.id === 'fire-alarm')!;
  expect(added).toMatchObject({ kind: 'spatial', sceneIds: ['corridor'] });
  // Right of centre in the preview: a positive yaw from the corridor's start view (0°).
  expect(added.position!.yaw).toBeGreaterThan(10);
  expect(await contrastProblems(page, '[role="tabpanel"]'), 'sounds').toEqual([]);

  // ---------------------------------------------------------------- a PDF document
  await section(page, 'Documents').click();
  await page.getByRole('button', { name: 'Import PDF documents…' }).click();
  const docInspector = page.getByTestId('document-inspector');
  await docInspector.getByLabel('Title (French)').fill('Procédures d’urgence (copie)');
  doc = await settled(page);
  const pdf = doc.documents.find((d) => d.id === 'emergency-procedures')!;
  expect(pdf.title.fr).toBe('Procédures d’urgence (copie)');
  expect(pdf.source).toMatch(/^media\/[0-9a-f]{16}\/source\.pdf$/);

  // ---------------------------------------------------------------- an album
  await section(page, 'Photo albums').click();
  await page.getByRole('button', { name: 'New album from photos…' }).click();
  const albumInspector = page.getByTestId('album-inspector');
  await expect(albumInspector.getByTestId('album-photos').getByRole('listitem')).toHaveCount(2);
  await albumInspector.getByLabel('Caption (English)').first().fill('Front entrance');
  await albumInspector.getByRole('button', { name: 'Move down: 1' }).click();
  doc = await settled(page);
  const album = doc.albums.find((a) => a.id === 'photos')!;
  expect(album.items).toHaveLength(2);
  expect(album.items[1]!.caption?.en).toBe('Front entrance');
  expect(album.items.every((i) => /photo\.jpg$/.test(i.source))).toBe(true);
  expect(await contrastProblems(page, '[role="tabpanel"]'), 'albums').toEqual([]);

  // ---------------------------------------------------------------- the smoke layer
  await section(page, 'Live layers').click();
  await page.locator('[data-item-id="conditions"]').click();
  const layer = page.getByTestId('layer-inspector');
  await page.getByRole('combobox', { name: 'Scene' }).selectOption('lobby');
  // The scene's name is announced on arrival; switch conditions once it is there.
  await expect(page.locator('.evx-viewer__live')).toHaveText('Main lobby');
  await layer.getByLabel('Show this state in the preview').check();
  await expect(page.locator('.evx-viewer__live')).toHaveText('Conditions: Smoke');
  await layer.getByTestId('scene-look').getByLabel('Visibility (m, empty = clear)').fill('1.5');
  doc = await settled(page);
  const lobbySmoke = doc.liveLayers
    .find((l) => l.id === 'conditions')!
    .overrides.find((o) => o.sceneId === 'lobby' && o.stateId === 'smoke')!;
  expect(lobbySmoke.lighting?.visibilityM).toBe(1.5);
  await layer.getByLabel('Show this state in the preview').uncheck();
  await expect(page.locator('.evx-viewer__live')).toHaveText('Conditions: Normal');

  // ---------------------------------------------------------------- an animated region
  await section(page, 'Animated regions').click();
  await page.getByRole('button', { name: 'Draw a region in this scene' }).click();
  await clickPreview(page, 0.4, 0.4);
  await clickPreview(page, 0.6, 0.4);
  await expect(page.getByTestId('region-hint')).toContainText('2 corner(s)');
  await clickPreview(page, 0.5, 0.6);
  await page.getByLabel('Video or image (file in the package)').fill('media/lobby/strobe.webm');
  await page.getByRole('button', { name: 'Finish region' }).click();
  await expect(page.getByTestId('region-inspector')).toContainText('3 corners');
  doc = await settled(page);
  const region = doc.animatedRegions.find((r) => r.sceneId === 'lobby' && r.id !== 'lobby-strobe')!;
  expect(region).toMatchObject({ source: 'media/lobby/strobe.webm' });
  expect(region.polygon).toHaveLength(3);

  // ---------------------------------------------------------------- actions and timing
  await page.getByRole('tab', { name: 'Tour' }).click();
  await page.locator('.evx-scene[data-scene-id="lobby"]').click();
  await page
    .locator('.evx-viewer__hotspot[data-hotspot-id="lobby-welcome"]')
    .dispatchEvent('click');
  const hotspot = page.getByTestId('hotspot-inspector');
  for (const [type, pick] of [
    ['playAudio', 'Play a sound'],
    ['openAlbum', 'Open a photo album'],
    ['openDocument', 'Open a document (PDF)'],
    ['setLiveLayer', 'Switch conditions (live layer)'],
  ] as const) {
    await hotspot.getByRole('combobox', { name: 'Add action…' }).selectOption({ label: pick });
    await expect(hotspot.locator(`[data-action-type="${type}"]`)).toHaveCount(1);
  }
  const play = hotspot.locator('[data-action-type="playAudio"]');
  await play.getByLabel('Sound').selectOption('fire-alarm');
  doc = await settled(page);
  expect(doc.hotspots.find((h) => h.id === 'lobby-welcome')!.actions.map((a) => a.type)).toEqual([
    'openPopup',
    'setVariable',
    'playAudio',
    'openAlbum',
    'openDocument',
    'setLiveLayer',
  ]);

  // The drill video's exit instruction, retimed.
  await page.locator('.evx-scene[data-scene-id="drill"]').click();
  await page.locator('.evx-viewer__hotspot[data-hotspot-id="drill-exit"]').dispatchEvent('click');
  const timing = hotspot.getByTestId('time-range');
  await expect(timing.getByLabel('Show only during the video')).toBeChecked();
  await timing.getByLabel('From (s)').fill('3');
  doc = await settled(page);
  expect(doc.hotspots.find((h) => h.id === 'drill-exit')!.timeRange).toEqual({ start: 3, end: 10 });
  // Hotspots of panorama scenes have no timing.
  await page.locator('.evx-scene[data-scene-id="lobby"]').click();
  await page
    .locator('.evx-viewer__hotspot[data-hotspot-id="lobby-welcome"]')
    .dispatchEvent('click');
  await expect(hotspot.getByTestId('time-range')).toHaveCount(0);
});
