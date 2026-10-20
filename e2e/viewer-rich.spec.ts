import type { Page } from '@playwright/test';
import { test, expect } from './offline';
import { chooseInMenu, idle, openDemo, sceneId } from './viewer-helpers';

/**
 * Phase 6 rich features in the demo facility, network blocked: live layers (smoke
 * conditions), animated regions, adaptive HDR, 360° video with timed hotspots, spatial
 * audio with captions, the floor-plan radar, photo albums and the local PDF reader.
 */

/** Mean brightness and contrast (std dev) of the panorama canvas, ignoring overlays. */
async function canvasStats(page: Page) {
  // The panorama only: the skin's plates and buttons would add their own contrast.
  await page.evaluate(() =>
    document.querySelector<HTMLElement>('.evx-skin')?.style.setProperty('visibility', 'hidden'),
  );
  const shot = await page.locator('.evx-viewer__canvas').screenshot();
  await page.evaluate(() =>
    document.querySelector<HTMLElement>('.evx-skin')?.style.removeProperty('visibility'),
  );
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 90;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, 160, 90);
    const d = ctx.getImageData(0, 0, 160, 90).data;
    let sum = 0;
    let sq = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
      sum += y;
      sq += y * y;
    }
    const mean = sum / n;
    return { mean, contrast: Math.sqrt(sq / n - mean * mean) };
  }, shot.toString('base64'));
}

const hotspotIds = (page: Page) =>
  page
    .locator('.evx-viewer__hotspot')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.hotspotId!));

test('smoke conditions: a live layer hazes every indoor scene and is announced', async ({
  page,
}) => {
  await openDemo(page, '?scene=corridor');
  const clear = await canvasStats(page);
  await chooseInMenu(page, 'Conditions', 'smoke');
  await expect(page.locator('.evx-viewer__live')).toHaveText('Conditions: Smoke');
  await idle(page);
  const smoke = await canvasStats(page);
  // Less contrast (things fade into the smoke) and dimmer.
  expect(smoke.contrast).toBeLessThan(clear.contrast * 0.6);
  expect(smoke.mean).toBeLessThan(clear.mean);
  // The state holds across scenes, and back to normal restores the picture.
  await page.evaluate(() => window.viewer.goToScene('lobby', { transition: { kind: 'cut' } }));
  await idle(page);
  expect(await page.evaluate(() => window.viewer.liveLayers)).toEqual([
    { layerId: 'conditions', stateId: 'smoke' },
  ]);
  await page.evaluate(() => window.viewer.goToScene('corridor', { transition: { kind: 'cut' } }));
  await chooseInMenu(page, 'Conditions', 'normal');
  await idle(page);
  const back = await canvasStats(page);
  expect(Math.abs(back.contrast - clear.contrast)).toBeLessThan(1);
});

test('adaptive HDR: the office darkens towards its windows and brightens into shadow', async ({
  page,
}) => {
  await openDemo(page, '?scene=office&reduced-motion');
  const adapt = () => page.evaluate(() => window.viewer.exposureAdaptation);
  await page.evaluate(() => window.viewer.setView({ yaw: 90, pitch: 0, fov: 50 }));
  await expect.poll(adapt).toBeLessThan(-0.3);
  await page.evaluate(() => window.viewer.setView({ yaw: -90, pitch: -45, fov: 60 }));
  await expect.poll(adapt).toBeGreaterThan(0.5);
  // Scenes not captured in HDR do not adapt.
  await page.evaluate(() => window.viewer.goToScene('stairwell', { transition: { kind: 'cut' } }));
  await expect.poll(adapt).toBe(0);
});

test('spatial audio: the alarm comes from its panel, pans as the reader turns, and is captioned', async ({
  page,
}) => {
  await openDemo(page);
  // The alarm is on the north wall, right of straight ahead.
  await page.evaluate(() => window.viewer.setView({ yaw: 0, pitch: 0, fov: 90 }));
  await page.getByRole('button', { name: 'Sound the alarm (drill)' }).click();
  const sound = () => page.evaluate(() => window.viewer.soundStates[0]);
  await expect.poll(async () => (await sound())?.playing).toBe(true);
  const ahead = (await sound())!;
  expect(ahead.pan).toBeGreaterThan(0.2);
  const caption = page.locator('.evx-viewer__caption');
  await expect(caption).toHaveText('Sound: Fire alarm (ahead)');

  // Facing south, the alarm is behind: quieter, and now on the left.
  await page.evaluate(() => window.viewer.setView({ yaw: 180 }));
  await expect.poll(async () => (await sound())!.pan).toBeLessThan(0);
  expect((await sound())!.gain).toBeLessThan(ahead.gain);
  await expect(caption).toHaveText('Sound: Fire alarm (behind you)');

  // The strobe region flashes while the alarm sounds.
  expect(await page.evaluate(() => window.viewer.regions)).toEqual(['lobby-strobe']);

  // Silencing stops the sound, hides the caption and the strobe.
  await page.evaluate(() => window.viewer.setView({ yaw: 0 }));
  await page.getByRole('button', { name: 'Silence the alarm' }).click();
  await expect(caption).toBeHidden();
  expect(await page.evaluate(() => window.viewer.soundStates)).toEqual([]);
  expect(await page.evaluate(() => window.viewer.regions)).toEqual([]);
});

test('animated region: the strobe changes over time, and holds still with reduced motion', async ({
  page,
}) => {
  // Software WebGL in CI draws a full-size view at a few frames per second: sample the
  // strobe over a few seconds.
  test.setTimeout(120_000);
  const frames = async () => {
    await page.evaluate(() => window.viewer.setVariable('alarmOn', true));
    // Look straight at the strobe and sample its pixels over time (the alarm sign over
    // its centre is hidden meanwhile: the glow is brightest there).
    await page.evaluate(() => {
      const r = window.viewer.environment.animatedRegions[0]!.polygon;
      const yaw = (r[0]!.yaw + r[1]!.yaw) / 2;
      const pitch = (r[0]!.pitch + r[2]!.pitch) / 2;
      window.viewer.setView({ yaw, pitch, fov: 40 });
    });
    await idle(page);
    const at = await page.evaluate(() => {
      const r = window.viewer.environment.animatedRegions[0]!.polygon;
      const yaw = (r[0]!.yaw + r[1]!.yaw) / 2;
      const pitch = (r[0]!.pitch + r[2]!.pitch) / 2;
      return window.viewer.viewToScreen(yaw, pitch)!;
    });
    await page.addStyleTag({ content: '.evx-viewer__hotspots { visibility: hidden }' });
    const seen = new Set<string>();
    // A page clip: an element screenshot would wait for the animating canvas to settle.
    const box = (await page.locator('.evx-viewer__canvas').boundingBox())!;
    const clip = { x: box.x + at.x - 8, y: box.y + at.y - 8, width: 16, height: 16 };
    for (let i = 0; i < 20; i++) {
      const shot = await page.screenshot({ clip, animations: 'allow' });
      seen.add(shot.toString('base64'));
      await page.waitForTimeout(150);
    }
    return seen.size;
  };
  await openDemo(page);
  expect(await frames()).toBeGreaterThan(1);
  await openDemo(page, '?reduced-motion');
  expect(await frames()).toBe(1);
});

test('360° video: plays with its controls, and timed hotspots follow the playback', async ({
  page,
}) => {
  await openDemo(page, '?scene=corridor');
  // Behind the reader: focusing it turns the view to it, as for a keyboard user.
  const watch = page.getByRole('button', { name: 'Watch the fire drill (360° video)' });
  await watch.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => sceneId(page)).toBe('drill');
  const bar = page.getByRole('group', { name: 'Video' });
  await expect(bar).toBeVisible();
  // Paused at the start: the first instruction shows, the second does not yet.
  await expect.poll(() => hotspotIds(page)).toContain('drill-alarm');
  expect(await hotspotIds(page)).not.toContain('drill-exit');

  await bar.getByRole('button', { name: 'Play' }).click();
  await expect(bar.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.viewer.video!.currentTime), { timeout: 10_000 })
    .toBeGreaterThan(0.5);
  await bar.getByRole('button', { name: 'Pause' }).click();

  // Seeking to 5 s: the exit instruction replaces the alarm one.
  await bar.getByRole('slider', { name: 'Video position' }).fill('5');
  await expect.poll(() => hotspotIds(page)).toContain('drill-exit');
  expect(await hotspotIds(page)).not.toContain('drill-alarm');
  await expect(bar).toContainText('0:05 / 0:10');

  // Leaving the video scene hides the controls.
  await page.getByRole('button', { name: 'Back to the corridor' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => sceneId(page)).toBe('corridor');
  await expect(bar).toBeHidden();
});

test('floor-plan radar: shows where the reader is and looks, and its dots navigate', async ({
  page,
}) => {
  await openDemo(page);
  const radar = page.getByRole('navigation', { name: 'Mini floor plan' });
  await expect(radar).toBeVisible();
  await page.evaluate(() => window.viewer.setView({ yaw: 0 }));
  await expect(radar).toHaveAttribute('data-bearing', '0');
  await page.evaluate(() => window.viewer.setView({ yaw: 90 }));
  await expect(radar).toHaveAttribute('data-bearing', '90');
  // Dots for the other ground-floor scenes; pressing one goes there.
  await radar.getByRole('button', { name: 'Go to East corridor' }).click();
  await expect.poll(() => sceneId(page)).toBe('corridor');
  // Scenes not on a plan (the drill video) hide the radar.
  await page.evaluate(() => window.viewer.goToScene('drill', { transition: { kind: 'cut' } }));
  await expect(radar).toBeHidden();
});

test('photo album: one photo at a time with captions, buttons and arrow keys', async ({ page }) => {
  await openDemo(page, '?scene=assembly');
  await page.getByRole('button', { name: 'Photos of the site' }).click();
  const dialog = page.getByRole('dialog', { name: 'Site photos' });
  await expect(dialog.getByText('Photo 1 of 3')).toBeVisible();
  await expect(dialog.getByRole('img')).toHaveAttribute('alt', 'Main entrance, from the lobby');
  await expect
    .poll(() => dialog.getByRole('img').evaluate((i) => (i as HTMLImageElement).naturalWidth))
    .toBe(800);
  await dialog.getByRole('button', { name: /Next/ }).click();
  await expect(dialog.getByText('Photo 2 of 3')).toBeVisible();
  await dialog.locator('figure').press('ArrowRight');
  await expect(dialog.getByText('Photo 3 of 3')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Next/ })).toBeDisabled();
  await dialog.locator('figure').press('ArrowLeft');
  await expect(dialog.getByText('Photo 2 of 3')).toBeVisible();
});

test('PDF reader: opens a packaged document locally, pages through it, zooms', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Emergency procedures (PDF)' }).click();
  const doc = page.getByRole('region', { name: 'Emergency procedures' });
  await expect(doc).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  await expect(doc).toHaveAttribute('data-pages', '2');
  await expect(doc.getByText('Page 1 of 2')).toBeVisible();
  // The page's text is there for screen readers (the canvas is a picture of it).
  await expect(doc.locator('.evx-viewer__pdf-text')).toContainText('EMERGENCY PROCEDURES');
  const canvas = doc.locator('canvas');
  const w1 = (await canvas.boundingBox())!.width;
  expect(w1).toBeGreaterThan(300);
  await doc.getByRole('button', { name: 'Next' }).click();
  await expect(doc.getByText('Page 2 of 2')).toBeVisible();
  await expect(doc.locator('.evx-viewer__pdf-text')).toContainText('PROCÉDURES D’URGENCE');
  await doc.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(w1 * 1.2);
});
