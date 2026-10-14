import { PNG } from 'pngjs';
import { test, expect } from './offline';

/**
 * The kit must stay legible over bright and dark panoramas. For each backdrop we
 * keep a visual snapshot for review and measure, from real rendered pixels, that
 * every icon and indicator stands out from its own button face (so no backdrop
 * can bleed through and wash a control out).
 */
const BACKDROPS = ['gradient', 'bright', 'dark', 'busy'] as const;

function lum([r, g, b]: number[]): number {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r!) + 0.7152 * c(g!) + 0.0722 * c(b!);
}
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

test.use({ viewport: { width: 1200, height: 760 } });

for (const bg of BACKDROPS) {
  test(`kit over "${bg}" backdrop`, async ({ page }) => {
    await page.goto(`/legibility.html?bg=${bg}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`legibility-${bg}.png`);

    const shot = PNG.sync.read(await page.screenshot());
    const px = (x: number, y: number) => {
      const i = (Math.round(y) * shot.width + Math.round(x)) * 4;
      return [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!];
    };
    for (const b of await page.locator('.evx-btn').all()) {
      const box = (await b.boundingBox())!;
      const id = await b.getAttribute('data-testid');
      // Face colour: just inside the top-left corner radius.
      const face = lum(px(box.x + box.width * 0.2, box.y + box.height * 0.12));
      // Brightest/most distinct pixel in the icon area.
      let best = 1;
      for (let y = box.y + box.height * 0.2; y < box.y + box.height * 0.7; y += 1)
        for (let x = box.x + box.width * 0.25; x < box.x + box.width * 0.75; x += 1)
          best = Math.max(best, ratio(lum(px(x, y)), face));
      // WCAG 1.4.11 non-text contrast (3:1). White on the green "active" face is 3.6:1,
      // so this is the binding case; the navy states are ≈13:1.
      expect(best, `${id} icon vs face over ${bg}`).toBeGreaterThanOrEqual(3);
      // Indicator bar vs face.
      const bar = (await b.locator('.evx-btn__bar').boundingBox())!;
      const barLum = lum(px(bar.x + bar.width / 2, bar.y + bar.height / 2));
      expect(ratio(barLum, face), `${id} indicator vs face over ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
}
