import type { Page } from '@playwright/test';
import { test, expect } from './offline';
import { idle, openDemo, sceneId } from './viewer-helpers';

/**
 * Phase 5 safety layer in the Viewer, on the demo facility: equipment per audience,
 * evacuation routes (nearest primary, alternative one tap away, animated chevrons that
 * point the right way), and the floor plan with "You are here".
 */
test.use({ viewport: { width: 1280, height: 800 } });

const equipmentIds = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-hotspot-id^="equipment:"]')].map(
      (e) => e.dataset.hotspotId!,
    ),
  );

const chevrons = (page: Page) => page.locator('.evx-viewer__chevron');

/** Screen centre of the chevron trail relative to the viewer's centre (px). */
const trailOffset = (page: Page) =>
  page.evaluate(() => {
    const host = document.querySelector('.evx-viewer')!.getBoundingClientRect();
    const xs = [...document.querySelectorAll('.evx-viewer__chevron')].map((c) => {
      const r = c.getBoundingClientRect();
      return r.left + r.width / 2;
    });
    return xs.reduce((a, b) => a + b, 0) / xs.length - (host.left + host.width / 2);
  });

test.describe('safety layer', () => {
  test('first responders see layers that staff do not, in the scene and on the plan', async ({
    page,
  }) => {
    await openDemo(page);
    const staff = await equipmentIds(page);
    expect(staff).toEqual(
      expect.arrayContaining(['equipment:fe-101', 'equipment:aed-1', 'equipment:exit-main']),
    );
    expect(staff).not.toContain('equipment:facp');

    await page.getByRole('combobox', { name: 'Audience' }).selectOption('first-responders');
    const responders = await equipmentIds(page);
    expect(responders.filter((id) => !staff.includes(id))).toEqual(['equipment:facp']);
    // The annunciator has no sign: a symbol marker, labelled for screen readers.
    const facp = page.getByRole('button', { name: 'Fire alarm annunciator panel' });
    await expect(facp).toHaveText('FACP');
    await facp.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toContainText('Annunciator: zone 1');
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

    // On the plan: the fire department connection and key box outside the entrance.
    const planItems = async () => {
      void page.evaluate(() => window.viewer.showFloorPlan('f1'));
      const ids = await page
        .locator('.evx-viewer__plan-item')
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.equipmentId!));
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
      return ids;
    };
    const frPlan = await planItems();
    await page.getByRole('combobox', { name: 'Audience' }).selectOption('staff');
    const staffPlan = await planItems();
    expect(frPlan.filter((id) => !staffPlan.includes(id)).sort()).toEqual(
      ['facp', 'fdc', 'key-box', 'riser-a'].sort(),
    );
    expect(staffPlan.every((id) => frPlan.includes(id))).toBe(true);
  });

  test('the evac-route button shows the nearest primary route; the alternative is one tap away', async ({
    page,
  }) => {
    await openDemo(page);
    await page.getByRole('button', { name: 'Evacuation route' }).click();
    const banner = page.getByRole('region', { name: 'Evacuation route' });
    await expect(banner).toContainText('Main exit (south)');
    await expect(banner).toContainText('Follow the green arrows to Assembly point A');
    await expect(chevrons(page)).toHaveCount(6);
    await expect(page.locator('.evx-viewer__route-arrows')).toHaveAttribute(
      'data-priority',
      'primary',
    );

    await banner.getByRole('button', { name: 'Alternative route' }).click();
    await expect(banner).toContainText('North exit by the east corridor');
    await expect(page.locator('.evx-viewer__route-arrows')).toHaveAttribute(
      'data-priority',
      'secondary',
    );
    await banner.getByRole('button', { name: 'Main route' }).click();
    await expect(banner).toContainText('Main exit (south)');
    await banner.getByRole('button', { name: 'Close route' }).click();
    await expect(banner).toBeHidden();
    await expect(chevrons(page)).toHaveCount(0);
  });

  test('chevrons animate along the floor towards the exit, scene after scene', async ({ page }) => {
    await openDemo(page, '?scene=office');
    await page.evaluate(() => window.viewer.showRoute());
    // Office: the route leaves by the south door (yaw 180); the view turns to face it.
    await expect
      .poll(() => page.evaluate(() => Math.abs(Math.abs(window.viewer.getView().yaw) - 180)))
      .toBeLessThan(2);
    await page.evaluate(() => window.viewer.setView({ yaw: 180, pitch: -20, fov: 90 }));
    await idle(page);
    expect(Math.abs(await trailOffset(page))).toBeLessThan(8);
    // Looking elsewhere, the trail is off to the side or off screen.
    await page.evaluate(() => window.viewer.setView({ yaw: 120, pitch: -20, fov: 90 }));
    await idle(page);
    expect(await trailOffset(page)).toBeGreaterThan(200);

    // The arrows point away from the reader (towards the horizon) and pulse in turn.
    await page.evaluate(() => window.viewer.setView({ yaw: 180, pitch: -20, fov: 90 }));
    await idle(page);
    const ys = await chevrons(page).evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().top),
    );
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeLessThan(ys[i - 1]!);
    const anim = await chevrons(page).evaluateAll((els) =>
      els.map((e) => [getComputedStyle(e).animationName, getComputedStyle(e).animationDelay]),
    );
    expect(anim[0]).toEqual(['evx-chevron', '0s']);
    expect(anim[3]).toEqual(['evx-chevron', '0.48s']);

    // Down the stairs: the route stays on, now heading west to the lobby door (yaw -90).
    await page.evaluate(() =>
      window.viewer.goToScene('stairwell', { transition: { kind: 'cut' } }),
    );
    await expect.poll(() => sceneId(page)).toBe('stairwell');
    await page.evaluate(() => window.viewer.setView({ yaw: -90, pitch: -20, fov: 90 }));
    await idle(page);
    await expect(chevrons(page)).toHaveCount(6);
    expect(Math.abs(await trailOffset(page))).toBeLessThan(8);

    // At the assembly point, the banner says so.
    await page.evaluate(() => window.viewer.goToScene('assembly', { transition: { kind: 'cut' } }));
    await expect(page.getByRole('region', { name: 'Evacuation route' })).toContainText(
      'You have reached Assembly point A',
    );
  });

  test('with reduced motion the chevrons hold still', async ({ page }) => {
    await openDemo(page, '?reduced-motion');
    await page.evaluate(() => window.viewer.showRoute());
    const names = await chevrons(page).evaluateAll((els) =>
      els.map((e) => getComputedStyle(e).animationName),
    );
    expect(new Set(names)).toEqual(new Set(['none']));
  });

  test('the floor plan shows the route, the equipment legend and "You are here"', async ({
    page,
  }) => {
    await openDemo(page);
    await page.evaluate(() => window.viewer.setView({ yaw: 180 }));
    await page.getByRole('button', { name: 'Floor plan' }).click();
    const dialog = page.getByRole('dialog', { name: 'Floor plan' });
    await expect(dialog.getByRole('button', { name: 'Ground floor' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(dialog.locator('.evx-viewer__you-are-here')).toContainText('You are here');
    // Facing south (yaw 180, north offset 0, plan north up).
    await expect(dialog.locator('.evx-viewer__you-are-here')).toHaveAttribute(
      'style',
      /--facing: 180\.0deg/,
    );
    await expect(dialog.locator('polyline[data-route-id="route-south"]')).toHaveCount(2);
    await expect(dialog.getByRole('list', { name: 'Legend' })).toContainText('Fire extinguisher');
    await expect(dialog.locator('.evx-viewer__plan > img')).toHaveJSProperty('complete', true);

    await dialog.getByRole('button', { name: 'Second floor' }).click();
    await expect(dialog.locator('.evx-viewer__plan')).toHaveAttribute('data-floor-id', 'f2');
    await expect(dialog.locator('.evx-viewer__you-are-here')).toHaveCount(0);
    await expect(dialog.locator('polyline[data-route-id="route-south"]')).toHaveCount(2);
  });

  test('French: route banner and plan in the reader’s language', async ({ page }) => {
    await openDemo(page, '?lang=fr');
    await page.evaluate(() => window.viewer.showRoute());
    const banner = page.getByRole('region', { name: 'Itinéraire d’évacuation' });
    await expect(banner).toContainText('Sortie principale (sud)');
    await expect(banner.getByRole('button', { name: 'Itinéraire de rechange' })).toBeVisible();
  });
});
