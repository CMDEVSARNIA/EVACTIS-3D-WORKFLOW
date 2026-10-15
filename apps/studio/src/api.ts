/**
 * Typed bridge to Studio's Rust commands (apps/studio/src-tauri/src/studio.rs).
 * Components import from here only, so tests can replace this one module.
 */
import { Channel, convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';

export type AssetKind = 'panorama' | 'panorama-stereo' | 'video360' | 'glb' | 'splat';
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
  durationSec?: number;
  videoCodec?: string;
  splatFormat?: string;
  points?: number;
  capture: CaptureInfo;
  warnings: string[];
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

export interface MediaTools {
  ffmpegVersion: string | null;
  ffmpegRedistributable: boolean | null;
}

export function isCommandError(e: unknown): e is CommandError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e;
}

export const desktop = isTauri;

export const api = {
  createProject: (parent: string, name: string, manifest: string) =>
    invoke<ProjectInfo>('project_create', { parent, name, manifest }),
  openProject: (path: string) => invoke<ProjectInfo>('project_open', { path }),
  saveProject: (manifest: string) => invoke<void>('project_save', { manifest }),
  closeProject: () => invoke<void>('project_close'),
  listLibrary: () => invoke<{ assets: AssetRecord[]; problems: string[] }>('library_list'),
  importMedia: (paths: string[], onEvent: (e: ImportEvent) => void) => {
    const channel = new Channel<ImportEvent>();
    channel.onmessage = onEvent;
    return invoke<number>('media_import', { paths, onEvent: channel });
  },
  cancelImport: (job: number) => invoke<void>('media_cancel', { job }),
  removeAsset: (id: string) => invoke<void>('media_remove', { id }),
  mediaTools: () => invoke<MediaTools>('media_tools'),
  pickFolder: (title: string) => invoke<string | null>('pick_folder', { title }),
  pickProject: (title: string, filter: string) =>
    invoke<string | null>('pick_project', { title, filter }),
  pickMedia: (title: string, filter: string) => invoke<string[]>('pick_media', { title, filter }),
  smokeWorkspace: () => invoke<string>('smoke_workspace'),
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

export type StudioApi = typeof api;
