import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildKit, KitError, productVersion, verifyKit } from './release-kit.mjs';

const put = (file, text = file) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
};

/** A complete set of inputs for version 9.8.7 in a temporary folder. */
function inputs() {
  const t = mkdtempSync(join(tmpdir(), 'evx-kit-'));
  const o = {
    installers: join(t, 'installers'),
    siteWindows: join(t, 'site-win'),
    siteLinux: join(t, 'site-linux'),
    sbom: join(t, 'sbom.json'),
    docs: join(t, 'docs'),
    out: join(t, 'out'),
    version: '9.8.7',
    date: '2026-10-22',
    commit: 'abc123',
  };
  for (const app of ['Studio', 'Viewer'])
    for (const s of ['setup.exe', 'en-US.msi', 'fr-FR.msi'])
      put(join(o.installers, `EVACTIS-3DWORKFLOW-${app}-9.8.7-x64-${s}`));
  put(join(o.installers, 'signer.cer'));
  for (const [d, exe] of [
    [o.siteWindows, 'evactis-3dworkflow-site-server.exe'],
    [o.siteLinux, 'evactis-3dworkflow-site-server'],
  ])
    for (const n of [exe, 'NOTICES.txt', 'NODE-LICENSE.txt']) put(join(d, n));
  put(o.sbom, '{}');
  for (const d of [
    'release-notes.md',
    'it-deployment.md',
    'windows-installers.md',
    'site-server.md',
    'studio-guide.md',
    'viewer-guide.md',
    'safety-signage.md',
    'licenses.md',
    'licenses/rust-crates.md',
  ])
    put(join(o.docs, d));
  return o;
}

test('the apps agree on one version', () => {
  assert.match(productVersion(), /^\d+\.\d+\.\d+(-[\w.]+)?$/);
});

test('assembles every item with a checksum list that verifies', async () => {
  const kit = await buildKit({ ...inputs(), testSigned: true });
  assert.match(kit, /EVACTIS-3DWORKFLOW-9\.8\.7$/);
  const sums = readFileSync(join(kit, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
  const listed = sums.map((l) => l.slice(66));
  assert.deepEqual(listed, [...listed].sort());
  for (const f of [
    'README.txt',
    'installers/EVACTIS-3DWORKFLOW-Studio-9.8.7-x64-setup.exe',
    'installers/EVACTIS-3DWORKFLOW-Viewer-9.8.7-x64-fr-FR.msi',
    'site-server/windows/evactis-3dworkflow-site-server.exe',
    'site-server/linux/NODE-LICENSE.txt',
    'sbom/evactis-3dworkflow.cdx.json',
    'docs/licenses/rust-crates.md',
  ])
    assert.ok(listed.includes(f), f);
  assert.ok(!listed.some((f) => f.endsWith('signer.cer')), 'the signer certificate stays out');
  assert.equal(listed.length, 6 + 6 + 1 + 9 + 1);
  const readme = readFileSync(join(kit, 'README.txt'), 'utf8');
  assert.match(readme, /^\*\*\* TEST-SIGNED BUILD: NOT FOR DELIVERY/);
  assert.match(readme, /EVACTIS 3DWORKFLOW 9\.8\.7 .*\r\nCommit abc123 · assembled 2026-10-22/);
  assert.deepEqual(await verifyKit(kit), []);
});

test('a release build has no test banner and keeps the Docker archive', async () => {
  const o = inputs();
  const image = join(o.out, '..', 'image.tar.gz');
  put(image);
  const kit = await buildKit({ ...o, docker: image });
  const readme = readFileSync(join(kit, 'README.txt'), 'utf8');
  assert.doesNotMatch(readme, /TEST-SIGNED/);
  assert.match(readme, /docker load -i/);
  assert.match(
    readFileSync(join(kit, 'SHA256SUMS.txt'), 'utf8'),
    /site-server\/docker\/image\.tar\.gz/,
  );
});

test('refuses a missing item, a stray version or an existing kit', async () => {
  const o = inputs();
  writeFileSync(join(o.installers, 'EVACTIS-3DWORKFLOW-Viewer-9.8.6-x64-setup.exe'), '');
  await assert.rejects(
    buildKit(o),
    (e) => e instanceof KitError && /another version/.test(e.message),
  );

  const p = inputs();
  rmSync(join(p.siteLinux, 'NOTICES.txt'));
  rmSync(join(p.docs, 'viewer-guide.md'));
  await assert.rejects(buildKit(p), (e) =>
    /site-linux[/\\]NOTICES\.txt[\s\S]*viewer-guide\.md/.test(e.message),
  );

  const q = inputs();
  await buildKit(q);
  await assert.rejects(buildKit(q), /never overwritten/);
});

test('verification names changed, missing and unlisted files', async () => {
  const kit = await buildKit(inputs());
  writeFileSync(join(kit, 'docs/site-server.md'), 'altered');
  rmSync(join(kit, 'sbom/evactis-3dworkflow.cdx.json'));
  writeFileSync(join(kit, 'extra.txt'), 'x');
  assert.deepEqual((await verifyKit(kit)).sort(), [
    'changed: docs/site-server.md',
    'missing: sbom/evactis-3dworkflow.cdx.json',
    'not listed: extra.txt',
  ]);
});
