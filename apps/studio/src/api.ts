/**
 * Typed bridge to Studio's Rust commands (apps/studio/src-tauri/src/studio.rs).
 * Components import from here only, so tests can replace this one module.
 */
import { Channel, convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';

export type AssetKind =
  | 'panorama'
  | 'panorama-stereo'
  | 'video360'
  | 'glb'
  | 'splat'
  | 'floor-plan'
  | 'audio'
  | 'document'
  | 'photo';
/**
 * What an import is for: scenes (the default), floor plans (any aspect ratio), sounds,
 * PDF documents or album photos. It decides how the file is checked and processed.
 */
export type ImportPurpose = 'scene' | 'floor-plan' | 'audio' | 'document' | 'photo';
/** Assets that can become scenes. */
export const SCENE_KINDS: readonly AssetKind[] = [
  'panorama',
  'panorama-stereo',
  'video360',
  'glb',
  'splat',
];
export type ImageLayout = 'mono' | 'stereo-top-bottom' | 'stereo-side-by-side';
export type Stage =
  | 'validating'
  | 'copying'
  | 'decoding'
  | 'previews'
  | 'tiling'
  | 'transcoding'
  | 'finishing';

export interface TileSet {
  basePath: string;
  tileSize: number;
  levels: { size: number }[];
  format: string;
}

export interface CaptureInfo {
  captureDate?: string;
  captureTime?: string;
  gps?: { lat: number; lon: number };
  camera?: string;
}

/** Mirrors evx_media::library::AssetRecord (media/<id>/asset.json). */
export interface AssetRecord {
  recordVersion: number;
  id: string;
  kind: AssetKind;
  name: string;
  originalFileName: string;
  sha256: string;
  bytes: number;
  importedAt: string;
  source: string;
  playback?: string;
  preview?: string;
  thumbnail?: string;
  tiles?: TileSet;
  width?: number;
  height?: number;
  layout?: ImageLayout;
  hdr: boolean;
  /** HDR panoramas: log-luminance map for adaptive exposure. */
  luminance?: string;
  durationSec?: number;
  videoCodec?: string;
  splatFormat?: string;
  points?: number;
  capture: CaptureInfo;
  warnings: string[];
}

/** Mirrors evx_core::history::Snapshot: one saved version of the manifest. */
export interface Snapshot {
  id: string;
  label: string;
  kind: 'auto' | 'manual' | 'before-restore';
  createdAt: string;
  bytes: number;
}

export interface ProjectInfo {
  name: string;
  root: string;
  manifestPath: string;
  manifest: string;
}

export interface CommandError {
  code: string;
  message: string;
}

export type ImportEvent =
  | { event: 'started'; index: number; path: string }
  | { event: 'progress'; index: number; stage: Stage; done: number; total: number }
  | { event: 'imported'; index: number; asset: AssetRecord }
  | { event: 'failed'; index: number; path: string; code: string; message: string }
  | { event: 'finished'; imported: number; failed: number; cancelled: boolean };

export type FileDrop = { type: 'over' } | { type: 'leave' } | { type: 'drop'; paths: string[] };

export interface PackageTools {
  viewer: boolean;
  /** A fixed WebView2 runtime (portable viewers and installers carry it). */
  webview2: boolean;
  /** Microsoft's offline WebView2 installer (installers run it on PCs without one). */
  webview2Installer: boolean;
  nsis: boolean;
}

export interface MediaTools {
  ffmpegVersion: string | null;
  ffmpegRedistributable: boolean | null;
}

export function isCommandError(e: unknown): e is CommandError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e;
}

/** The browser e2e build (`vite build --mode e2e`) runs on an in-memory backend. */
const E2E = import.meta.env.MODE === 'e2e';

export const desktop = E2E ? () => true : isTauri;

const tauriApi = {
  createProject: (parent: string, name: string, manifest: string) =>
    invoke<ProjectInfo>('project_create', { parent, name, manifest }),
  openProject: (path: string) => invoke<ProjectInfo>('project_open', { path }),
  saveProject: (manifest: string) => invoke<void>('project_save', { manifest }),
  closeProject: () => invoke<void>('project_close'),
  /** Saves a version of the project as last saved; null when an automatic one is unchanged. */
  snapshot: (label: string, auto: boolean) =>
    invoke<Snapshot | null>('project_snapshot', { label, auto }),
  snapshots: () => invoke<Snapshot[]>('project_snapshots'),
  readSnapshot: (id: string) => invoke<string>('project_snapshot_read', { id }),
  /** Replaces the project with a version (after saving a "before restore" one). */
  restoreSnapshot: (id: string, label: string) => invoke<string>('project_restore', { id, label }),
  listLibrary: () => invoke<{ assets: AssetRecord[]; problems: string[] }>('library_list'),
  importMedia: (
    paths: string[],
    onEvent: (e: ImportEvent) => void,
    purpose: ImportPurpose = 'scene',
  ) => {
    const channel = new Channel<ImportEvent>();
    channel.onmessage = onEvent;
    return invoke<number>('media_import', { paths, purpose, onEvent: channel });
  },
  cancelImport: (job: number) => invoke<void>('media_cancel', { job }),
  removeAsset: (id: string) => invoke<void>('media_remove', { id }),
  mediaTools: () => invoke<MediaTools>('media_tools'),
  pickFolder: (title: string) => invoke<string | null>('pick_folder', { title }),
  pickProject: (title: string, filter: string) =>
    invoke<string | null>('pick_project', { title, filter }),
  pickMedia: (title: string, filter: string, purpose: ImportPurpose = 'scene') =>
    invoke<string[]>('pick_media', { title, filter, purpose }),
  smokeWorkspace: () => invoke<string>('smoke_workspace'),
  /** Bytes of a project media file (e.g. a floor plan, for printing). */
  readMedia: async (path: string) =>
    new Uint8Array(await invoke<ArrayBuffer>('project_read_media', { path })),
  /** Save dialog for an export; returns the chosen path (now writable by writeExport). */
  pickSave: (title: string, defaultName: string, filter: string, extension: string) =>
    invoke<string | null>('pick_save', { title, defaultName, filter, extension }),
  /** Folder dialog for a multi-file export. */
  pickExportFolder: (title: string) => invoke<string | null>('pick_export_folder', { title }),
  /** Writes an export to a path the user chose (raw bytes, no base64). */
  writeExport: (path: string, bytes: Uint8Array) =>
    invoke<string>('export_file', bytes, { headers: { 'x-evx-path': encodeURIComponent(path) } }),
  /** What Studio can bring to desktop packages (Viewer program, WebView2 runtime, NSIS). */
  packageTools: () => invoke<PackageTools>('package_tools'),
  /** A file bundled with Studio: the Viewer program or its icon. */
  packageBundled: async (name: 'viewer' | 'viewer-icon') =>
    new Uint8Array(await invoke<ArrayBuffer>('package_bundled', { name })),
  /** Fails with code "exists" when one of the outputs is already in the folder. */
  packageTarget: (dir: string, outputs: string[]) =>
    invoke<void>('package_target', { dir, outputs }),
  /** Writes (or appends to) a package file inside a folder picked for export. */
  packageWrite: (dir: string, path: string, bytes: Uint8Array, append: boolean) =>
    invoke<void>('package_write', bytes, {
      headers: {
        'x-evx-dir': encodeURIComponent(dir),
        'x-evx-path': encodeURIComponent(path),
        'x-evx-append': append ? '1' : '0',
      },
    }),
  /** Removes a failed package's outputs (only what this session wrote). */
  packageDiscard: (dir: string, outputs: string[]) =>
    invoke<void>('package_discard', { dir, outputs }),
  /** Sizes in bytes of project media files. */
  mediaSizes: (paths: string[]) => invoke<number[]>('media_sizes', { paths }),
  /** Copies the bundled WebView2 runtime (webview2/) or offline installer into <dir>/<folder>/. */
  packageWebView2: (dir: string, folder: string, what: 'runtime' | 'installer') =>
    invoke<void>('package_webview2', { dir, folder, what }),
  /** Compiles <dir>/<folder>/installer.nsi into "<folder> Setup.exe"; returns its path. */
  packageInstaller: (dir: string, folder: string) =>
    invoke<string>('package_installer', { dir, folder }),
  /** Joins an export folder and a file name the way the platform does. */
  joinPath: (dir: string, name: string) =>
    `${dir}${dir.includes('\\') && !dir.includes('/') ? '\\' : '/'}${name}`,
  /** Files dragged onto the window; Tauri delivers their real paths. Returns unlisten. */
  onFileDrop: (handler: (e: FileDrop) => void) =>
    getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === 'drop') handler({ type: 'drop', paths: p.paths });
      else handler({ type: p.type === 'leave' ? 'leave' : 'over' });
    }),
  /** URL for a project file through the asset protocol (scoped to media/ by Rust). */
  fileUrl: (root: string, relative: string) => {
    const sep = root.includes('\\') ? '\\' : '/';
    return convertFileSrc(`${root}${sep}${relative.split('/').join(sep)}`);
  },
};

export type StudioApi = typeof tauriApi;

// Statically false in every other build, so the test backend is not even bundled.
export const api: StudioApi = E2E ? (await import('./testing/memoryApi.ts')).memoryApi : tauriApi;
