import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { contrastProblems } from './contrast';
import { test, expect } from './offline';

/**
 * Phase 5 acceptance, Studio side: in the demo facility, equipment selected in the list,
 * the scene or the plan is selected in the other views; an item is placed in a scene and
 * on the plan and confirmed; a route is drawn on the plan, given its scenes and walking
 * directions, confirmed, and animates in the preview; the package is locked to an
 * audience; evacuation plans print at letter and tabloid size (bilingual, dated, with a
 * "verify on site" note and legible text) and the register exports as XLSX, CSV and PDF.
 *
 * Studio runs as its browser test build (in-memory backend); the project is the seeded
 * demo facility (e2e/fixtures/studio-demo.mjs). The Viewer side (audience layers, route
 * animation in the delivered player) is e2e/viewer-safety.spec.ts.
 */
const STUDIO = 'http://127.0.0.1:4179/index.html';

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(180_000);

interface Saved {
  equipment: {
    id: string;
    tag?: string;
    floorId: string;
    planPosition?: { x: number; y: number };
    placements: { sceneId: string }[];
    confirmed?: { by: string };
  }[];
  routes: {
    id: string;
    name: { en: string };
    priority: string;
    assemblyPointId: string;
    segments: { floorId: string; points: unknown[] }[];
    sceneSequence: string[];
    starts: { sceneId: string }[];
    confirmed?: { by: string };
  }[];
  settings: { lockAudience: boolean; defaultAudienceId?: string };
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

const plan = (page: Page) => page.getByTestId('safety-plan');
async function clickPlan(page: Page, fx: number, fy: number) {
  const box = (await plan(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/** Exported files from the in-memory backend, written to the test's output folder. */
async function exported(page: Page, file: (name: string) => string): Promise<Map<string, string>> {
  const all: [string, string][] = await page.evaluate(() =>
    [...window.__evxMemory!.exports].map(([path, bytes]) => {
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return [path, btoa(bin)] as [string, string];
    }),
  );
  const out = new Map<string, string>();
  for (const [path, b64] of all) {
    const local = file(path.replace(/^.*\//, ''));
    writeFileSync(local, Buffer.from(b64, 'base64'));
    out.set(path.replace(/^.*\//, ''), local);
  }
  return out;
}
const run = (cmd: string, ...args: string[]) => execFileSync(cmd, args, { encoding: 'utf8' });

/** Smallest word height (pt) on the page, from poppler's word boxes. */
function smallestWord(pdf: string): number {
  const html = run('pdftotext', '-bbox', pdf, '-');
  let min = Infinity;
  for (const m of html.matchAll(/yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]+)</g))
    if (/\w/.test(m[3]!)) min = Math.min(min, Number(m[2]) - Number(m[1]));
  return min;
}

const selected = (l: Locator) => expect(l).toHaveAttribute('aria-current', 'true');

test('places, routes, locks and prints the demo facility safety layer in Studio', async ({
  page,
}, info) => {
  await page.goto(STUDIO);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByTestId('project-name')).toHaveText('Evactis Demo Centre');
  await page.getByRole('tab', { name: 'Safety' }).click();
  await expect(plan(page)).toBeVisible();

  // ---------------------------------------------------------------- selection sync
  const list = (id: string) => page.locator(`.evx-editor__scenes [data-equipment-id="${id}"]`);
  const onPlan = (id: string) => plan(page).locator(`[data-equipment-id="${id}"]`);
  const inScene = (id: string) =>
    page.locator(`.evx-viewer__hotspot[data-hotspot-id="equipment:${id}"]`);

  // Plan → list and scene.
  await onPlan('fe-101').click();
  await selected(list('fe-101'));
  await expect(onPlan('fe-101')).toHaveAttribute('aria-pressed', 'true');
  await expect(inScene('fe-101')).toHaveClass(/evx-viewer__hotspot--selected/);
  await expect(page.getByTestId('equipment-inspector').getByLabel('Tag (e.g. FE-101)')).toHaveValue(
    'FE-101',
  );

  // Scene → list and plan.
  await inScene('fa-101').dispatchEvent('click');
  await selected(list('fa-101'));
  await expect(onPlan('fa-101')).toHaveAttribute('aria-pressed', 'true');
  await expect(onPlan('fe-101')).toHaveAttribute('aria-pressed', 'false');

  // List (an item in another scene and on another floor) → preview and plan follow.
  await list('fak-201').click();
  await expect(plan(page)).toHaveAttribute('data-floor-id', 'f2');
  await expect(onPlan('fak-201')).toHaveAttribute('aria-pressed', 'true');
  await expect(inScene('fak-201')).toHaveClass(/evx-viewer__hotspot--selected/);

  // ---------------------------------------------------------------- place a new item
  await page.getByRole('combobox', { name: 'Floor' }).first().selectOption('f1');
  await page.getByRole('combobox', { name: 'Scene' }).first().selectOption('lobby');
  savesSeen = await page.evaluate(() => window.__evxMemory!.saves);
  await page.getByRole('combobox', { name: 'Add equipment' }).selectOption('fire-extinguisher');
  const inspector = page.getByTestId('equipment-inspector');
  await expect(inspector).toBeVisible();
  await inspector.getByLabel('Tag (e.g. FE-101)').fill('FE-104');
  await expect(page.getByRole('radio', { name: 'Place in scene' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const preview = (await page.getByTestId('preview').boundingBox())!;
  await page.mouse.click(preview.x + preview.width * 0.3, preview.y + preview.height * 0.55);
  await expect(inspector.getByTestId('placements').getByRole('listitem')).toHaveCount(1);
  await page.getByRole('radio', { name: 'Place on plan' }).click();
  await clickPlan(page, 0.33, 0.55);
  await expect(inspector.getByTestId('plan-status')).toHaveText('On the plan: Placed');
  await expect(inspector.getByTestId('not-confirmed')).toBeVisible();
  await inspector.getByLabel('Your name (recorded with each confirmation)').fill('A. Tester');
  await inspector.getByRole('button', { name: 'Confirm on site details' }).click();
  await expect(inspector.getByTestId('confirmed')).toHaveText(/^Confirmed by A\. Tester on /);
  let doc = await settled(page);
  const added = doc.equipment.find((e) => e.tag === 'FE-104')!;
  expect(added).toMatchObject({ floorId: 'f1', placements: [{ sceneId: 'lobby' }] });
  expect(added.planPosition).toBeDefined();
  expect(added.confirmed?.by).toBe('A. Tester');
  await expect(onPlan(added.id)).toBeVisible();
  await expect(inScene(added.id)).toBeVisible();

  // Moving it on the plan withdraws the confirmation (it must be checked again).
  await clickPlan(page, 0.34, 0.56);
  await expect(inspector.getByTestId('not-confirmed')).toBeVisible();
  await inspector.getByRole('button', { name: 'Confirm on site details' }).click();
  await expect(inspector.getByTestId('confirmed')).toBeVisible();

  expect(await contrastProblems(page, '[role="tabpanel"]'), 'equipment').toEqual([]);

  // ---------------------------------------------------------------- draw a route
  await page.getByRole('radio', { name: 'Routes' }).click();
  await page.getByRole('button', { name: 'New route' }).click();
  const form = page.getByTestId('new-route');
  await form.getByLabel('Route name (English)').fill('Lobby to the lawn');
  await form.getByLabel('Route name (French)').fill('Du hall à la pelouse');
  await form.getByLabel('Priority').selectOption('secondary');
  await form.getByRole('button', { name: 'Draw a line' }).click();
  await expect(page.getByTestId('draw-hint')).toHaveText(/^Click on the plan to start/);
  // Lobby (0, 0) straight south to assembly point A (0, 20): plan pixels (480, 1200) →
  // (480, 2000) on a 1280 × 2240 plan.
  await clickPlan(page, 480 / 1280, 1200 / 2240);
  await clickPlan(page, 480 / 1280, 1600 / 2240);
  await clickPlan(page, 480 / 1280, 2000 / 2240);
  await expect(page.getByTestId('draw-hint')).toHaveText(/3 so far/);
  await page.getByRole('button', { name: 'Create route' }).click();
  const routeInspector = page.getByTestId('route-inspector');
  await expect(routeInspector).toBeVisible();
  await expect(routeInspector.getByTestId('route-lines')).toHaveText(/Ground floor · 3 points/);

  // Scenes come from the drawing only when the author applies them.
  await expect(routeInspector.getByTestId('suggested-scenes')).toContainText(
    'Main lobby → Assembly point',
  );
  await routeInspector.getByRole('button', { name: 'Use these scenes' }).click();
  await expect(routeInspector.getByTestId('route-scenes').getByRole('listitem')).toHaveCount(2);
  await routeInspector.getByRole('button', { name: 'Set all directions from the drawing' }).click();
  await expect(routeInspector.getByTestId('route-scenes')).not.toContainText('not set');
  await expect(routeInspector.getByTestId('not-confirmed')).toBeVisible();
  await routeInspector.getByRole('button', { name: 'Confirm on site details' }).click();
  doc = await settled(page);
  const drawn = doc.routes.find((r) => r.name.en === 'Lobby to the lawn')!;
  expect(drawn).toMatchObject({
    priority: 'secondary',
    assemblyPointId: 'ap-a',
    sceneSequence: ['lobby', 'assembly'],
    confirmed: { by: 'A. Tester' },
  });
  expect(drawn.segments).toEqual([{ floorId: 'f1', points: expect.any(Array) }]);
  expect(drawn.starts.map((s) => s.sceneId)).toEqual(['lobby', 'assembly']);

  // The preview shows the route the way the Viewer will: chevrons along it.
  const arrows = page.locator(`.evx-viewer__route-arrows[data-route-id="${drawn.id}"]`);
  await expect(arrows).toBeVisible();
  await expect(arrows.locator('> *')).not.toHaveCount(0);
  await expect(plan(page).locator(`polyline[data-route-id="${drawn.id}"]`)).toHaveClass(
    /evx-safety-plan__route--on/,
  );
  await page.screenshot({ path: info.outputPath('studio-safety-route.png') });
  expect(await contrastProblems(page, '[role="tabpanel"]'), 'routes').toEqual([]);

  // ---------------------------------------------------------------- audience lock
  await page.getByRole('radio', { name: 'Audiences' }).click();
  const pkg = page.getByTestId('package-inspector');
  await pkg.getByLabel('Default audience').selectOption('first-responders');
  await pkg.getByLabel('Lock the delivered package to this audience').check();
  doc = await settled(page);
  expect(doc.settings).toMatchObject({ lockAudience: true, defaultAudienceId: 'first-responders' });
  await pkg.getByLabel('Lock the delivered package to this audience').uncheck();
  await pkg.getByLabel('Default audience').selectOption('staff');
  await settled(page);

  // ---------------------------------------------------------------- print
  await page.getByRole('button', { name: 'Print evacuation plans…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Print evacuation plans' })).toBeVisible();
  expect(await contrastProblems(page, '[role="dialog"]'), 'print dialog').toEqual([]);
  for (const paper of ['Letter (8.5 × 11 in)', 'Tabloid (11 × 17 in)']) {
    await dialog.getByLabel(paper).check();
    await dialog.getByRole('button', { name: 'Choose folder and print' }).click();
    // Two floors, each with one posting: 2 plans + 2 "You are here" sheets.
    await expect(dialog.getByRole('status')).toHaveText('4 PDF file(s) saved.', {
      timeout: 60_000,
    });
  }
  await dialog.getByRole('button', { name: 'Close' }).click();

  const files = await exported(page, (n) => info.outputPath(n));
  const pdfs = [...files.keys()].filter((n) => n.startsWith('Evacuation plan'));
  expect(pdfs).toHaveLength(8);
  for (const name of pdfs) {
    const pdf = files.get(name)!;
    const tabloid = name.endsWith('tabloid.pdf');
    expect(run('pdfinfo', pdf), name).toMatch(tabloid ? /792 x 1224 pts/ : /612 x 792 pts/);
    const text = run('pdftotext', '-layout', pdf, '-');
    for (const s of [
      'EVACUATION PLAN',
      'PLAN D’ÉVACUATION',
      'Verify on site before relying on this plan. Printed ',
      'Vérifiez sur place avant de vous fier à ce plan. Imprimé le ',
      'LEGEND',
      'LÉGENDE',
    ])
      expect(text, `${name}: ${s}`).toContain(s);
    if (name.includes('Main lobby') || name.includes('Open office'))
      expect(text, name).toContain('YOU ARE HERE');
    // Legible: no word smaller than 8 pt on letter; tabloid scales everything up.
    expect(smallestWord(pdf), name).toBeGreaterThanOrEqual(tabloid ? 10 : 8);
  }
  // The new item and the drawn route are on the ground floor plan; legend lists both.
  const ground = run(
    'pdftotext',
    '-layout',
    files.get(pdfs.find((n) => /Ground floor - letter/.test(n))!)!,
    '-',
  );
  expect(ground).toContain('Alternative route');
  expect(ground).toContain('Fire extinguisher');
  // A rendered page for review (attached to the report).
  run(
    'pdftoppm',
    '-png',
    '-r',
    '60',
    '-singlefile',
    files.get(pdfs.find((n) => /Main lobby.* - letter/.test(n))!)!,
    info.outputPath('plan-letter'),
  );
  await info.attach('plan-letter', {
    path: info.outputPath('plan-letter.png'),
    contentType: 'image/png',
  });

  // ---------------------------------------------------------------- register
  await page.getByRole('button', { name: 'Export equipment register…' }).click();
  for (const format of ['Excel workbook (XLSX)', 'CSV (spreadsheet text)', 'PDF table']) {
    await dialog.getByLabel(format).check();
    await dialog.getByRole('button', { name: 'Save register' }).click();
    await expect(dialog.getByRole('status')).toHaveText(
      /^Saved: \/e2e\/exports\/Equipment register\./,
    );
  }
  await dialog.getByRole('button', { name: 'Close' }).click();
  const all = await exported(page, (n) => info.outputPath(n));
  const csv = readFileSync(all.get('Equipment register.csv')!, 'utf8');
  const fe104 = csv.split('\r\n').find((l) => l.includes('FE-104'));
  expect(fe104, 'register lists the new item').toBeDefined();
  expect(fe104).toContain('Ground floor');
  expect(fe104).toContain('index.html?scene=lobby');
  expect(run('unzip', '-l', all.get('Equipment register.xlsx')!)).toContain(
    'xl/worksheets/sheet1.xml',
  );
  expect(run('pdftotext', '-layout', all.get('Equipment register.pdf')!, '-')).toContain('FE-104');
});
