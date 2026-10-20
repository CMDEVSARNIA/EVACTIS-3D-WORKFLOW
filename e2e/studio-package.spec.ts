import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { PackageReader, PassphraseError } from '../packages/package-format/src/index.ts';
import { unzip } from '../packages/packaging/src/index.ts';
import { contrastProblems } from './contrast';
import { test, expect } from './offline';

/**
 * Phase 10, Studio side: the Package dialog makes delivery packages of the demo facility
 * (in-memory backend: files land in window.__evxMemory.exports). An encrypted .evx opens
 * only with its passphrase and every file passes its check; a package never overwrites
 * an earlier one; a single HTML file made in Studio opens from disk in the browser; kinds
 * this Studio cannot make (no NSIS in the test backend) say why.
 */
const STUDIO = 'http://127.0.0.1:4179/index.html';
const PASS = 'correct horse battery staple';
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(180_000);

/** A file "written" by the dialog, read back from the page. */
async function exported(page: Page, path: string): Promise<Buffer> {
  const b64 = await page.evaluate((p) => {
    const bytes = window.__evxMemory!.exports.get(p);
    if (!bytes) return null;
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, path);
  expect(b64, path).not.toBeNull();
  return Buffer.from(b64!, 'base64');
}

test('the Package dialog makes delivery packages offline', async ({ page }) => {
  await page.goto(STUDIO);
  await page.getByRole('button', { name: 'Open project…' }).click();
  await expect(page.getByTestId('project-name')).toHaveText('Evactis Demo Centre');
  await page.getByRole('button', { name: 'Package…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Package the environment' });
  await expect(dialog).toContainText('runs fully offline');
  expect(await contrastProblems(page, '[role="dialog"]'), 'package dialog').toEqual([]);

  // No NSIS in the test backend: the installer says so and cannot be made.
  await dialog.getByRole('radio', { name: /Windows installer/ }).check();
  await expect(dialog).toContainText('the installer builder (NSIS) is not bundled');
  await dialog.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(dialog.getByTestId('package-folder')).toHaveText('/e2e/exports');
  const make = dialog.getByRole('button', { name: 'Make package' });
  await expect(make).toBeDisabled();

  // ------------------------------------------------------------ encrypted .evx
  await dialog.getByRole('radio', { name: /\.evx environment file/ }).check();
  await expect(dialog.getByLabel('Name')).toHaveValue('Evactis Demo Centre');
  await dialog.getByRole('checkbox', { name: 'Encrypt with a passphrase' }).check();
  await dialog.getByLabel('Passphrase', { exact: true }).fill('short');
  await expect(dialog.getByTestId('passphrase-problem')).toHaveText('At least 8 characters.');
  await dialog.getByLabel('Passphrase', { exact: true }).fill(PASS);
  await dialog.getByLabel('Passphrase again').fill(`${PASS}!`);
  await expect(dialog.getByTestId('passphrase-problem')).toHaveText('The two passphrases differ.');
  await expect(make).toBeDisabled();
  await dialog.getByLabel('Passphrase again').fill(PASS);
  await dialog.screenshot({ path: test.info().outputPath('package-dialog.png') });
  await make.click();
  await expect(dialog.getByTestId('package-done')).toHaveText(
    'Package ready: /e2e/exports/Evactis Demo Centre.evx',
    { timeout: 120_000 },
  );

  const entries = new Map(
    unzip(await exported(page, '/e2e/exports/Evactis Demo Centre.evx')).map((e) => [
      e.name,
      e.data,
    ]),
  );
  const pkg = await PackageReader.open(async (p) => entries.get(p)!);
  expect(pkg.manifest).toMatchObject({ kind: 'evx', offline: true });
  expect(pkg.manifest.producer).toMatch(/^EVACTIS 3DWORKFLOW Studio /);
  expect(pkg.encrypted).toBe(true);
  await expect(pkg.unlock('wrong horse battery staple')).rejects.toBeInstanceOf(PassphraseError);
  await pkg.unlock(PASS);
  await pkg.verifyAll();
  const env = JSON.parse(new TextDecoder().decode(await pkg.bytes('environment.json')));
  expect(env.title.en).toBe('Evactis Demo Centre');
  expect((await pkg.bytes('media/lobby/tiles/f/0/0_0.jpg')).length).toBeGreaterThan(1000);

  // The same name again: refused, nothing overwritten.
  await make.click();
  await expect(dialog.getByRole('alert')).toContainText('already exists');

  // ------------------------------------------------------------ portable folder
  await dialog.getByRole('checkbox', { name: 'Encrypt with a passphrase' }).uncheck();
  await dialog.getByRole('radio', { name: /Portable viewer/ }).check();
  await make.click();
  await expect(dialog.getByTestId('package-done')).toHaveText(
    'Package ready: /e2e/exports/Evactis Demo Centre',
    { timeout: 120_000 },
  );
  const viewerJson = await exported(page, '/e2e/exports/Evactis Demo Centre/viewer.json');
  expect(JSON.parse(viewerJson.toString())).toEqual({
    environment: 'environment.evx',
    kiosk: false,
    portable: true,
  });
  await exported(page, '/e2e/exports/Evactis Demo Centre/EVACTIS-3DWORKFLOW-Viewer.exe');

  // ------------------------------------------------------------ single HTML file
  await dialog.getByRole('radio', { name: /Single HTML file/ }).check();
  await expect(dialog.getByTestId('single-file-size')).toContainText(/About \d/, {
    timeout: 30_000,
  });
  await dialog.getByLabel('Name').fill('Demo single');
  await make.click();
  await expect(dialog.getByTestId('package-done')).toHaveText(
    'Package ready: /e2e/exports/Demo single.html',
    { timeout: 120_000 },
  );
  const html = test.info().outputPath('Demo single.html');
  writeFileSync(html, await exported(page, '/e2e/exports/Demo single.html'));
  await page.goto(`file://${html}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'inline');
});
