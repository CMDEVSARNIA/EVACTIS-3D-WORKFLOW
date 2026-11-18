import { test, expect } from './offline';

/**
 * The Viewer's information, plan and menu panels are modal dialogs, which the browser
 * centres with margin: auto. Studio's page reset (Tailwind) sets every margin to 0, so in
 * Studio's preview they opened in the top-left corner of the window. They must stay
 * centred whatever the host page does.
 */
const STUDIO = 'http://127.0.0.1:4178/index.html';

test.use({ viewport: { width: 1440, height: 900 } });

test('Viewer dialogs open centred inside Studio', async ({ page }) => {
  await page.goto(STUDIO);
  for (const kind of ['', 'evx-viewer__dialog--plan', 'evx-viewer__dialog--menu']) {
    const box = await page.evaluate((extra) => {
      const d = document.createElement('dialog');
      d.className = `evx-viewer__dialog ${extra}`.trim();
      d.innerHTML =
        '<h2 class="evx-viewer__dialog-title">AED station</h2><p>This is an AED station</p>';
      document.querySelector('.evx-chrome')!.append(d);
      d.showModal();
      const r = d.getBoundingClientRect();
      d.close();
      d.remove();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }, kind);
    const label = kind || 'information dialog';
    expect(Math.abs(box.left - (1440 - box.width) / 2), `${label}: centred across`).toBeLessThan(2);
    expect(Math.abs(box.top - (900 - box.height) / 2), `${label}: centred down`).toBeLessThan(2);
  }
});
