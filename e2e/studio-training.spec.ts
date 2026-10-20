import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { contrastProblems } from './contrast';
import { test, expect } from './offline';

/**
 * Phase 8, Studio side: in the demo facility an author builds a module (find an item, a
 * hazard hunt with a hazard clicked in the preview, a question, a checklist item linked
 * to a step, an audience), tests it in the real Viewer, and exports SCORM 1.2 — a ZIP
 * with the manifest, player, environment and the files the environment uses.
 */
const STUDIO = 'http://127.0.0.1:4179/index.html';
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(180_000);

interface Saved {
  modules: {
    id: string;
    title: { en: string; fr: string };
    audienceIds: string[];
    startSceneId?: string;
    passMark: number;
    steps: Record<string, unknown>[];
    checklist: { id: string; stepId?: string; label: { en: string } }[];
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

test('builds, tests and exports a training module in Studio', async ({ page }) => {
  await page.goto(STUDIO);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByTestId('project-name')).toHaveText('Evactis Demo Centre');
  await page.getByRole('tab', { name: 'Training' }).click();
  savesSeen = await page.evaluate(() => window.__evxMemory!.saves);
  const list = page.getByTestId('module-list');
  await expect(list.getByRole('button')).toHaveCount(4);
  await expect(list).toContainText('Contractor orientation');
  await expect(page.getByTestId('preview')).toHaveAttribute('data-ready', 'true');
  expect(await contrastProblems(page, '[role="tabpanel"]'), 'training tab').toEqual([]);

  // ---------------------------------------------------------------- a new module
  await page.getByRole('button', { name: 'New module' }).click();
  const inspector = page.getByTestId('module-inspector');
  await inspector.getByLabel('Title (English)').fill('Fire warden walk');
  await inspector.getByLabel('Title (French)').fill('Tournée du responsable');
  await inspector.getByRole('checkbox', { name: 'Staff' }).check();
  await inspector.getByLabel('Starts in').selectOption('office');
  await inspector.getByLabel('Pass mark (%)').fill('50');
  let doc = await settled(page);
  let mod = doc.modules.find((m) => m.id === 'new-training-module')!;
  expect(mod).toMatchObject({
    title: { en: 'Fire warden walk', fr: 'Tournée du responsable' },
    audienceIds: ['staff'],
    startSceneId: 'office',
    passMark: 50,
  });

  // ---------------------------------------------------------------- steps
  await page.getByRole('radio', { name: 'Steps' }).click();
  const addStep = async (kind: string) => {
    await page.getByLabel('New step').selectOption({ label: kind });
    await page.getByRole('button', { name: 'Add step' }).click();
  };
  const step = page.getByTestId('step-inspector');

  await addStep('Find an item');
  await step.getByLabel('Item to find').selectOption('aed-2');

  // A hazard hunt in the office: the first hazard at the view centre, a second clicked.
  await page.getByRole('toolbar').getByLabel('Scene').selectOption('office');
  await expect(page.getByTestId('preview').locator('.evx-viewer')).toHaveAttribute(
    'aria-label',
    'Open office',
  );
  await addStep('Hazard hunt');
  await expect(step.getByTestId('hazard-list').locator('[data-hazard]')).toHaveCount(1);
  await step.getByRole('button', { name: 'Add a hazard: click it in the preview' }).click();
  const stage = (await page.getByTestId('preview').boundingBox())!;
  await page.mouse.click(stage.x + stage.width * 0.25, stage.y + stage.height * 0.7);
  await expect(step.getByTestId('hazard-list').locator('[data-hazard]')).toHaveCount(2);
  const second = step.locator('[data-hazard="hazard-2"]');
  await second.getByLabel('Hazard (English)').fill('Blocked extinguisher');
  await second.getByLabel('Hazard (French)').fill('Extincteur obstrué');
  await step.getByLabel('Hazards to find').selectOption('1');
  // The hazards show in the preview as labels the author can drag.
  await expect(page.locator('[data-hotspot-id="preview-hazard-hazard-2"]')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('studio-training-hazards.png') });

  await addStep('Question');
  await step.getByLabel('Question (English)').fill('Where is the AED on this floor?');
  await step.getByLabel('Question (French)').fill('Où est le DEA de cet étage?');
  await step.getByLabel('Answer 1 (English)').fill('By the stairwell door');
  await step.getByLabel('Answer 2 (English)').fill('On the west wall');
  await step.getByRole('radio', { name: 'Correct answer (2)' }).check();

  // ---------------------------------------------------------------- checklist
  await page.getByRole('radio', { name: 'Checklist' }).click();
  await page.getByRole('button', { name: 'Add item' }).click();
  const items = page.getByTestId('checklist-inspector');
  await items.getByLabel('Item (English)').fill('I know where the AED is');
  await items.getByLabel('Item (French)').fill('Je sais où est le DEA');
  await items.getByLabel('Ticked by').selectOption({ label: '2. Find an item' });
  doc = await settled(page);
  mod = doc.modules.find((m) => m.id === 'new-training-module')!;
  expect(mod.steps.map((s) => s.kind)).toEqual([
    'reach-exit',
    'find-item',
    'hazard-hunt',
    'question',
  ]);
  expect(mod.steps[1]).toMatchObject({ targetId: 'aed-2' });
  expect(mod.steps[2]).toMatchObject({
    required: 1,
    hazards: [
      { id: 'hazard-1', sceneId: 'office' },
      { id: 'hazard-2', sceneId: 'office', label: { en: 'Blocked extinguisher' } },
    ],
  });
  expect(mod.steps[3]).toMatchObject({
    question: {
      choices: [{ correct: false }, { correct: true, label: { en: 'On the west wall' } }],
    },
  });
  expect(mod.checklist).toEqual([
    {
      id: 'item-1',
      label: { en: 'I know where the AED is', fr: 'Je sais où est le DEA' },
      stepId: 'step-2',
    },
  ]);
  expect(await contrastProblems(page, '[role="tabpanel"]'), 'checklist').toEqual([]);

  // ---------------------------------------------------------------- test it
  await page.getByRole('button', { name: 'Test the module' }).click();
  const panel = page.getByTestId('preview').locator('.evx-training');
  await expect(panel).toHaveAccessibleName('Training: Fire warden walk');
  await expect(panel.locator('.evx-training__eyebrow')).toHaveText('Step 1 of 4');
  await page.screenshot({ path: test.info().outputPath('studio-training-test.png') });
  await page.getByRole('button', { name: 'Back to editing' }).click();
  await expect(panel).toBeHidden();

  // ---------------------------------------------------------------- SCORM export
  await page.getByLabel('SCORM version').selectOption('1.2');
  await page.getByRole('button', { name: 'Export SCORM package…' }).click();
  await expect(page.getByTestId('scorm-exported')).toContainText(
    'SCORM package saved: /e2e/exports/Evactis Demo Centre-SCORM-1.2.zip',
    { timeout: 60_000 },
  );
  const b64: string = await page.evaluate(() => {
    const bytes = [...window.__evxMemory!.exports.values()].at(-1)!;
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  const zip = test.info().outputPath('scorm12.zip');
  writeFileSync(zip, Buffer.from(b64, 'base64'));
  const run = (...args: string[]) => execFileSync('unzip', args, { encoding: 'utf8' });
  expect(run('-t', zip)).toContain('No errors');
  const listing = run('-l', zip);
  for (const f of [
    'imsmanifest.xml',
    'index.html',
    'player.js',
    'environment.json',
    'media/lobby/tiles/f/0/0_0.jpg',
    'docs/emergency-procedures.pdf',
  ])
    expect(listing, f).toContain(f);
  const manifest = run('-p', zip, 'imsmanifest.xml');
  expect(manifest).toContain('<schemaversion>1.2</schemaversion>');
  expect(manifest).toContain('parameters="?module=new-training-module"');
  expect(manifest).toContain('<title>Fire warden walk</title>');
  expect(manifest).toContain('<adlcp:masteryscore>50</adlcp:masteryscore>');
  const packed = JSON.parse(run('-p', zip, 'environment.json'));
  expect(packed.modules.map((m: { id: string }) => m.id)).toContain('new-training-module');
});
