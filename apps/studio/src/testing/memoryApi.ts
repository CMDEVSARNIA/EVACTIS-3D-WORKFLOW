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
  ProjectInfo,
  Snapshot,
  StudioApi,
} from '../api.ts';

interface Fixture {
  path: string;
  purpose: ImportPurpose;
  asset: AssetRecord;
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
  pickMedia: async (_title, _filter, purpose = 'scene') =>
    (await fixtures())
      .filter((f) => f.purpose === purpose && !state.library.some((a) => a.id === f.asset.id))
      .map((f) => f.path),
  smokeWorkspace: async () => '/e2e',
  readMedia: async (path) => new Uint8Array(await (await fetch(`./${ROOT}/${path}`)).arrayBuffer()),
  pickSave: async (_title, defaultName) => `/e2e/exports/${defaultName}`,
  pickExportFolder: async () => '/e2e/exports',
  writeExport: async (path, bytes) => {
    state.exports.set(path, bytes);
    return path;
  },
  joinPath: (dir, name) => `${dir}/${name}`,
  onFileDrop: async () => () => {},
  fileUrl: (root, relative) => `./${root}/${relative}`,
};
