import type { FrameLocator, Page } from '@playwright/test';
import { test, expect } from './offline';

/**
 * Phase 8 acceptance (SCORM): the demo facility exported as SCORM 1.2 and 2004 runs in
 * a strict local LMS harness (e2e/scorm-harness): the SCO starts its module, the result
 * reaches the LMS through the runtime API in the right vocabulary, and the session ends
 * cleanly when the learner exits. Nothing leaves the machine.
 */
const HARNESS = 'http://127.0.0.1:4180/index.html';
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

interface Lms {
  version: string;
  log: [string, ...string[]][];
  data: Record<string, string>;
  committed?: Record<string, string>;
  errors: string[];
  state: string;
  launched: string;
}
const lms = (page: Page) => page.evaluate(() => (window as unknown as { lms: Lms }).lms);

async function launch(page: Page, pkg: string, item: string): Promise<FrameLocator> {
  await page.goto(`${HARNESS}?pkg=${pkg}&item=${item}`);
  const frame = page.frameLocator('iframe[title="Course"]');
  await expect(frame.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  return frame;
}

/** The AED module in the SCO: navigate, find the sign, answer. */
async function runAedModule(page: Page, course: FrameLocator) {
  const panel = course.locator('.evx-training');
  await expect(panel).toHaveAccessibleName('Training: Locate the AED on floor 2');
  await course
    .locator('body')
    .evaluate(() =>
      (window as unknown as { viewer: { goToScene(id: string): Promise<void> } }).viewer.goToScene(
        'office',
      ),
    );
  await expect(panel.locator('.evx-training__eyebrow')).toHaveText('Step 2 of 3');
  await course.locator('body').evaluate(async () => {
    const v = (
      window as unknown as { viewer: { setView(v: object): void; whenIdle(): Promise<void> } }
    ).viewer;
    v.setView({ yaw: -100, pitch: 0, fov: 100 });
    await v.whenIdle();
  });
  await course.locator('[data-hotspot-id="equipment:aed-2"]').click();
  await course.locator('dialog[open]').getByRole('button', { name: 'Close' }).click();
  const q = course.getByRole('dialog', { name: 'You open the AED cabinet. What next?' });
  await q.getByRole('button', { name: 'Turn it on and follow the voice prompts' }).click();
  await q.getByRole('button', { name: 'Close' }).click();
  const results = course.getByRole('dialog', { name: 'Results: Locate the AED on floor 2' });
  await expect(results).toContainText('Score: 3 / 3 (100 %)');
  // The LMS's learner name is offered for the certificate.
  await expect(results.getByLabel('Your name (as it should appear)')).toHaveValue(
    'Marie-Ève Tremblay',
  );
}

test('SCORM 1.2: the module reports passed, score and session time, then finishes', async ({
  page,
}) => {
  const course = await launch(page, 'scorm12', 'item-aed-floor-2');
  let s = await lms(page);
  expect(s.version).toBe('1.2');
  expect(s.launched).toBe('./scorm12/index.html?module=aed-floor-2');
  expect(s.state).toBe('running');
  expect(s.data['cmi.core.lesson_status']).toBe('incomplete');

  await runAedModule(page, course);
  s = await lms(page);
  expect(s.committed).toMatchObject({
    'cmi.core.lesson_status': 'passed',
    'cmi.core.score.raw': '100',
    'cmi.core.score.min': '0',
    'cmi.core.score.max': '100',
  });

  await page.getByRole('button', { name: 'Exit course' }).click();
  await expect.poll(async () => (await lms(page)).state).toBe('terminated');
  s = await lms(page);
  expect(s.data['cmi.core.session_time']).toMatch(/^\d{4}:\d{2}:\d{2}\.\d{2}$/);
  expect(s.log[0]![0]).toBe('Initialize');
  expect(s.log.at(-1)![0]).toBe('Terminate');
  expect(s.errors).toEqual([]);
});

test('SCORM 2004: completion, success and scaled score; a failed attempt reports failed', async ({
  page,
}) => {
  // A passing attempt.
  let course = await launch(page, 'scorm2004', 'item-aed-floor-2');
  await runAedModule(page, course);
  let s = await lms(page);
  expect(s.version).toBe('2004');
  expect(s.committed).toMatchObject({
    'cmi.completion_status': 'completed',
    'cmi.success_status': 'passed',
    'cmi.score.scaled': '1.00',
    'cmi.score.raw': '100',
  });
  await page.getByRole('button', { name: 'Exit course' }).click();
  await expect.poll(async () => (await lms(page)).state).toBe('terminated');
  s = await lms(page);
  expect(s.data['cmi.session_time']).toMatch(/^PT(\d+H)?(\d+M)?[\d.]+S$/);
  expect(s.data['cmi.exit']).toBe('normal');
  expect(s.errors).toEqual([]);

  // A failing attempt in a fresh LMS session: skip the only scored step.
  course = await launch(page, 'scorm2004', 'item-office-hazards');
  const panel = course.locator('.evx-training');
  await expect(panel).toHaveAccessibleName('Training: Hazard hunt: open office');
  await panel.locator('[data-training="skip"]').click();
  const checklist = course.getByRole('dialog', { name: 'Checklist: Hazard hunt: open office' });
  await checklist.getByRole('checkbox').check();
  await checklist.getByRole('button', { name: 'Finish' }).click();
  await expect(course.getByRole('dialog', { name: /^Results/ })).toContainText('(0 %)');
  s = await lms(page);
  expect(s.committed).toMatchObject({
    'cmi.completion_status': 'completed',
    'cmi.success_status': 'failed',
    'cmi.score.scaled': '0.00',
  });
  expect(s.errors).toEqual([]);
});

test('the SCO runs offline under its own strict CSP and opens as the module’s audience', async ({
  page,
}) => {
  const course = await launch(page, 'scorm12', 'item-contractor-orientation');
  await expect(course.locator('.evx-training')).toHaveAccessibleName(
    'Training: Contractor orientation',
  );
  const csp = await course
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect((await lms(page)).errors).toEqual([]);
});
