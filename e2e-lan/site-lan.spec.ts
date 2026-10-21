import { readFileSync } from 'node:fs';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Two machines on an isolated network (separate network stacks, separate subnets,
 * no route between them and none to the internet) use the Site Server: they share notes
 * and run a guided session. With no path between the machines, their audio can only
 * travel through the server's own TURN relay; the script checks afterwards that the
 * server never sent a packet anywhere but the LAN.
 */
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set: run scripts/linux/site-server-lan.sh`);
  return v;
};
const SITE_A = env('SITE_A');
const SITE_B = env('SITE_B');
const fx = JSON.parse(readFileSync(env('SITE_FIXTURE'), 'utf8')) as {
  environmentId: string;
  password: string;
};
const MEDIA = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

const browsers: Browser[] = [];
test.afterAll(async () => {
  for (const b of browsers) await b.close();
});

/** A browser on one machine (its network namespace), signed in and on the environment. */
async function machine(chrome: string, site: string, who: string): Promise<Page> {
  const browser = await chromium.launch({ executablePath: chrome, args: MEDIA });
  browsers.push(browser);
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
  });
  const outside: string[] = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(site) || /^(blob|data):/.test(url)) return route.continue();
    outside.push(url);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  test.info().annotations.push({ type: 'machine', description: `${who} on ${site}` });
  await page.goto(`${site}/`);
  await page.getByLabel('Username').fill(who);
  await page.getByLabel('Password').fill(fx.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Environments' })).toBeVisible();
  await page.goto(`${site}/view/${fx.environmentId}`);
  await expect(page.locator('body')).toHaveAttribute('data-site', 'ready', { timeout: 90_000 });
  expect(outside, `${who}: requests outside the site`).toEqual([]);
  return page;
}

test('two machines share notes and run a guided session; audio crosses only the server relay', async () => {
  const ada = await machine(env('CHROME_A'), SITE_A, 'ada');
  const bob = await machine(env('CHROME_B'), SITE_B, 'bob');

  await ada.getByRole('button', { name: 'Add a note' }).click();
  await ada.mouse.click(480, 420);
  await ada.getByLabel('Title').fill('Fire door wedged open');
  await ada.getByLabel('Category').selectOption('hazard');
  await ada.getByRole('button', { name: 'Save' }).click();
  await expect(bob.getByTestId('note-list')).toContainText('Fire door wedged open');
  await bob
    .getByTestId('note-list')
    .getByRole('button', { name: /Fire door wedged open/ })
    .click();
  await bob.getByLabel('Reply').fill('Closed it and told maintenance.');
  await bob.getByRole('button', { name: 'Send' }).click();
  await expect(ada.locator('.site-replies')).toContainText('Closed it and told maintenance.');

  await ada.getByRole('tab', { name: 'Guided session' }).click();
  await ada.getByLabel('Session name').fill('Evacuation walk-through');
  await ada.getByRole('button', { name: 'Start a guided session' }).click();
  await bob.getByRole('tab', { name: 'Guided session' }).click();
  await bob.getByTestId('session-list').getByRole('button', { name: 'Join' }).click();
  await expect(ada.getByTestId('session-members')).toContainText('Bob Builder');
  await ada.evaluate(() => window.viewer!.goToScene('office', { transition: { kind: 'cut' } }));
  await expect
    .poll(() => bob.evaluate(() => window.viewer!.sceneId), { timeout: 20_000 })
    .toBe('office');

  await ada.getByRole('button', { name: /^Microphone/ }).click();
  await bob.getByRole('button', { name: /^Microphone/ }).click();
  // If audio does not connect, show every candidate and pair each browser saw.
  const ice = async (p: Page) =>
    p.evaluate(async () => {
      const peers = (
        window.evxSite!.sessions as unknown as { peers: Map<string, { pc: RTCPeerConnection }> }
      ).peers;
      const out: unknown[] = [];
      for (const { pc } of peers.values())
        (await pc.getStats()).forEach((s: Record<string, unknown>) => {
          if (/candidate/.test(String(s.type)))
            out.push([
              s.type,
              s.candidateType ?? s.state,
              s.address ?? '',
              s.port ?? '',
              s.url ?? '',
              s.relayProtocol ?? '',
            ]);
        });
      return out;
    });
  try {
    for (const p of [ada, bob]) {
      await expect(p.locator('[data-peer-state="connected"]')).toHaveCount(1, { timeout: 45_000 });
      await expect
        .poll(
          async () => (await p.evaluate(() => window.evxSite!.sessions.stats()))[0]?.audioIn ?? 0,
          { timeout: 45_000 },
        )
        .toBeGreaterThan(20);
      const [s] = await p.evaluate(() => window.evxSite!.sessions.stats());
      // No relay-only flag here: the browsers may use any path; the only one that exists is the relay.
      expect(s).toMatchObject({ state: 'connected' });
      expect([s!.local, s!.remote]).toContain('relay');
    }
  } catch (e) {
    console.log('ada ICE', JSON.stringify(await ice(ada)));
    console.log(
      'ada stats',
      JSON.stringify(await ada.evaluate(() => window.evxSite!.sessions.stats())),
    );
    console.log('bob ICE', JSON.stringify(await ice(bob)));
    console.log(
      'bob stats',
      JSON.stringify(await bob.evaluate(() => window.evxSite!.sessions.stats())),
    );
    throw e;
  }
});
