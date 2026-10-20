import type { Locator, Page } from '@playwright/test';
import { contrastProblems } from './contrast';
import { test, expect } from './offline';

/**
 * Phase 7, Studio side: in the demo facility an author designs the skin on the real
 * Viewer at device size — a side toolbar on tablet (inherited by phone), an element
 * dragged in the preview, toolbar buttons chosen, a theme colour changed (and an
 * illegible one refused), the client's logo added next to Evactis — then checks the
 * kiosk layout and returns to the Evactis default. Every change lands in the document.
 */
const STUDIO = 'http://127.0.0.1:4179/index.html';

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

interface Placement {
  anchor?: string;
  x?: number;
  y?: number;
  orientation?: string;
  buttons?: string[];
}
interface Saved {
  skin?: {
    tokens: Record<string, string>;
    elements: { id: string; layout: Record<string, Placement | undefined> }[];
  };
  settings: { branding: { coBrand: boolean; clientLogo?: string; clientName?: { en?: string } } };
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
const layout = (doc: Saved, id: string) => doc.skin!.elements.find((e) => e.id === id)!.layout;

async function device(page: Page, name: string, bp: string): Promise<Locator> {
  await page.getByRole('radiogroup', { name: 'Screen' }).getByRole('radio', { name }).click();
  const frame = page.locator('.evx-skin-preview__frame');
  await expect(frame).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(frame).toHaveAttribute('data-breakpoint', bp);
  return frame;
}

/** Toolbar button boxes in the preview. */
const toolbar = (frame: Locator) =>
  frame.locator('.evx-skin__toolbar .evx-btn').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { command: (e as HTMLElement).dataset.command!, x: r.x, y: r.y };
    }),
  );

test('designs the skin per screen on the real Viewer, with co-branding', async ({ page }) => {
  await page.goto(STUDIO);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByTestId('project-name')).toHaveText('Evactis Demo Centre');
  await page.getByRole('tab', { name: 'Skin' }).click();
  savesSeen = await page.evaluate(() => window.__evxMemory!.saves);
  const inspector = page.getByRole('complementary', { name: 'Skin' });

  // ---------------------------------------------------------------- desktop default
  let frame = await device(page, 'Desktop 1440', 'desktop');
  await expect(frame.locator('.evx-skin__heading')).toHaveText('Main lobby');
  await expect(inspector.getByTestId('skin-layout-note')).toContainText('Layout on desktop');
  expect(await contrastProblems(page, '[role="tabpanel"]'), 'skin tab').toEqual([]);

  // ---------------------------------------------------------------- side toolbar on tablet
  frame = await device(page, 'Tablet 768', 'tablet');
  // The default skin already adjusts the toolbar for tablets; the radar inherits.
  await expect(inspector.getByTestId('skin-layout-note')).toContainText('Changed for this screen');
  const list = page.getByRole('navigation', { name: 'Skin' });
  await list.getByRole('button', { name: 'Radar (floor plan)' }).click();
  await expect(inspector.getByTestId('skin-layout-note')).toContainText('Same as on desktop');
  await list.getByRole('button', { name: 'Toolbar' }).click();
  await inspector.getByRole('radio', { name: 'Right', exact: true }).click();
  await inspector.getByRole('radio', { name: 'Column' }).click();
  let doc = await settled(page);
  expect(layout(doc, 'toolbar').tablet).toMatchObject({ anchor: 'right', orientation: 'vertical' });
  expect(layout(doc, 'toolbar').desktop).toMatchObject({ anchor: 'bottom' });
  await expect(inspector.getByTestId('skin-layout-note')).toContainText('Changed for this screen');
  await expect
    .poll(async () => new Set((await toolbar(frame)).map((b) => Math.round(b.x))).size)
    .toBe(1);
  const column = await toolbar(frame);
  expect(column.length).toBeGreaterThan(5);
  const frameBox = (await frame.boundingBox())!;
  expect(column[0]!.x).toBeGreaterThan(frameBox.x + frameBox.width * 0.8);

  // Phone inherits the side toolbar from tablet.
  frame = await device(page, 'Phone 375', 'phone');
  await expect(inspector.getByTestId('skin-layout-note')).toContainText('Layout on phone');
  await expect
    .poll(async () => new Set((await toolbar(frame)).map((b) => Math.round(b.x))).size)
    .toBe(1);
  await page.screenshot({ path: test.info().outputPath('studio-skin-phone.png') });

  // ---------------------------------------------------------------- drag the logo on desktop
  frame = await device(page, 'Desktop 1440', 'desktop');
  const logoBox = frame.locator('.evx-skin-preview__box[data-element="logo"]');
  const lb = (await logoBox.boundingBox())!;
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width / 2 + 30, lb.y + lb.height / 2 + 15, { steps: 5 });
  await page.mouse.up();
  await expect(logoBox).toHaveAttribute('aria-pressed', 'true');
  doc = await settled(page);
  // 30 screen px in a preview scaled below 1: more than 30 device px.
  expect(layout(doc, 'logo').desktop!.x).toBeGreaterThan(16 + 30);
  expect(layout(doc, 'logo').desktop!.y).toBeGreaterThan(16 + 15);
  // Arrow keys nudge the selected element.
  const before = layout(doc, 'logo').desktop!.x!;
  await logoBox.focus();
  await page.keyboard.press('ArrowLeft');
  doc = await settled(page);
  expect(layout(doc, 'logo').desktop!.x).toBe(before - 4);

  // ---------------------------------------------------------------- toolbar buttons
  await page
    .getByRole('navigation', { name: 'Skin' })
    .getByRole('button', { name: 'Toolbar' })
    .click();
  await expect(inspector.getByRole('checkbox', { name: 'Menu' })).toBeDisabled();
  await inspector.getByRole('checkbox', { name: 'Full screen' }).uncheck();
  await inspector.getByRole('button', { name: 'Move Help earlier' }).click();
  doc = await settled(page);
  const buttons = layout(doc, 'toolbar').desktop!.buttons!;
  expect(buttons).not.toContain('fullscreen');
  expect(buttons.indexOf('help')).toBeLessThan(buttons.indexOf('info'));
  await expect
    .poll(async () => (await toolbar(frame)).map((b) => b.command))
    .toEqual(buttons.filter((b) => b !== 'vr'));

  // ---------------------------------------------------------------- theme
  await page
    .getByRole('navigation', { name: 'Skin' })
    .getByRole('button', { name: 'Theme colours' })
    .click();
  await inspector.getByLabel('Buttons and panels').fill('#1e4d2b');
  doc = await settled(page);
  expect(doc.skin!.tokens['--evx-navy']).toBe('#1E4D2B');
  await expect
    .poll(() =>
      frame
        .locator('.evx-skin__toolbar .evx-btn')
        .first()
        .evaluate((e) => getComputedStyle(e).backgroundColor),
    )
    .toBe('rgb(30, 77, 43)');
  // A pale face would hide the white icons: refused, with the reason.
  await inspector.getByLabel('Buttons and panels').fill('#dddddd');
  await expect(inspector.getByRole('alert')).toContainText('Not applied');
  await expect(inspector.getByRole('alert')).toContainText('icons and text on buttons');
  await expect(inspector.getByLabel('Buttons and panels')).toHaveValue('#1e4d2b');
  await expect(inspector.getByTestId('skin-contrast').locator('[data-ok="false"]')).toHaveCount(0);

  // ---------------------------------------------------------------- co-branding
  await page
    .getByRole('navigation', { name: 'Skin' })
    .getByRole('button', { name: 'Co-branding' })
    .click();
  await inspector.getByRole('button', { name: 'Choose a logo…' }).click();
  await expect(inspector.getByTestId('client-logo')).toBeVisible();
  await inspector.getByLabel('Client name (English)').fill('Acme Plant');
  doc = await settled(page);
  expect(doc.settings.branding).toMatchObject({ coBrand: true, clientName: { en: 'Acme Plant' } });
  // The original PNG, so its transparency survives.
  expect(doc.settings.branding.clientLogo).toMatch(/^media\/.+\.png$/);
  const clientImg = frame.locator('.evx-skin__logo img');
  await expect(clientImg).toHaveAttribute('alt', 'Acme Plant');
  await expect.poll(() => clientImg.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(800);
  expect(await contrastProblems(page, '[role="tabpanel"]'), 'co-branding').toEqual([]);

  // ---------------------------------------------------------------- kiosk
  frame = await device(page, 'Kiosk 1080p', 'kiosk');
  const kiosk = (await toolbar(frame)).map((b) => b.command);
  expect(kiosk).toEqual(expect.arrayContaining(['menu', 'evac-route', 'floor-plan']));
  expect(kiosk).not.toContain('fullscreen');
  await page.screenshot({ path: test.info().outputPath('studio-skin-kiosk.png') });

  // "Try it": clicks reach the Viewer.
  await page.getByRole('button', { name: 'Try it' }).click();
  await expect(frame.locator('.evx-skin-preview__box')).toHaveCount(0);
  await frame.getByRole('button', { name: 'Next' }).click();
  await expect(frame.locator('.evx-skin__heading')).toHaveText('East corridor');
  await page.getByRole('button', { name: 'Try it' }).click();

  // ---------------------------------------------------------------- back to the default
  await page
    .getByRole('navigation', { name: 'Skin' })
    .getByRole('button', { name: 'Theme colours' })
    .click();
  await inspector.getByRole('button', { name: 'Back to the Evactis default' }).click();
  doc = await settled(page);
  expect(doc.skin).toBeUndefined();
  await expect(inspector.getByText('uses the Evactis default skin')).toBeVisible();
  // Undo brings the design back.
  await page.getByRole('button', { name: 'Undo' }).click();
  doc = await settled(page);
  expect(doc.skin!.tokens['--evx-navy']).toBe('#1E4D2B');
});
