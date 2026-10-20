import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { contrastProblems } from './contrast';
import { test, expect } from './offline';
import { chooseInMenu, idle, openDemo, sceneId } from './viewer-helpers';

/**
 * Phase 8 acceptance (Viewer): the demo facility's sample modules run end to end —
 * "find your nearest exit" (with a hint, so it is not passed), "locate the AED on
 * floor 2" (passed, with a local certificate PDF), the office hazard hunt (by clicking
 * and by "Inspect"), and per-audience modules for contractors.
 */
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

const panel = (page: Page) => page.locator('.evx-training');
const action = (page: Page, name: string) => panel(page).locator(`[data-training="${name}"]`);

async function startModule(page: Page, title: string) {
  await page.getByRole('button', { name: 'Start training module' }).click();
  const picker = page.getByRole('dialog', { name: 'Training' });
  await picker.getByRole('button', { name: `Start: ${title}` }).click();
  await expect(panel(page)).toBeVisible();
  await idle(page);
}

/** Records module events from the page. */
async function recordEvents(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { trainingLog: unknown[] };
    w.trainingLog = [];
    for (const type of ['modulestart', 'modulestep', 'modulecomplete', 'moduleend'] as const)
      window.viewer.on(type, (p) => w.trainingLog.push({ type, ...p }));
  });
}
const log = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { trainingLog: Record<string, unknown>[] }).trainingLog,
  );

/** Turns to a direction and clicks the panorama there (the centre of the view). */
async function clickAt(page: Page, yaw: number, pitch: number) {
  await page.evaluate(
    ([y, p]) => window.viewer.setView({ yaw: y, pitch: p, fov: 80 }),
    [yaw, pitch],
  );
  await idle(page);
  const box = (await page.locator('.evx-viewer canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('find your nearest exit: hint, route, question, checklist; not passed with the hint', async ({
  page,
}) => {
  await openDemo(page, '?scene=lobby');
  await recordEvents(page);
  await startModule(page, 'Find your nearest exit');
  await expect.poll(() => sceneId(page)).toBe('office');
  await expect(panel(page)).toHaveAccessibleName('Training: Find your nearest exit');
  await expect(panel(page).locator('.evx-training__eyebrow')).toHaveText('Step 1 of 2');
  expect(await contrastProblems(page, '.evx-training'), 'panel').toEqual([]);

  // The hint shows the route (and halves the step's points).
  await action(page, 'hint').click();
  await expect(panel(page).getByRole('status')).toContainText('Leave by the exit sign');
  await expect(action(page, 'hint')).toBeDisabled();
  await expect(page.locator('.evx-viewer__route')).toBeVisible();
  // The route banner (top) and the step panel (bottom) never overlap.
  const routeBox = (await page.locator('.evx-viewer__route').boundingBox())!;
  const panelBox = (await panel(page).boundingBox())!;
  expect(routeBox.y + routeBox.height, 'route banner above the panel').toBeLessThanOrEqual(
    panelBox.y,
  );

  // Walk the route out.
  for (const id of ['stairwell', 'lobby', 'assembly']) {
    await page.evaluate((s) => window.viewer.goToScene(s), id);
    await idle(page);
  }
  const question = page.getByRole('dialog', {
    name: 'The main exit is blocked by smoke. What do you do?',
  });
  await question.getByRole('button', { name: 'Use the north exit by the east corridor' }).click();
  await expect(question.getByRole('status')).toContainText('the alternative route is the north');
  await question.getByRole('button', { name: 'Close' }).click();

  // The checklist: the step ticked one item; the learner confirms the other.
  const checklist = page.getByRole('dialog', { name: 'Checklist: Find your nearest exit' });
  await expect(checklist.getByRole('checkbox', { name: 'I know my nearest exit' })).toBeChecked();
  await expect(checklist.getByRole('checkbox', { name: 'I know my nearest exit' })).toBeDisabled();
  await expect(checklist.getByRole('button', { name: 'Finish' })).toBeDisabled();
  await checklist.getByRole('checkbox', { name: 'I know where assembly point A is' }).check();
  await checklist.getByRole('button', { name: 'Finish' }).click();

  const results = page.getByRole('dialog', { name: 'Results: Find your nearest exit' });
  await expect(results).toContainText('Score: 2 / 3 (67 %)');
  await expect(results).toContainText('Not passed: the pass mark is 80 %.');
  await expect(results.locator('li[data-status="hinted"]')).toHaveCount(1);
  await expect(results.getByRole('button', { name: 'Download certificate (PDF)' })).toHaveCount(0);
  expect(await contrastProblems(page, 'dialog[open]'), 'results').toEqual([]);
  await results.getByRole('button', { name: 'Close' }).click();
  await expect(panel(page)).toBeHidden();

  const events = await log(page);
  expect(events.map((e) => e.type)).toEqual([
    'modulestart',
    'modulestep',
    'modulestep',
    'modulecomplete',
    'moduleend',
  ]);
  expect(events[3]).toMatchObject({
    moduleId: 'nearest-exit',
    score: 2,
    max: 3,
    percent: 67,
    passed: false,
    checklist: expect.arrayContaining(['know-exit', 'know-assembly']),
  });
});

test('locate the AED on floor 2: navigate, find the sign, answer; certificate PDF', async ({
  page,
}) => {
  await openDemo(page, '?scene=office');
  await startModule(page, 'Locate the AED on floor 2');
  await expect.poll(() => sceneId(page)).toBe('lobby');
  await expect(panel(page).locator('.evx-training__instruction')).toHaveText(
    'Go up to the open office on the second floor.',
  );
  await page.evaluate(() => window.viewer.goToScene('office'));
  await idle(page);
  await expect(panel(page).locator('.evx-training__eyebrow')).toHaveText('Step 2 of 3');

  // Selecting another sign does nothing; the AED's completes the step.
  await page.evaluate(() => window.viewer.setView({ yaw: -100, pitch: 0, fov: 100 }));
  await idle(page);
  await page.locator('[data-hotspot-id="equipment:aed-2"]').click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Close' }).click();
  const question = page.getByRole('dialog', { name: 'You open the AED cabinet. What next?' });
  await question.getByRole('button', { name: 'Turn it on and follow the voice prompts' }).click();
  await question.getByRole('button', { name: 'Close' }).click();

  const results = page.getByRole('dialog', { name: 'Results: Locate the AED on floor 2' });
  await expect(results).toContainText('Score: 3 / 3 (100 %)');
  await expect(results.locator('.evx-training__verdict')).toHaveText('Passed');
  await results.getByLabel('Your name (as it should appear)').fill('Marie-Ève Tremblay');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    results.getByRole('button', { name: 'Download certificate (PDF)' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('aed-floor-2-certificate.pdf');
  const path = await download.path();
  expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
  const text = execFileSync('pdftotext', [path, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
  for (const s of [
    'Marie-Ève Tremblay',
    'Locate the AED on floor 2',
    'Repérez le DEA du deuxième étage',
    'Evactis Demo Centre',
    'Result: 3 / 3 (100 %)',
  ])
    expect(text, s).toContain(s);
});

test('hazard hunt: found by clicking and by Inspect; misses say so', async ({ page }) => {
  await openDemo(page, '?scene=office');
  await startModule(page, 'Hazard hunt: open office');
  const status = panel(page).getByRole('status');
  const spill = { yaw: -129.81, pitch: -22.28 };
  const boxes = { yaw: -75.96, pitch: -7.6 };

  // The centre of the view (what "Inspect" checks) is marked and never under the panel.
  await expect(page.locator('.evx-training__reticle')).toBeVisible();
  const p = (await panel(page).boundingBox())!;
  expect(p.y, 'panel stays below the centre').toBeGreaterThan(900 / 2 + 20);
  await clickAt(page, 30, -30);
  await expect(status).toHaveText('Nothing hazardous there. Keep looking.');
  await clickAt(page, spill.yaw, spill.pitch);
  await expect(status).toHaveText('Found: Spill on the floor (1 of 2).');
  await expect(page.locator('[data-hotspot-id="training:spill"]')).toBeVisible();
  // Keyboard path: turn to the boxes and press "Inspect".
  await page.evaluate((v) => window.viewer.setView({ ...v, fov: 80 }), boxes);
  await idle(page);
  await action(page, 'inspect').click();

  const checklist = page.getByRole('dialog', { name: 'Checklist: Hazard hunt: open office' });
  await checklist.getByRole('checkbox', { name: 'I will report hazards to my supervisor' }).check();
  await checklist.getByRole('button', { name: 'Finish' }).click();
  const results = page.getByRole('dialog', { name: 'Results: Hazard hunt: open office' });
  await expect(results).toContainText('Score: 2 / 2 (100 %)');
});

test('modules follow the audience; checklist button; French panel', async ({ page }) => {
  await openDemo(page, '?scene=lobby');
  // No module running: the checklist button says how to get one.
  await page.getByRole('button', { name: 'Checklist' }).click();
  await expect(page.locator('dialog[open]')).toContainText('Start a training module');
  await page.locator('dialog[open]').getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Start training module' }).click();
  let picker = page.getByRole('dialog', { name: 'Training' });
  await expect(picker.locator('.evx-training__module')).toHaveCount(3);
  await expect(picker).not.toContainText('Contractor orientation');
  await picker.getByRole('button', { name: 'Close' }).click();

  await chooseInMenu(page, 'Audience', 'contractors');
  await page.getByRole('button', { name: 'Start training module' }).click();
  picker = page.getByRole('dialog', { name: 'Training' });
  await expect(picker.locator('.evx-training__module')).toHaveCount(4);
  await picker.getByRole('button', { name: 'Start: Contractor orientation' }).click();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start training module' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // The checklist button now opens this module's (empty) checklist dialog.
  await page.getByRole('button', { name: 'Français' }).click();
  await expect(panel(page)).toHaveAccessibleName('Formation : Accueil des entrepreneurs');
  await expect(panel(page).locator('.evx-training__eyebrow')).toHaveText('Étape 1 sur 2');
  await expect(action(page, 'leave')).toHaveText('Quitter le module');
  await action(page, 'leave').click();
  await expect(panel(page)).toBeHidden();
});
