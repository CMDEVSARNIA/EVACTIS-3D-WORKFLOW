import { test, expect } from './offline';

/**
 * Drop-down lists are drawn by the system with the options' colours. With the
 * see-through field colour, Windows showed dark-mode options as white text on its own
 * light list, readable only under the hover highlight. Options must have an opaque
 * background and readable text in both themes.
 */
const STUDIO = 'http://127.0.0.1:4178/index.html';

const options = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const root = document.querySelector('.evx-chrome')!;
    const select = document.createElement('select');
    select.className = 'evx-field';
    select.innerHTML =
      '<option>Ground floor</option><optgroup label="Level 2"><option>East</option></optgroup>';
    root.append(select);
    const rgb = (c: string) => c.match(/[\d.]+/g)!.map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const out = [...select.querySelectorAll('option, optgroup')].map((el) => {
      const s = getComputedStyle(el);
      const bg = rgb(s.backgroundColor);
      const fg = rgb(s.color);
      const [a, b] = [lum(bg), lum(fg)].sort((x, y) => y - x);
      return { alpha: bg.length > 3 ? bg[3]! : 1, contrast: (a! + 0.05) / (b! + 0.05) };
    });
    select.remove();
    return out;
  });

test('drop-down options are opaque and readable in both themes', async ({ page }) => {
  await page.goto(STUDIO);
  for (const theme of ['dark', 'light']) {
    await expect(page.locator('.evx-chrome')).toHaveAttribute('data-theme', theme);
    for (const o of await options(page)) {
      expect(o.alpha, `${theme}: option background is opaque`).toBe(1);
      expect(o.contrast, `${theme}: option text contrast`).toBeGreaterThanOrEqual(4.5);
    }
    if (theme === 'dark') await page.getByRole('button', { name: 'Switch light/dark' }).click();
  }
});
