import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { test, expect } from './offline';
import { DEMO, idle, sceneId } from './viewer-helpers';

/**
 * Phase 7 acceptance: the Evactis default skin lays out correctly at 375, 768 and
 * 1440 px and on a 1080p kiosk (landscape and portrait), and stays legible over the
 * gradient (and the other test backdrops), measured from rendered pixels.
 */

const SIZES = [
  { name: 'phone', width: 375, height: 667, query: '', bp: 'phone', minButton: 44 },
  { name: 'tablet', width: 768, height: 1024, query: '', bp: 'tablet', minButton: 44 },
  { name: 'desktop', width: 1440, height: 900, query: '', bp: 'desktop', minButton: 56 },
  { name: 'kiosk', width: 1920, height: 1080, query: '&kiosk', bp: 'kiosk', minButton: 72 },
  {
    name: 'kiosk-portrait',
    width: 1080,
    height: 1920,
    query: '&kiosk',
    bp: 'kiosk',
    minButton: 72,
  },
] as const;

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width - 0.5 &&
  b.x < a.x + a.width - 0.5 &&
  a.y < b.y + b.height - 0.5 &&
  b.y < a.y + a.height - 0.5;

async function open(page: Page, query: string) {
  await page.goto(`${DEMO}?scene=lobby${query}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await idle(page);
  await page.evaluate(() => document.fonts.ready);
}

/** Visible skin parts and their boxes. */
const parts = (page: Page) =>
  page.locator('[data-skin-element]').evaluateAll((els) =>
    els
      .filter((e) => !(e as HTMLElement).hidden && e.getBoundingClientRect().width > 0)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return {
          id: (e as HTMLElement).dataset.skinElement!,
          box: { x: r.x, y: r.y, width: r.width, height: r.height },
        };
      }),
  );

for (const s of SIZES) {
  test.describe(`default skin at ${s.width}×${s.height}`, () => {
    test.use({ viewport: { width: s.width, height: s.height } });

    test('lays out without overlaps, inside the screen, with full-size touch targets', async ({
      page,
    }) => {
      await open(page, s.query);
      await expect(page.locator('.evx-skin')).toHaveAttribute('data-breakpoint', s.bp);
      const visible = await parts(page);
      const ids = visible.map((p) => p.id);
      expect(ids).toEqual(expect.arrayContaining(['logo', 'title', 'toolbar', 'language']));
      if (s.bp === 'phone') expect(ids).not.toContain('radar');
      else expect(ids).toContain('radar');

      for (const p of visible) {
        expect(p.box.x, `${p.id} left`).toBeGreaterThanOrEqual(0);
        expect(p.box.y, `${p.id} top`).toBeGreaterThanOrEqual(0);
        expect(p.box.x + p.box.width, `${p.id} right`).toBeLessThanOrEqual(s.width + 0.5);
        expect(p.box.y + p.box.height, `${p.id} bottom`).toBeLessThanOrEqual(s.height + 0.5);
      }
      for (let i = 0; i < visible.length; i++)
        for (let j = i + 1; j < visible.length; j++)
          expect(
            overlaps(visible[i]!.box, visible[j]!.box),
            `${visible[i]!.id} overlaps ${visible[j]!.id}`,
          ).toBe(false);

      // No sideways scrolling.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        s.width,
      );

      // One row of buttons, every one at least the size the breakpoint asks for.
      const buttons = page.locator('.evx-skin__toolbar .evx-btn');
      const boxes = await buttons.evaluateAll((els) =>
        els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect),
      );
      expect(new Set(boxes.map((b) => Math.round(b.top))).size, 'toolbar rows').toBe(1);
      for (const b of boxes) {
        expect(b.width).toBeGreaterThanOrEqual(s.minButton);
        expect(b.height).toBeGreaterThanOrEqual(s.minButton);
      }
      const commands = await buttons.evaluateAll((els) =>
        els.map((e) => (e as HTMLElement).dataset.command),
      );
      expect(commands).toEqual(expect.arrayContaining(['menu', 'floor-plan', 'evac-route']));
      if (s.bp === 'kiosk') expect(commands).not.toContain('fullscreen');

      // The route banner keeps clear of the chrome.
      await page.getByRole('button', { name: 'Evacuation route' }).click();
      const banner = (await page.locator('.evx-viewer__route').boundingBox())!;
      for (const p of await parts(page))
        expect(overlaps(banner, p.box), `route banner overlaps ${p.id}`).toBe(false);
      await page.getByRole('button', { name: 'Evacuation route' }).click();
      await idle(page);

      await expect(page).toHaveScreenshot(`skin-${s.name}.png`);
    });
  });
}

test.describe('default skin commands', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('toolbar buttons do what they say; info, help and menu panels', async ({ page }) => {
    await open(page, '');
    const bar = page.getByRole('navigation', { name: 'Viewer controls' });
    await expect(page.locator('.evx-skin__heading')).toHaveText('Main lobby');
    await expect(page.locator('.evx-skin__eyebrow')).toHaveText('Ground floor');
    await expect(bar.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await bar.getByRole('button', { name: 'Next' }).click();
    await expect.poll(() => sceneId(page)).toBe('corridor');
    await expect(page.locator('.evx-skin__heading')).toHaveText('East corridor');
    await bar.getByRole('button', { name: 'Home' }).click();
    await expect.poll(() => sceneId(page)).toBe('lobby');

    // Sound toggles (icon and label follow).
    await bar.getByRole('button', { name: 'Sound on' }).click();
    await expect(bar.getByRole('button', { name: 'Sound off' })).toBeVisible();
    expect(await page.evaluate(() => window.viewer.muted)).toBe(true);
    await bar.getByRole('button', { name: 'Sound off' }).click();

    // Info: the offline notice.
    await bar.getByRole('button', { name: 'Information' }).click();
    const info = page.getByRole('dialog', { name: 'Evactis Demo Centre' });
    await expect(info.getByRole('note')).toContainText('runs entirely on this device');
    await info.getByRole('button', { name: 'Close' }).click();

    // Help.
    await bar.getByRole('button', { name: 'Help' }).click();
    const help = page.getByRole('dialog', { name: 'How to use this environment' });
    await expect(help.getByRole('listitem')).toHaveCount(6);
    await help.getByRole('button', { name: 'Close' }).click();

    // Menu: places by floor; choosing one goes there.
    await bar.getByRole('button', { name: 'Menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu.getByRole('button', { name: /Main lobby/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await menu.getByRole('button', { name: 'Open office' }).click();
    await expect.poll(() => sceneId(page)).toBe('office');
    await expect(page.locator('.evx-skin__eyebrow')).toHaveText('Second floor');

    // Language: everything in the chrome switches.
    await page.getByRole('button', { name: 'Français' }).click();
    await expect(page.locator('.evx-skin__heading')).toHaveText('Bureau ouvert');
    await expect(page.getByRole('navigation', { name: 'Commandes du visualiseur' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accueil' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'English' })).toHaveText('EN');
  });

  test('on a phone, buttons without room are in the menu', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await open(page, '');
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const more = page.getByRole('dialog', { name: 'Menu' }).locator('.evx-skin__more');
    for (const label of ['Information', 'Help', 'Sound on', 'Zoom in', 'Zoom out'])
      await expect(more.getByRole('button', { name: label })).toBeVisible();
    await more.getByRole('button', { name: 'Help' }).click();
    await expect(page.getByRole('dialog', { name: 'How to use this environment' })).toBeVisible();
  });
});

// ---------------------------------------------------------------- legibility

function lum([r, g, b]: number[]): number {
  const c = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r!) + 0.7152 * c(g!) + 0.0722 * c(b!);
}
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const parseColor = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);

for (const bg of ['gradient', 'bright', 'dark', 'busy'] as const) {
  for (const size of [SIZES[2], SIZES[0]]) {
    test(`skin stays legible over the "${bg}" backdrop at ${size.width} px`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await open(page, `&bg=${bg}`);
      await expect(page.locator('body')).toHaveAttribute('data-backdrop', bg);
      await expect(page).toHaveScreenshot(`skin-legibility-${bg}-${size.name}.png`);
      const shot = PNG.sync.read(await page.screenshot());
      const px = (x: number, y: number) => {
        const i = (Math.round(y) * shot.width + Math.round(x)) * 4;
        return [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!];
      };

      // Kit buttons: icon and indicator against their own face (WCAG 1.4.11, 3:1).
      for (const b of await page.locator('.evx-skin__toolbar .evx-btn:not(:disabled)').all()) {
        const box = (await b.boundingBox())!;
        const id = await b.getAttribute('data-command');
        const face = lum(px(box.x + box.width * 0.2, box.y + box.height * 0.12));
        let best = 1;
        for (let y = box.y + box.height * 0.2; y < box.y + box.height * 0.7; y += 1)
          for (let x = box.x + box.width * 0.25; x < box.x + box.width * 0.75; x += 1)
            best = Math.max(best, ratio(lum(px(x, y)), face));
        expect(best, `${id} icon over ${bg}`).toBeGreaterThanOrEqual(3);
      }

      // Text: its colour against the backing as rendered over the backdrop, at the
      // backing's four inner corners (the worst one counts).
      for (const sel of ['.evx-skin__eyebrow', '.evx-skin__heading', '.evx-skin__language']) {
        const t = page.locator(sel);
        const {
          color,
          size: fontPx,
          weight,
          backing,
        } = await t.evaluate((e) => {
          const s = getComputedStyle(e);
          const host = (e.closest('.evx-skin__title') ?? e) as HTMLElement;
          const r = host.getBoundingClientRect();
          return {
            color: s.color,
            size: parseFloat(s.fontSize),
            weight: Number(s.fontWeight),
            backing: { x: r.x, y: r.y, width: r.width, height: r.height },
          };
        });
        const fg = lum(parseColor(color));
        const corners = [
          [backing.x + 4, backing.y + 4],
          [backing.x + backing.width - 5, backing.y + 4],
          [backing.x + 4, backing.y + backing.height - 5],
          [backing.x + backing.width - 5, backing.y + backing.height - 5],
        ];
        const worst = Math.min(...corners.map(([x, y]) => ratio(fg, lum(px(x!, y!)))));
        const large = fontPx >= 24 || (fontPx >= 18.66 && weight >= 700);
        expect(worst, `${sel} over ${bg}`).toBeGreaterThanOrEqual(large ? 3 : 4.5);
      }
    });
  }
}
