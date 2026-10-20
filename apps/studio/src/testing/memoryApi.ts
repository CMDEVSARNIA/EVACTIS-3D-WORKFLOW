/**
 * In-memory Studio backend for the browser end-to-end tests ONLY (`vite build --mode
 * e2e`; never part of the desktop app, see api.ts). It stands in for the Rust commands
 * so Playwright can drive the real UI in a browser.
 *
 * The media is real: the fixture script (e2e/fixtures/studio-project.mjs) imports the
 * test panoramas and plans with the Rust pipeline into `./project/media/…` and lists
 * them in `./project/fixtures.json`. "Importing" one here reveals that record, so the
 * Viewer in the preview loads tiles Studio really made.
 */
import type {
  AssetRecord,
  ImportEvent,
  ImportPurpose,
  MediaTools,
  PackageTools,
  ProjectInfo,
  Snapshot,
  StudioApi,
} from '../api.ts';

interface Fixture {
  path: string;
  purpose: ImportPurpose;
  asset: AssetRecord;
  /** Offered only by the file dialog with this title (e.g. the client-logo picker). */
  picker?: string;
}

const ROOT = 'project';

const state = {
  manifest: '',
  saves: 0,
  library: [] as AssetRecord[],
  snapshots: [] as (Snapshot & { manifest: string })[],
  fixtures: null as Fixture[] | null,
  /** Files "written" by exports, by path (read by the e2e tests). */
  exports: new Map<string, Uint8Array>(),
};

declare global {
  interface Window {
    /** Read by the e2e tests: the saved manifest and the number of saves. */
    __evxMemory?: typeof state;
  }
}
window.__evxMemory = state;

async function fixtures(): Promise<Fixture[]> {
  state.fixtures ??= (await (await fetch(`./${ROOT}/fixtures.json`)).json()) as Fixture[];
  return state.fixtures;
}

const info = (name: string): ProjectInfo => ({
  name,
  root: ROOT,
  manifestPath: `${ROOT}/${name}.evxproj`,
  manifest: state.manifest,
});

let clock = Date.parse('2026-10-19T12:00:00Z');
const now = () => new Date((clock += 1000)).toISOString();

function snapshot(label: string, kind: Snapshot['kind']): Snapshot | null {
  const last = state.snapshots[0];
  if (kind === 'auto' && last?.manifest === state.manifest) return null;
  const s = {
    id: `v${state.snapshots.length + 1}`,
    label,
    kind,
    createdAt: now(),
    bytes: state.manifest.length,
    manifest: state.manifest,
  };
  state.snapshots.unshift(s);
  return s;
}

const strip = ({ manifest: _m, ...s }: Snapshot & { manifest: string }): Snapshot => (void _m, s);

export const memoryApi: StudioApi = {
  createProject: async (_parent, name, manifest) => {
    state.manifest = manifest;
    snapshot('Opened', 'auto');
    return info(name);
  },
  // A fixture may ship a ready-made project (`./project/<name>.evxproj`, see
  // e2e/fixtures/studio-demo.mjs); "opening" it loads that manifest.
  openProject: async (path) => {
    const res = await fetch(`./${path}`);
    if (!res.ok) throw { code: 'project', message: `no project at ${path}` };
    state.manifest = await res.text();
    snapshot('Opened', 'auto');
    return info(path.replace(/^.*\//, '').replace(/\.evxproj$/, ''));
  },
  saveProject: async (manifest) => {
    state.manifest = manifest;
    state.saves++;
  },
  closeProject: async () => {},
  snapshot: async (label, auto) => snapshot(label, auto ? 'auto' : 'manual'),
  snapshots: async () => state.snapshots.map(strip),
  readSnapshot: async (id) => {
    const s = state.snapshots.find((x) => x.id === id);
    if (!s) throw { code: 'project', message: `no version ${id}` };
    return s.manifest;
  },
  restoreSnapshot: async (id, label) => {
    const s = state.snapshots.find((x) => x.id === id);
    if (!s) throw { code: 'project', message: `no version ${id}` };
    snapshot(label, 'before-restore');
    state.manifest = s.manifest;
    return s.manifest;
  },
  listLibrary: async () => ({ assets: [...state.library], problems: [] }),
  importMedia: async (paths: string[], onEvent: (e: ImportEvent) => void) => {
    const all = await fixtures();
    setTimeout(() => {
      let imported = 0;
      let failed = 0;
      paths.forEach((path, index) => {
        onEvent({ event: 'started', index, path });
        const f = all.find((x) => x.path === path);
        if (!f) {
          failed++;
          onEvent({ event: 'failed', index, path, code: 'invalid', message: 'unknown test file' });
          return;
        }
        onEvent({ event: 'progress', index, stage: 'finishing', done: 1, total: 1 });
        if (!state.library.some((a) => a.id === f.asset.id)) state.library.push(f.asset);
        imported++;
        onEvent({ event: 'imported', index, asset: f.asset });
      });
      onEvent({ event: 'finished', imported, failed, cancelled: false });
    }, 0);
    return 1;
  },
  cancelImport: async () => {},
  removeAsset: async (id) => {
    state.library = state.library.filter((a) => a.id !== id);
  },
  mediaTools: async (): Promise<MediaTools> => ({
    ffmpegVersion: 'test',
    ffmpegRedistributable: true,
  }),
  pickFolder: async () => '/e2e',
  pickProject: async () => {
    const res = await fetch(`./${ROOT}/project.json`);
    return res.ok ? `${ROOT}/${((await res.json()) as { file: string }).file}` : null;
  },
  // Every test file of that kind not yet in the library, in fixture order.
  pickMedia: async (title, _filter, purpose = 'scene') => {
    const open = (await fixtures()).filter(
      (f) => f.purpose === purpose && !state.library.some((a) => a.id === f.asset.id),
    );
    const named = open.filter((f) => f.picker === title);
    return (named.length ? named : open.filter((f) => !f.picker)).map((f) => f.path);
  },
  smokeWorkspace: async () => '/e2e',
  readMedia: async (path) => new Uint8Array(await (await fetch(`./${ROOT}/${path}`)).arrayBuffer()),
  pickSave: async (_title, defaultName) => `/e2e/exports/${defaultName}`,
  pickExportFolder: async () => '/e2e/exports',
  writeExport: async (path, bytes) => {
    state.exports.set(path, bytes);
    return path;
  },
  // A stand-in Viewer program; no NSIS, so the installer kind is offered as unavailable.
  packageTools: async (): Promise<PackageTools> => ({
    viewer: true,
    webview2: false,
    webview2Installer: false,
    nsis: false,
  }),
  packageBundled: async (name) => new TextEncoder().encode(`MZ test ${name}`),
  packageTarget: async (dir, outputs) => {
    for (const o of outputs) {
      const at = `${dir}/${o}`;
      if ([...state.exports.keys()].some((k) => k === at || k.startsWith(`${at}/`)))
        throw { code: 'exists', message: at };
    }
  },
  packageWrite: async (dir, path, bytes, append) => {
    const at = `${dir}/${path}`;
    const before = append ? (state.exports.get(at) ?? new Uint8Array()) : new Uint8Array();
    const next = new Uint8Array(before.length + bytes.length);
    next.set(before);
    next.set(bytes, before.length);
    state.exports.set(at, next);
  },
  packageDiscard: async (dir, outputs) => {
    for (const o of outputs)
      for (const k of [...state.exports.keys()])
        if (k === `${dir}/${o}` || k.startsWith(`${dir}/${o}/`)) state.exports.delete(k);
  },
  mediaSizes: async (paths) =>
    Promise.all(
      paths.map(async (p) => (await (await fetch(`./${ROOT}/${p}`)).arrayBuffer()).byteLength),
    ),
  packageWebView2: async () => {
    throw { code: 'missing-tool', message: 'WebView2 runtime' };
  },
  packageInstaller: async () => {
    throw { code: 'missing-tool', message: 'NSIS' };
  },
  joinPath: (dir, name) => `${dir}/${name}`,
  onFileDrop: async () => () => {},
  fileUrl: (root, relative) => `./${root}/${relative}`,
};
