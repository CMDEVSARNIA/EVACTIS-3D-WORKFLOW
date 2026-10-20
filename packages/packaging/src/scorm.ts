/**
 * SCORM export (Phase 8): the 3DWORKFLOW Viewer player, the environment and its media in
 * one ZIP that a client's own LMS imports. Each training module is a SCO launching the
 * player with `?module=<id>`; the player reports score, completion and success through
 * the LMS's runtime API (packages/viewer/player/lms.ts). SCORM 1.2 or 2004 4th edition.
 *
 * The XML namespace names below identify the SCORM/IMS vocabularies; nothing is ever
 * fetched from them. No XSD files are bundled (schemaLocation is omitted).
 */
import { zip } from '@evactis-3dworkflow/print/zip';
import { localize, type Environment, type TrainingModule } from '@evactis-3dworkflow/schema';

export type ScormVersion = '1.2' | '2004';

export interface PackageFile {
  /** Path inside the package, forward slashes (e.g. `media/lobby/preview.jpg`). */
  path: string;
  data: Uint8Array;
}

export interface ScormOptions {
  version: ScormVersion;
  /** The player's files (packages/viewer/player-dist, as listed in its files.json). */
  player: PackageFile[];
  /** Every package file the environment refers to (media, plans, documents…). */
  assets: PackageFile[];
  /** Modules to include (default: all). */
  moduleIds?: string[];
}

/** Largest package a plain ZIP holds; bigger tours wait for the Phase 10 packager. */
export const ZIP_LIMITS = { files: 65_535, bytes: 0xffff_ffff };

export class PackagingError extends Error {}

/* eslint-disable no-restricted-syntax -- XML namespace names SCORM requires; identifiers, never fetched. */
const NS = {
  '1.2': {
    cp: 'http://www.imsproject.org/xsd/imscp_rootv1p1p2',
    adlcp: 'http://www.adlnet.org/xsd/adlcp_rootv1p2',
  },
  '2004': {
    cp: 'http://www.imsglobal.org/xsd/imscp_v1p1',
    adlcp: 'http://www.adlnet.org/xsd/adlcp_v1p3',
    adlseq: 'http://www.adlnet.org/xsd/adlseq_v1p3',
    adlnav: 'http://www.adlnet.org/xsd/adlnav_v1p3',
    imsss: 'http://www.imsglobal.org/xsd/imsss',
  },
} as const;
/* eslint-enable no-restricted-syntax */

const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** SCORM identifiers: letters, digits, "-" and "_", starting with a letter. */
const ident = (prefix: string, id: string) => `${prefix}-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;

function selected(env: Environment, ids?: string[]): TrainingModule[] {
  const modules = ids ? env.modules.filter((m) => ids.includes(m.id)) : env.modules;
  if (!modules.length)
    throw new PackagingError('A SCORM package needs at least one training module');
  return modules;
}

/** imsmanifest.xml: one item and SCO per module; the files they share as one asset. */
export function scormManifest(
  env: Environment,
  version: ScormVersion,
  files: string[],
  moduleIds?: string[],
): string {
  const lang = env.settings.defaultLanguage;
  const L = (x: Record<string, string>) => xml(localize(x, lang));
  const modules = selected(env, moduleIds);
  const org = ident('org', env.id);
  const items = modules
    .map((m) => {
      const mastery =
        version === '1.2'
          ? `\n        <adlcp:masteryscore>${m.passMark}</adlcp:masteryscore>`
          : `\n        <imsss:sequencing>\n          <imsss:objectives>\n            <imsss:primaryObjective objectiveID="${ident('pass', m.id)}" satisfiedByMeasure="true">\n              <imsss:minNormalizedMeasure>${(m.passMark / 100).toFixed(2)}</imsss:minNormalizedMeasure>\n            </imsss:primaryObjective>\n          </imsss:objectives>\n        </imsss:sequencing>`;
      return `      <item identifier="${ident('item', m.id)}" identifierref="${ident('sco', m.id)}" parameters="?module=${encodeURIComponent(m.id)}">
        <title>${L(m.title)}</title>${mastery}
      </item>`;
    })
    .join('\n');
  const scoType = version === '1.2' ? 'adlcp:scormtype' : 'adlcp:scormType';
  const resources = modules
    .map(
      (
        m,
      ) => `    <resource identifier="${ident('sco', m.id)}" type="webcontent" ${scoType}="sco" href="index.html">
      <file href="index.html"/>
      <dependency identifierref="shared"/>
    </resource>`,
    )
    .join('\n');
  const shared = files
    .filter((f) => f !== 'index.html' && f !== 'imsmanifest.xml')
    .map((f) => `      <file href="${xml(f)}"/>`)
    .join('\n');
  const ns =
    version === '1.2'
      ? `xmlns="${NS['1.2'].cp}" xmlns:adlcp="${NS['1.2'].adlcp}"`
      : `xmlns="${NS['2004'].cp}" xmlns:adlcp="${NS['2004'].adlcp}" xmlns:adlseq="${NS['2004'].adlseq}" xmlns:adlnav="${NS['2004'].adlnav}" xmlns:imsss="${NS['2004'].imsss}"`;
  const schemaVersion = version === '1.2' ? '1.2' : '2004 4th Edition';
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${ident('evactis', env.id)}" version="1" ${ns}>
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>${schemaVersion}</schemaversion>
  </metadata>
  <organizations default="${org}">
    <organization identifier="${org}">
      <title>${L(env.title)}</title>
${items}
    </organization>
  </organizations>
  <resources>
${resources}
    <resource identifier="shared" type="webcontent" ${scoType}="asset">
${shared}
    </resource>
  </resources>
</manifest>
`;
}

/** The SCORM ZIP: imsmanifest.xml at the root, the player, environment.json and assets. */
export function scormPackage(env: Environment, o: ScormOptions): Uint8Array {
  const enc = new TextEncoder();
  const byPath = new Map<string, Uint8Array>();
  for (const f of [...o.player, ...o.assets]) {
    if (f.path.startsWith('/') || f.path.split('/').includes('..'))
      throw new PackagingError(`Unsafe path in package: ${f.path}`);
    byPath.set(f.path, f.data);
  }
  if (!byPath.has('index.html')) throw new PackagingError('The player files are missing');
  byPath.delete('files.json');
  byPath.set('environment.json', enc.encode(JSON.stringify(env)));
  const paths = [...byPath.keys()].sort();
  const manifest = scormManifest(env, o.version, paths, o.moduleIds);
  const files = [
    { name: 'imsmanifest.xml', data: enc.encode(manifest) },
    ...paths.map((p) => ({ name: p, data: byPath.get(p)! })),
  ];
  const bytes = files.reduce((n, f) => n + f.data.length + 2 * f.name.length + 76, 22);
  if (files.length > ZIP_LIMITS.files || bytes > ZIP_LIMITS.bytes)
    throw new PackagingError(
      `This environment is too large for a SCORM package (${files.length} files, ${Math.round(bytes / 1e6)} MB; limits 65,535 files and 4 GB)`,
    );
  return zip(files);
}
