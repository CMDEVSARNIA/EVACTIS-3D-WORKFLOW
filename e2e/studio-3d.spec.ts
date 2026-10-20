import { test, expect } from './offline';

/**
 * Phase 9, Studio side: in the GLB and splat scenes of the demo facility, a click in the
 * preview places an equipment sign on the model's surface (a world position, so it stays
 * on the wall or floor as the reader moves); dragging it moves it over the surface.
 */
const STUDIO = 'http://127.0.0.1:4179/index.html';
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(180_000);

interface Saved {
  equipment: {
    id: string;
    tag?: string;
    placements: {
      sceneId: string;
      position: { kind: string; x?: number; y?: number; z?: number };
    }[];
  }[];
}

test('places equipment on the surface of GLB and splat scenes', async ({ page }) => {
  await page.goto(STUDIO);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByTestId('project-name')).toHaveText('Evactis Demo Centre');
  await page.getByRole('tab', { name: 'Safety' }).click();
  await page.getByRole('combobox', { name: 'Floor' }).first().selectOption('f1');

  for (const [scene, tag, fx, fy] of [
    // Clear of the existing signs: the dock's floor, the mechanical room's left wall.
    ['dock', 'FE-901', 0.55, 0.85],
    ['mechanical', 'FE-902', 0.12, 0.4],
  ] as const) {
    await page.getByRole('combobox', { name: 'Scene' }).first().selectOption(scene);
    await expect(page.getByTestId('preview')).toHaveAttribute('data-ready', 'true');
    await page.getByRole('combobox', { name: 'Add equipment' }).selectOption('fire-extinguisher');
    const inspector = page.getByTestId('equipment-inspector');
    await inspector.getByLabel('Tag (e.g. FE-101)').fill(tag);
    const preview = (await page.getByTestId('preview').boundingBox())!;
    await page.mouse.click(preview.x + preview.width * fx, preview.y + preview.height * fy);
    await expect(inspector.getByTestId('placements').getByRole('listitem')).toHaveCount(1);
    let added: Saved['equipment'][number] | undefined;
    await expect
      .poll(async () => {
        const doc: Saved = JSON.parse(await page.evaluate(() => window.__evxMemory!.manifest));
        added = doc.equipment.find((e) => e.tag === tag);
        return added?.placements.length ?? 0;
      })
      .toBe(1);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
    added = added!;
    const p = added.placements[0]!;
    expect(p.sceneId).toBe(scene);
    // On the model, not a bare direction.
    expect(p.position.kind, `${scene} placement`).toBe('world');
    for (const k of ['x', 'y', 'z'] as const) expect(Number.isFinite(p.position[k])).toBe(true);
    const sign = page.locator(`[data-hotspot-id="equipment:${added.id}"]`);
    await expect(sign).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`studio-${scene}.png`) });
  }
});
