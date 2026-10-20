/**
 * Phase 10 delivery packages, built locally from an environment and its project files.
 * Every package carries the integrity manifest (SHA-256 of every file, verified when the
 * environment opens), a version/date stamp, the bilingual quick-start PDF, a README and
 * the notice that it runs fully offline; with a passphrase, the environment's files are
 * encrypted (Argon2id + AES-256-GCM, decrypted in memory only).
 *
 *   intranet        static files for the client's web server (strict CSP, no requests out)
 *   browser-folder  opens index.html from disk: data in script chunks, no fetch (file://)
 *   single-file     one HTML file; tiles capped at a resolution, size reported for a warning
 *   evx             one file for an installed 3DWORKFLOW Viewer (double-click opens it)
 *   portable        the Viewer and the .evx in a folder: runs from USB, no install
 *   installer       the same, wrapped in a setup .exe (NSIS) with a Start menu shortcut
 *   scorm           the player and environment for an LMS (Phase 8), now with the above
 */
import {
  MANIFEST_PATH,
  Packer,
  QUICK_START_NAME,
  toBase64,
  type PackageKind,
  type PackageManifest,
} from '@evactis-3dworkflow/package-format';
import { localize, type Environment } from '@evactis-3dworkflow/schema';
import { packageAssetPaths } from './assets.ts';
import { readme } from './readme.ts';
import { scormManifest, type ScormVersion } from './scorm.ts';
import { ZipStream } from './zipstream.ts';

export interface PackageFile {
  path: string;
  data: Uint8Array;
}

/** Where a package is written: files relative to the chosen output folder. */
export interface DeliverySink {
  /** Writes (or appends to, with `append`) a file, creating folders as needed. */
  write(path: string, data: Uint8Array, append?: boolean): Promise<void>;
}

export interface DeliveryInput {
  env: Environment;
  kind: PackageKind;
  /** e.g. "EVACTIS 3DWORKFLOW Studio 0.1.0" (part of the stamp). */
  producer: string;
  /** The package's name: its folder or file name (without extension). */
  name: string;
  readAsset(path: string): Promise<Uint8Array>;
  /** The quick-start PDF for this package (packages/print `quickStartPdf`). */
  quickStart: Uint8Array;
  passphrase?: string;
  createdAt?: string;
  /** Kiosk deployment (the skin's kiosk layout, assumption 40). */
  kiosk?: boolean;
  /** intranet, scorm: the module player (packages/viewer/player-dist, files.json). */
  player?: PackageFile[];
  /** browser-folder, single-file: the classic player (one script, one stylesheet). */
  classic?: { js: Uint8Array; css: Uint8Array };
  /** portable, installer: the Viewer executable and an optional fixed WebView2 runtime. */
  viewerExe?: Uint8Array;
  webview2?: PackageFile[];
  scorm?: { version: ScormVersion; moduleIds?: string[] };
  /** single-file: largest cube-face tile level kept (pixels; default 2048). */
  maxFaceSize?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface DeliveryResult {
  manifest: PackageManifest;
  /** What was written, relative to the output folder. */
  outputs: string[];
  bytes: number;
}

export { QUICK_START_NAME };

export class DeliveryError extends Error {
  override name = 'DeliveryError';
}

export const EVX_NAME = 'environment.evx';
export const VIEWER_EXE = 'EVACTIS-3DWORKFLOW-Viewer.exe';
/** Above this a single HTML file gets slow to open; Studio asks before making one. */
export const SINGLE_FILE_WARN_BYTES = 50 * 1024 * 1024;

const enc = (s: string) => new TextEncoder().encode(s);

/** Windows-safe file name from a title (also used for the Start menu shortcut). */
export function safeName(s: string): string {
  const n = s
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return n.slice(0, 80) || 'Environment';
}

/** The environment as delivered: single-file packages drop tile levels above the cap. */
export function deliveredEnvironment(env: Environment, maxFaceSize?: number): Environment {
  if (!maxFaceSize) return env;
  const copy = structuredClone(env);
  for (const s of copy.scenes) {
    const m = s.media;
    if (m.type !== 'equirect' || !m.tiles) continue;
    const keep = m.tiles.levels.filter((l) => l.size <= maxFaceSize);
    m.tiles.levels = keep.length ? keep : m.tiles.levels.slice(0, 1);
  }
  return copy;
}

/** Builds one package into the sink. */
export async function buildDelivery(i: DeliveryInput, sink: DeliverySink): Promise<DeliveryResult> {
  const env = deliveredEnvironment(
    i.env,
    i.kind === 'single-file' ? (i.maxFaceSize ?? 2048) : undefined,
  );
  const createdAt = i.createdAt ?? new Date().toISOString();
  const info = { id: env.id, title: env.title, updatedAt: env.updatedAt };
  const packer = await Packer.create({
    kind: i.kind,
    producer: i.producer,
    environment: info,
    createdAt,
    passphrase: i.passphrase,
    kiosk: i.kiosk,
  });
  const notes = readme(env, i.kind, createdAt, i.producer, i.passphrase !== undefined);
  const assets = packageAssetPaths(env);
  const total = assets.length + 1;
  let done = 0;
  const step = () => i.onProgress?.(++done, total);

  /** The environment and its files, then the readable extras, through the packer. */
  async function* content(): AsyncGenerator<{ path: string; data: Uint8Array }> {
    const stored = await packer.add('environment.json', enc(JSON.stringify(env)));
    step();
    yield stored;
    for (const p of assets) {
      let data: Uint8Array;
      try {
        data = await i.readAsset(p);
      } catch {
        throw new DeliveryError(`A file the environment uses is missing from the project: ${p}`);
      }
      yield await packer.add(p, data);
      step();
    }
    yield await packer.add(QUICK_START_NAME, i.quickStart, false);
    yield await packer.add('README.txt', enc(notes), false);
  }

  const outputs: string[] = [];
  let bytes = 0;
  const out = async (path: string, data: Uint8Array, append = false) => {
    await sink.write(path, data, append);
    if (!append || !outputs.includes(path)) outputs.push(path);
    bytes += data.length;
  };

  switch (i.kind) {
    case 'intranet':
    case 'scorm': {
      if (!i.player?.length) throw new DeliveryError('The player files are missing');
      const files: PackageFile[] = [];
      const keep = (f: PackageFile) =>
        i.kind === 'intranet' ? out(`${i.name}/${f.path}`, f.data) : void files.push(f);
      for (const f of i.player.filter((f) => f.path !== 'files.json'))
        await keep(await packer.add(f.path, f.data, false));
      for await (const f of content()) await keep(f);
      const { files: last, manifest } = await packer.finish();
      if (i.kind === 'intranet') {
        for (const f of last) await keep(f);
        return { manifest, outputs, bytes };
      }
      files.push(...last);
      // SCORM: imsmanifest.xml first (some LMSs expect it early), then everything else.
      if (!i.scorm) throw new DeliveryError('Choose a SCORM version');
      const zip = new ZipStream();
      const target = `${i.name}.zip`;
      const xmlText = scormManifest(
        i.env,
        i.scorm.version,
        files.map((f) => f.path).sort(),
        i.scorm.moduleIds,
      );
      await out(target, zip.add('imsmanifest.xml', enc(xmlText)));
      for (const f of files) await out(target, zip.add(f.path, f.data), true);
      await out(target, zip.finish(), true);
      return { manifest, outputs, bytes };
    }

    case 'browser-folder':
    case 'single-file': {
      if (!i.classic) throw new DeliveryError('The classic player is missing');
      const chunks: { path: string; data: Uint8Array }[] = [];
      for await (const f of content()) chunks.push(f);
      const { files: last, manifest } = await packer.finish();
      chunks.push(...last.filter((f) => f.path !== MANIFEST_PATH));
      const manifestBytes = last.find((f) => f.path === MANIFEST_PATH)!.data;
      const title = localize(env.title, env.settings.defaultLanguage);
      if (i.kind === 'browser-folder') {
        const map: Record<string, string> = {};
        for (const [n, f] of chunks.entries()) {
          if (f.path === QUICK_START_NAME || f.path === 'README.txt') {
            await out(`${i.name}/${f.path}`, f.data);
            continue;
          }
          const file = `evx-data/${String(n + 1).padStart(6, '0')}.js`;
          map[f.path] = file;
          await out(
            `${i.name}/${file}`,
            enc(`__evxChunk(${JSON.stringify(f.path)},"${toBase64(f.data)}");`),
          );
        }
        // The quick-start PDF is also reachable from the info panel.
        map[QUICK_START_NAME] = `evx-data/quick-start.js`;
        await out(
          `${i.name}/evx-data/quick-start.js`,
          enc(`__evxChunk(${JSON.stringify(QUICK_START_NAME)},"${toBase64(i.quickStart)}");`),
        );
        await out(
          `${i.name}/evx-manifest.js`,
          enc(`__evxManifest("${toBase64(manifestBytes)}",${JSON.stringify(map)});`),
        );
        await out(`${i.name}/${MANIFEST_PATH}`, manifestBytes);
        await out(`${i.name}/player.js`, i.classic.js);
        await out(`${i.name}/player.css`, i.classic.css);
        await out(`${i.name}/index.html`, enc(folderHtml(title, env.settings.defaultLanguage)));
        return { manifest, outputs, bytes };
      }
      const html = await singleFileHtml(
        title,
        env.settings.defaultLanguage,
        i,
        manifestBytes,
        chunks,
      );
      await out(`${i.name}.html`, html);
      return { manifest, outputs, bytes };
    }

    case 'evx':
    case 'portable':
    case 'installer': {
      const zip = new ZipStream();
      const dir = i.kind === 'evx' ? '' : `${i.name}/`;
      const target = i.kind === 'evx' ? `${i.name}.evx` : `${dir}${EVX_NAME}`;
      let first = true;
      const put = async (path: string, data: Uint8Array) => {
        await out(target, zip.add(path, data), !first);
        first = false;
      };
      for await (const f of content()) await put(f.path, f.data);
      const { files: last, manifest } = await packer.finish();
      for (const f of last) await put(f.path, f.data);
      await out(target, zip.finish(), true);
      if (i.kind === 'evx') return { manifest, outputs, bytes };

      if (!i.viewerExe) throw new DeliveryError('The 3DWORKFLOW Viewer program is missing');
      await out(`${dir}${VIEWER_EXE}`, i.viewerExe);
      await out(
        `${dir}viewer.json`,
        enc(
          JSON.stringify(
            { environment: EVX_NAME, kiosk: !!i.kiosk, portable: i.kind === 'portable' },
            null,
            2,
          ),
        ),
      );
      await out(`${dir}${QUICK_START_NAME}`, i.quickStart);
      await out(`${dir}README.txt`, enc(notes));
      for (const f of i.webview2 ?? []) await out(`${dir}webview2/${f.path}`, f.data);
      if (i.kind === 'installer') await out(`${dir}installer.nsi`, enc(nsisScript(i, title(env))));
      return { manifest, outputs, bytes };
    }
  }
}

const title = (env: Environment) => localize(env.title, env.settings.defaultLanguage);

/** CSP for packages opened from disk or served by an intranet: nothing leaves the page. */
export const PACKAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' blob: data:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function folderHtml(title: string, lang: string): string {
  return `<!doctype html>
<html lang="${esc(lang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${PACKAGE_CSP}" />
    <title>${esc(title)}</title>
    <link rel="stylesheet" href="player.css" />
  </head>
  <body>
    <main id="stage" class="player-stage"></main>
    <script src="player.js"></script>
    <script src="evx-manifest.js"></script>
  </body>
</html>
`;
}

async function sha256Base64(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc(text));
  return toBase64(new Uint8Array(d));
}

/**
 * One HTML file: the classic player inline (allowed by its hash), data in non-executing
 * `application/octet-stream` blocks, the manifest and quick start likewise.
 */
async function singleFileHtml(
  title: string,
  lang: string,
  i: DeliveryInput,
  manifestBytes: Uint8Array,
  chunks: { path: string; data: Uint8Array }[],
): Promise<Uint8Array> {
  const js = new TextDecoder().decode(i.classic!.js).replace(/<\/script/gi, '<\\/script');
  const css = new TextDecoder().decode(i.classic!.css).replace(/<\/style/gi, '<\\/style');
  const csp = PACKAGE_CSP.replace(
    "script-src 'self'",
    `script-src 'sha256-${await sha256Base64(js)}'`,
  );
  const blocks = [
    `<script type="application/octet-stream" id="evx-manifest">${toBase64(manifestBytes)}</script>`,
    ...chunks
      .filter((c) => c.path !== 'README.txt')
      .map(
        (c) =>
          `<script type="application/octet-stream" data-path="${esc(c.path)}">${toBase64(c.data)}</script>`,
      ),
  ];
  return enc(`<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>${esc(title)}</title>
<style>${css}</style>
</head>
<body>
<main id="stage" class="player-stage"></main>
${blocks.join('\n')}
<script>${js}</script>
</body>
</html>
`);
}

/** NSIS script for the setup .exe: per-user install, Start menu shortcut, uninstaller. */
export function nsisScript(i: DeliveryInput, envTitle: string): string {
  const facility = safeName(envTitle);
  const shortcut = `Evactis – ${facility}`;
  const id = `EVACTIS-3DWORKFLOW-${i.env.id}`.replace(/[^A-Za-z0-9_-]/g, '_');
  const q = (s: string) => s.replace(/\$/g, '$$$$').replace(/"/g, '$\\"');
  return `; EVACTIS 3DWORKFLOW Viewer with "${q(envTitle)}" — generated by ${q(i.producer)}.
; Installs for the current user (no administrator rights), offline.
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user
Name "${q(shortcut)}"
OutFile "../${q(i.name)} Setup.exe"
InstallDir "$LOCALAPPDATA\\Programs\\Evactis\\${q(facility)}"
ShowInstDetails nevershow
!include "MUI2.nsh"
!define MUI_ICON "\${NSISDIR}/Contrib/Graphics/Icons/modern-install.ico"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "French"

Section "Install"
  SetOutPath "$INSTDIR"
  File "${VIEWER_EXE}"
  File "${EVX_NAME}"
  File "viewer.json"
  File "README.txt"
  File "${QUICK_START_NAME}"
${i.webview2?.length ? '  File /r "webview2"\n' : ''}  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  CreateShortCut "$SMPROGRAMS\\${q(shortcut)}.lnk" "$INSTDIR\\${VIEWER_EXE}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${id}" "DisplayName" "${q(shortcut)}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${id}" "Publisher" "Evactis"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${id}" "UninstallString" '"$INSTDIR\\Uninstall.exe"'
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${id}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${id}" "NoModify" 1
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${id}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\\${q(shortcut)}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${id}"
SectionEnd
`;
}
