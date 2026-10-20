/**
 * Making a delivery package in Studio (Package dialog): every kind is built by
 * @evactis-3dworkflow/packaging, written file by file into a folder the author picked,
 * with what Studio carries for it (the players, the Viewer program, NSIS). Nothing goes
 * over a network; a package that fails is removed again.
 */
import {
  buildDelivery,
  deliveredEnvironment,
  packageAssetPaths,
  SINGLE_FILE_WARN_BYTES,
  type ScormVersion,
} from '@evactis-3dworkflow/packaging';
import type { PackageKind } from '@evactis-3dworkflow/package-format';
import type { Environment } from '@evactis-3dworkflow/schema';
import type { PackageTools, StudioApi } from '../api.ts';
import { PRODUCER, quickStart } from './deliveryAssets.ts';
import { playerFiles } from './scormExport.ts';

/** In the order the dialog offers them. */
export const KINDS: PackageKind[] = [
  'installer',
  'evx',
  'portable',
  'intranet',
  'browser-folder',
  'single-file',
  'scorm',
];

/** Largest cube face kept in a single HTML file (pixels). */
export const SINGLE_FILE_MAX_FACE = 2048;
export { SINGLE_FILE_WARN_BYTES };

/** Top-level outputs a package creates in the chosen folder. */
export function outputsOf(kind: PackageKind, name: string): string[] {
  switch (kind) {
    case 'installer':
      return [name, `${name} Setup.exe`];
    case 'evx':
      return [`${name}.evx`];
    case 'single-file':
      return [`${name}.html`];
    case 'scorm':
      return [`${name}.zip`];
    default:
      return [name];
  }
}

/** The output the author is pointed to when the package is ready. */
export const mainOutput = (kind: PackageKind, name: string) => outputsOf(kind, name).at(-1)!;

/** What a kind needs that this Studio may lack, or null when it can be made. */
export function missingTool(kind: PackageKind, tools: PackageTools): 'viewer' | 'nsis' | null {
  if ((kind === 'installer' || kind === 'portable') && !tools.viewer) return 'viewer';
  if (kind === 'installer' && !tools.nsis) return 'nsis';
  return null;
}

/** Safety items left out of every package because nobody has confirmed them. */
export function unconfirmedSafety(env: Environment): number {
  return (
    env.equipment.filter((e) => !e.confirmed).length + env.routes.filter((r) => !r.confirmed).length
  );
}

/**
 * Estimated size of a single HTML file: the files it embeds (tile levels above the cap
 * dropped), base64-encoded, plus the player.
 */
export async function estimateSingleFile(
  env: Environment,
  sizes: StudioApi['mediaSizes'],
): Promise<number> {
  const paths = packageAssetPaths(deliveredEnvironment(env, SINGLE_FILE_MAX_FACE));
  const total = (await sizes(paths)).reduce((a, b) => a + b, 0);
  return Math.ceil((total * 4) / 3) + 4 * 1024 * 1024;
}

export interface MakeOptions {
  env: Environment;
  kind: PackageKind;
  /** File or folder name (safe for Windows; see safeName). */
  name: string;
  /** A folder picked for export in this session. */
  dir: string;
  passphrase?: string;
  kiosk: boolean;
  scormVersion: ScormVersion;
  tools: PackageTools;
  /** installer: carry Microsoft's offline WebView2 installer for PCs without the runtime. */
  withWebView2Installer: boolean;
  onProgress: (step: 'files' | 'runtime' | 'installer', done: number, total: number) => void;
}

const bytes = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`The bundled player file ${url} is missing`);
  return new Uint8Array(await r.arrayBuffer());
};

/** Makes the package; returns the path of what to hand over. */
export async function makePackage(api: StudioApi, o: MakeOptions): Promise<string> {
  const { kind, name, dir } = o;
  const outputs = outputsOf(kind, name);
  await api.packageTarget(dir, outputs);
  const desktop = kind === 'installer' || kind === 'portable';
  // A fixed runtime makes the installer independent of the PC; else, if asked, the setup
  // carries Microsoft's offline installer and runs it only where the runtime is missing.
  const webview2 = desktop && o.tools.webview2;
  const webview2Installer =
    kind === 'installer' && !webview2 && o.tools.webview2Installer && o.withWebView2Installer;
  try {
    const createdAt = new Date().toISOString();
    await buildDelivery(
      {
        env: o.env,
        kind,
        producer: PRODUCER,
        name,
        createdAt,
        passphrase: o.passphrase,
        kiosk: o.kiosk,
        readAsset: (p) => api.readMedia(p),
        quickStart: await quickStart(o.env, kind, createdAt, !!o.passphrase),
        player: kind === 'intranet' || kind === 'scorm' ? await playerFiles() : undefined,
        classic:
          kind === 'browser-folder' || kind === 'single-file'
            ? {
                js: await bytes('./player-classic/player.js'),
                css: await bytes('./player-classic/player.css'),
              }
            : undefined,
        viewerExe: desktop ? await api.packageBundled('viewer') : undefined,
        installerIcon: kind === 'installer' ? await api.packageBundled('viewer-icon') : undefined,
        webview2Copied: webview2,
        webview2Installer,
        scorm: kind === 'scorm' ? { version: o.scormVersion } : undefined,
        maxFaceSize: kind === 'single-file' ? SINGLE_FILE_MAX_FACE : undefined,
        onProgress: (d, n) => o.onProgress('files', d, n),
      },
      { write: (path, data, append) => api.packageWrite(dir, path, data, !!append) },
    );
    if (webview2 || webview2Installer) {
      o.onProgress('runtime', 0, 1);
      await api.packageWebView2(dir, name, webview2 ? 'runtime' : 'installer');
    }
    if (kind === 'installer') {
      o.onProgress('installer', 0, 1);
      return await api.packageInstaller(dir, name);
    }
    return api.joinPath(dir, mainOutput(kind, name));
  } catch (e) {
    await api.packageDiscard(dir, outputs).catch(() => undefined);
    throw e;
  }
}
