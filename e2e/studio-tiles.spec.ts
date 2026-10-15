import { PNG } from 'pngjs';
import { test, expect } from './offline';
import { idle } from './viewer-helpers';

/**
 * Studio's Rust tiler (crates/evx-media) and the Viewer must agree on the cube layout.
 * The fixture (e2e/fixtures/studio-tiles.mjs) imports a compass panorama with the real
 * pipeline; here the Viewer looks in each direction and the colour on screen must be
 * the colour painted there — from the full-resolution tiles, not just the preview.
 */
const URL = 'http://127.0.0.1:4177/index.html';

test.use({ viewport: { width: 960, height: 540 } });

test('the Viewer renders tiles made by the Studio pipeline in the right directions', async ({
  page,
}) => {
  const tiles: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/tiles/')) tiles.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(URL);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });

  const centre = async () => {
    const shot = PNG.sync.read(await page.screenshot());
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = shot.height / 2 - 4; y <= shot.height / 2 + 4; y++)
      for (let x = shot.width / 2 - 4; x <= shot.width / 2 + 4; x++) {
        const i = (y * shot.width + x) * 4;
        for (let c = 0; c < 3; c++) sum[c] += shot.data[i + c]!;
        n++;
      }
    return sum.map((v) => Math.round(v / n));
  };
  const near = (got: number[], want: number[]) => got.every((v, i) => Math.abs(v - want[i]!) <= 40);

  const RED = [230, 20, 20];
  const GREEN = [20, 200, 20];
  const BLUE = [20, 40, 230];
  const YELLOW = [240, 220, 0];
  const WHITE = [255, 255, 255];
  const MAGENTA = [255, 0, 255];
  // 30° vs 60°: a mirrored or rotated layout would swap these.
  for (const [yaw, pitch, want, label] of [
    [0, 0, RED, 'ahead'],
    [30, 0, RED, 'ahead-right'],
    [60, 0, GREEN, 'right of the 45° boundary'],
    [90, 0, GREEN, 'right'],
    [180, 0, BLUE, 'behind'],
    [-90, 0, YELLOW, 'left'],
    [0, 85, WHITE, 'above'],
    [0, -85, MAGENTA, 'below'],
  ] as const) {
    await page.evaluate(
      ([y, p]) => window.viewer.setView({ yaw: y, pitch: p, fov: 30 }),
      [yaw, pitch],
    );
    await idle(page);
    const got = await centre();
    expect(near(got, [...want]), `${label} (yaw ${yaw}, pitch ${pitch}): got rgb(${got})`).toBe(
      true,
    );
  }

  // The narrow field of view must have pulled the top tile level (1536 px faces).
  const top = tiles.filter((t) => /\/tiles\/[frblud]\/2\//.test(t));
  expect(top.length, tiles.join('\n')).toBeGreaterThan(0);
  expect(
    tiles.every((t) => t.startsWith('200 ')),
    tiles.join('\n'),
  ).toBe(true);
});
