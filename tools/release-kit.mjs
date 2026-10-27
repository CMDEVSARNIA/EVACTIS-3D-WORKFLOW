#!/usr/bin/env node
/**
 * Assembles the release kit (docs/release-procedure.md, section 3) and checks it.
 *
 *   node tools/release-kit.mjs --installers out/installers \
 *     --site-windows <dir> --site-linux <dir> [--docker <image.tar.gz>] \
 *     --sbom target/sbom/evactis-3dworkflow.cdx.json --out out/release [--commit <sha>] [--test-signed]
 *   node tools/release-kit.mjs --verify out/release/EVACTIS-3DWORKFLOW-<version>
 *
 * Every installer of both apps in both MSI languages must be there, named with the
 * version of the apps' package.json; so must both Site Server programs with their
 * notices, the SBOM and the guides. The kit gets a bilingual README.txt and
 * SHA256SUMS.txt (sha256sum format) over every other file. Nothing is downloaded.
 */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { writeInstallGuides } from './install-guide.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUMS = 'SHA256SUMS.txt';
const APPS = ['Studio', 'Viewer'];
const SITE_EXE = 'evactis-3dworkflow-site-server';
const SITE_NOTICES = ['NOTICES.txt', 'NODE-LICENSE.txt'];
const DOCS = [
  'release-notes.md',
  'it-deployment.md',
  'windows-installers.md',
  'site-server.md',
  'studio-guide.md',
  'viewer-guide.md',
  'safety-signage.md',
  'licenses.md',
];

export class KitError extends Error {
  name = 'KitError';
}

/** The products' version; all three must agree. */
export function productVersion(root = repo) {
  const versions = ['studio', 'viewer-desktop', 'site-server'].map(
    (d) => JSON.parse(readFileSync(join(root, 'apps', d, 'package.json'), 'utf8')).version,
  );
  if (new Set(versions).size !== 1)
    throw new KitError(`The apps disagree on the version: ${versions.join(', ')}`);
  return versions[0];
}

const sha256 = (file) =>
  new Promise((ok, fail) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => ok(h.digest('hex')))
      .on('error', fail);
  });

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const posix = (p) => p.split(sep).join('/');

/**
 * Builds <out>/EVACTIS-3DWORKFLOW-<version>/ and returns its path.
 * @param {{ installers: string, siteWindows: string, siteLinux: string, docker?: string,
 *   sbom: string, out: string, commit?: string, testSigned?: boolean, docs?: string,
 *   version?: string, date?: string }} o
 */
export async function buildKit(o) {
  const version = o.version ?? productVersion();
  const docsDir = o.docs ?? join(repo, 'docs');
  const plan = []; // [source, path in kit]
  const missing = [];
  const need = (src, dest) => (existsSync(src) ? plan.push([src, dest]) : missing.push(src));

  for (const app of APPS) {
    const stem = `EVACTIS-3DWORKFLOW-${app}-${version}-x64`;
    for (const name of [`${stem}-setup.exe`, `${stem}-en-US.msi`, `${stem}-fr-FR.msi`])
      need(join(o.installers, name), `installers/${name}`);
  }
  for (const [dir, os, exe] of [
    [o.siteWindows, 'windows', `${SITE_EXE}.exe`],
    [o.siteLinux, 'linux', SITE_EXE],
  ]) {
    need(join(dir, exe), `site-server/${os}/${exe}`);
    for (const n of SITE_NOTICES) need(join(dir, n), `site-server/${os}/${n}`);
  }
  if (o.docker) need(o.docker, `site-server/docker/${basename(o.docker)}`);
  need(o.sbom, 'sbom/evactis-3dworkflow.cdx.json');
  for (const d of DOCS) need(join(docsDir, d), `docs/${d}`);
  if (existsSync(join(docsDir, 'licenses')))
    for (const f of walk(join(docsDir, 'licenses')))
      plan.push([f, `docs/licenses/${posix(relative(join(docsDir, 'licenses'), f))}`]);

  // A stray installer of another version means the inputs are mixed up.
  const others = existsSync(o.installers)
    ? readdirSync(o.installers).filter(
        (n) => /\.(exe|msi)$/i.test(n) && !n.includes(`-${version}-`),
      )
    : [];
  if (others.length) missing.push(`(installers of another version: ${others.join(', ')})`);
  if (missing.length)
    throw new KitError(`The release kit is incomplete:\n  ${missing.join('\n  ')}`);

  const kit = join(o.out, `EVACTIS-3DWORKFLOW-${version}`);
  if (existsSync(kit)) throw new KitError(`${kit} already exists; a kit is never overwritten`);
  for (const [src, dest] of plan) {
    mkdirSync(dirname(join(kit, dest)), { recursive: true });
    copyFileSync(src, join(kit, dest));
  }
  // The branded Windows installation guide, in English and French, for this version.
  const guides = await writeInstallGuides({
    out: join(kit, 'docs'),
    version,
    date: o.date ?? new Date().toISOString().slice(0, 10),
    testSigned: o.testSigned,
  });
  plan.push(...guides.map((g) => [g, `docs/${basename(g)}`]));
  writeFileSync(
    join(kit, 'README.txt'),
    readme({
      version,
      commit: o.commit,
      testSigned: o.testSigned,
      docker: !!o.docker,
      date: o.date,
      files: plan.map(([, d]) => d),
    }),
  );

  const files = walk(kit)
    .map((f) => posix(relative(kit, f)))
    .filter((f) => f !== SUMS)
    .sort();
  const lines = [];
  for (const f of files) lines.push(`${await sha256(join(kit, f))}  ${f}`);
  writeFileSync(join(kit, SUMS), `${lines.join('\n')}\n`);
  return kit;
}

/** Checks a kit against its SHA256SUMS.txt; returns the problems (none = good). */
export async function verifyKit(kit) {
  const sumsFile = join(kit, SUMS);
  if (!existsSync(sumsFile)) return [`${SUMS} is missing`];
  const listed = new Map(
    readFileSync(sumsFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(l);
        return m ? [m[2], m[1]] : [l, ''];
      }),
  );
  const problems = [];
  for (const [f, want] of listed) {
    if (!want) problems.push(`unreadable line in ${SUMS}: ${f}`);
    else if (!existsSync(join(kit, f))) problems.push(`missing: ${f}`);
    else if ((await sha256(join(kit, f))) !== want) problems.push(`changed: ${f}`);
  }
  for (const f of walk(kit).map((p) => posix(relative(kit, p))))
    if (f !== SUMS && !listed.has(f)) problems.push(`not listed: ${f}`);
  return problems;
}

function readme({ version, commit, testSigned, docker, date, files }) {
  const when = date ?? new Date().toISOString().slice(0, 10);
  const banner = testSigned
    ? [
        '*** TEST-SIGNED BUILD: NOT FOR DELIVERY. The programs carry the CI test certificate.',
        '*** Rebuild and sign this commit at the offline signing station (ADR 0008).',
        '*** VERSION D’ESSAI SIGNÉE AVEC LE CERTIFICAT DE TEST : NE PAS LIVRER.',
        '',
      ]
    : [];
  return [
    ...banner,
    `EVACTIS 3DWORKFLOW ${version} — release kit / trousse de publication`,
    `Commit ${commit ?? '(not recorded)'} · assembled ${when}`,
    '',
    'Contents',
    '  installers/   Studio and Viewer: setup .exe (per user or all users) and MSI (en-US, fr-FR)',
    '  site-server/  Site Server program for Windows and Linux, with NOTICES.txt and NODE-LICENSE.txt',
    docker
      ? '                and the Docker image archive (docker load -i <file>)'
      : '                (no Docker image archive in this kit: docker save it where the base image is available)',
    '  sbom/         CycloneDX software bill of materials (check it against an advisory database',
    '                on a connected machine; only the SBOM leaves the building)',
    '  docs/         Windows installation guide (PDF, EN and FR), IT deployment, Windows installers,',
    '                Site Server administration, Studio and',
    '                Viewer guides (EN/FR), release notes, licences, safety-sign note',
    '  FFmpeg (LGPL) ships inside Studio with its licence and source offer (ffmpeg\\SOURCE.txt).',
    '',
    'Check the kit before use (every file is listed with its SHA-256):',
    '  Windows:  Get-FileHash -Algorithm SHA256 <file>   and compare with SHA256SUMS.txt',
    '  Linux:    sha256sum -c SHA256SUMS.txt',
    '  Or:       node tools/release-kit.mjs --verify <this folder>   (from the source tree)',
    'Check every .exe and .msi with Get-AuthenticodeSignature: signer Evactis, status Valid.',
    '',
    'Contenu',
    '  installers/   Studio et Viewer : programme d’installation .exe et MSI (en-US, fr-FR)',
    '  site-server/  Site Server pour Windows et Linux, avec NOTICES.txt et NODE-LICENSE.txt',
    '  sbom/         nomenclature logicielle CycloneDX',
    '  docs/         guide d’installation Windows (PDF, EN et FR), guides (déploiement TI, Site Server,',
    '                Studio, Viewer), notes de version, licences',
    'Vérifiez la trousse avant usage : chaque fichier figure dans SHA256SUMS.txt avec son SHA-256.',
    '',
    `${files.length} files / fichiers.`,
    '',
  ].join('\r\n');
}

async function main() {
  const { values } = parseArgs({
    options: {
      installers: { type: 'string' },
      'site-windows': { type: 'string' },
      'site-linux': { type: 'string' },
      docker: { type: 'string' },
      sbom: { type: 'string', default: join(repo, 'target/sbom/evactis-3dworkflow.cdx.json') },
      out: { type: 'string', default: join(repo, 'out/release') },
      commit: { type: 'string' },
      'test-signed': { type: 'boolean', default: false },
      verify: { type: 'string' },
    },
  });
  if (values.verify) {
    const problems = await verifyKit(resolve(values.verify));
    if (problems.length) {
      console.error(`The kit does not match its ${SUMS}:\n  ${problems.join('\n  ')}`);
      process.exit(1);
    }
    console.log(`${values.verify}: every file matches ${SUMS}.`);
    return;
  }
  for (const k of ['installers', 'site-windows', 'site-linux'])
    if (!values[k]) throw new KitError(`--${k} is required`);
  const kit = await buildKit({
    installers: resolve(values.installers),
    siteWindows: resolve(values['site-windows']),
    siteLinux: resolve(values['site-linux']),
    docker: values.docker && resolve(values.docker),
    sbom: resolve(values.sbom),
    out: resolve(values.out),
    commit: values.commit,
    testSigned: values['test-signed'],
  });
  const problems = await verifyKit(kit);
  if (problems.length)
    throw new KitError(`The new kit does not verify:\n  ${problems.join('\n  ')}`);
  console.log(`Release kit: ${kit}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e instanceof KitError ? e.message : e);
    process.exit(1);
  });
