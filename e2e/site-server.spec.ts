import { existsSync, readFileSync } from 'node:fs';
import type { Browser, Page } from '@playwright/test';
import { contrastProblems } from './contrast';
import { BLOCKED_NETWORK_ARGS } from './network-args';
import { test, expect } from './offline';

/**
 * Phase 11: the Site Server with two people in two browsers (separate contexts, network
 * blocked except the server on loopback). Shared notes arrive live; in a guided session
 * the host's navigation moves the participant's view, and their audio flows over WebRTC
 * through the server's own TURN relay (relay candidates only, so no other path exists).
 * Fake microphone and camera devices stand in for real ones.
 */
const SITE = 'https://127.0.0.1:4190';
const FIXTURE = 'target/e2e-site/fixture.json';
test.use({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
  launchOptions: {
    args: [
      ...BLOCKED_NETWORK_ARGS,
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
});
test.setTimeout(240_000);

interface Fixture {
  environmentId: string;
  password: string;
}
let fx: Fixture;
test.beforeAll(async () => {
  // The server answers /health before the fixture has finished seeding it.
  await expect.poll(() => existsSync(FIXTURE), { timeout: 120_000 }).toBe(true);
  fx = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
});

async function signIn(browser: Browser, who: string): Promise<Page> {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(`${SITE}/`);
  await page.getByLabel('Username').fill(who);
  await page.getByLabel('Password').fill(fx.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Environments' })).toBeVisible();
  return page;
}

const openEnvironment = async (page: Page) => {
  await page.goto(`${SITE}/view/${fx.environmentId}?relay`);
  await expect(page.locator('body')).toHaveAttribute('data-site', 'ready', { timeout: 60_000 });
};

test('two people share notes live and run a guided session over the LAN relay', async ({
  page,
  browser,
}) => {
  // ---------------------------------------------------------------- portal (ada)
  await page.goto(`${SITE}/`);
  await page.getByLabel('Username').fill('ada');
  await page.getByLabel('Password').fill('wrong password!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong username or password');
  await page.getByLabel('Password').fill(fx.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Environments' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evactis Demo Centre' })).toBeVisible();
  expect(await contrastProblems(page), 'portal').toEqual([]);
  const ada = page;
  const bob = await signIn(browser, 'bob');
  await expect(bob.getByRole('link', { name: 'Administration' })).toHaveCount(0);

  await openEnvironment(ada);
  await openEnvironment(bob);

  // ---------------------------------------------------------------- shared notes
  await ada.getByRole('button', { name: 'Add a note' }).click();
  await ada.mouse.click(500, 450);
  await ada.getByLabel('Title').fill('Boxes block the exit');
  await ada.getByLabel('Category').selectOption('hazard');
  await ada.getByLabel('Text').fill('Seen during the walk; <b>not markup</b>.');
  await ada.getByLabel('Assigned to').selectOption({ label: 'Bob Builder' });
  await ada.getByRole('button', { name: 'Save' }).click();
  await expect(ada.getByTestId('note-title')).toHaveText('Boxes block the exit');
  await expect(ada.locator('.site-pin')).toHaveCount(1);

  // Bob sees it without reloading: in the list and as a pin in the scene.
  const bobList = bob.getByTestId('note-list');
  await expect(bobList).toContainText('Boxes block the exit');
  await expect(bob.locator('.site-pin')).toHaveCount(1);
  await bobList.getByRole('button', { name: /Boxes block the exit/ }).click();
  await expect(bob.locator('.site-note-body')).toHaveText(
    'Seen during the walk; <b>not markup</b>.',
  );
  await expect(bob.getByLabel('Assigned to')).toHaveValue(/.+/);
  await bob.getByLabel('Reply').fill('Moved them to the dock.');
  await bob.getByRole('button', { name: 'Send' }).click();
  await bob.getByLabel('Status').selectOption('resolved');
  await expect(ada.locator('.site-replies')).toContainText('Moved them to the dock.');
  await expect(ada.getByLabel('Status')).toHaveValue('resolved');
  expect(await contrastProblems(ada, '.site-panel'), 'site panel').toEqual([]);

  // ---------------------------------------------------------------- guided session
  await ada.getByRole('tab', { name: 'Guided session' }).click();
  await ada.getByLabel('Session name').fill('Fire warden walk');
  await ada.getByRole('button', { name: 'Start a guided session' }).click();
  await expect(ada.getByTestId('session-title')).toHaveText('Fire warden walk');
  await bob.getByRole('tab', { name: 'Guided session' }).click();
  const listed = bob.getByTestId('session-list');
  await expect(listed).toContainText('Fire warden walk');
  await listed.getByRole('button', { name: 'Join' }).click();
  await expect(bob.getByTestId('session-members')).toContainText('Ada Admin');
  await expect(ada.getByTestId('session-members')).toContainText('Bob Builder');

  // The host leads: scene and view reach the participant.
  await ada.evaluate(() => window.viewer!.goToScene('office', { transition: { kind: 'cut' } }));
  await expect
    .poll(() => bob.evaluate(() => window.viewer!.sceneId), { timeout: 15_000 })
    .toBe('office');
  await ada.evaluate(() => window.viewer!.setView({ yaw: 63, pitch: -8 }));
  await expect
    .poll(() => bob.evaluate(() => Math.round(window.viewer!.getView().yaw)), { timeout: 15_000 })
    .toBe(63);

  // Microphones on: audio flows both ways over relay candidates (the site's TURN).
  await ada.getByRole('button', { name: /^Microphone/ }).click();
  await bob.getByRole('button', { name: /^Microphone/ }).click();
  await expect(ada.locator('[data-peer-state="connected"]')).toHaveCount(1, { timeout: 30_000 });
  await expect(bob.locator('[data-peer-state="connected"]')).toHaveCount(1, { timeout: 30_000 });
  for (const p of [ada, bob]) {
    await expect
      .poll(
        async () => (await p.evaluate(() => window.evxSite!.sessions.stats()))[0]?.audioIn ?? 0,
        {
          timeout: 30_000,
        },
      )
      .toBeGreaterThan(20);
    const [s] = await p.evaluate(() => window.evxSite!.sessions.stats());
    expect(s).toMatchObject({ state: 'connected', local: 'relay', remote: 'relay' });
  }

  // The host ends it for everyone.
  await ada.getByRole('button', { name: 'End for everyone' }).click();
  await expect(
    bob.getByRole('status').filter({ hasText: 'The host ended the session.' }),
  ).toBeVisible();
  await bob.context().close();
});

test('administration: reports start off, the certificate authority is offered, text contrast holds', async ({
  page,
  playwright,
}) => {
  await page.goto(`${SITE}/`);
  await page.getByLabel('Username').fill('ada');
  await page.getByLabel('Password').fill(fx.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Administration' }).click();
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
  await expect(page.getByLabel('Record usage on this site')).not.toBeChecked();
  expect(await contrastProblems(page), 'administration').toEqual([]);
  // Carol is signed in elsewhere; a new password ends her sessions. (Her account is used by
  // no other test: the guided-session test runs at the same time as Ada and Bob.)
  const carol = await playwright.request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'x-evx': '1' },
  });
  expect(
    (
      await carol.post(`${SITE}/api/login`, { data: { username: 'carol', password: fx.password } })
    ).ok(),
  ).toBe(true);
  const signedIn = async () => (await (await carol.get(`${SITE}/api/site`)).json()).user != null;
  expect(await signedIn()).toBe(true);
  // Questions are in-page dialogs (not browser prompts): named, modal, Escape cancels.
  const carolRow = page.getByRole('row').filter({ hasText: 'Carol Clerk' });
  await carolRow.getByRole('button', { name: 'Set password' }).click();
  const dialog = page.getByRole('dialog', { name: /Set password: Carol Clerk/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('New password')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await signedIn()).toBe(true);
  await carolRow.getByRole('button', { name: 'Set password' }).click();
  await dialog.getByLabel('New password').fill(fx.password);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(await signedIn()).toBe(false);
  await carol.dispose();
  const ca = await page.request.get(`${SITE}/ca.pem`);
  expect((await ca.text()).startsWith('-----BEGIN CERTIFICATE-----')).toBe(true);
});
