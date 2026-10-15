import { parseEnvironment } from '@evactis-3dworkflow/schema';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetRecord, FileDrop, ImportEvent, MediaTools, ProjectInfo } from './api.ts';
import { App } from './App.tsx';
import { describeError, formatBytes, newProjectManifest, projectId } from './format.ts';
import { STRINGS } from './i18n.ts';
import { Library } from './Library.tsx';

const mock = vi.hoisted(() => ({
  emit: null as null | ((e: ImportEvent) => void),
  drop: null as null | ((e: FileDrop) => void),
  api: {
    createProject: vi.fn(),
    openProject: vi.fn(),
    saveProject: vi.fn(),
    closeProject: vi.fn(async () => {}),
    listLibrary: vi.fn(),
    importMedia: vi.fn(),
    cancelImport: vi.fn(async () => {}),
    removeAsset: vi.fn(async () => {}),
    mediaTools: vi.fn(
      async (): Promise<MediaTools> => ({ ffmpegVersion: 'n8.0', ffmpegRedistributable: true }),
    ),
    onFileDrop: vi.fn(async (h: (e: FileDrop) => void) => {
      mock.drop = h;
      return () => {};
    }),
    pickFolder: vi.fn(),
    pickProject: vi.fn(),
    pickMedia: vi.fn(),
    smokeWorkspace: vi.fn(),
    fileUrl: (root: string, rel: string) => `asset://${root}/${rel}`,
  },
}));

vi.mock('./api.ts', async (orig) => ({
  ...(await orig<typeof import('./api.ts')>()),
  api: mock.api,
  desktop: () => true,
}));

const lobby: AssetRecord = {
  recordVersion: 1,
  id: '0123456789abcdef',
  kind: 'panorama',
  name: 'Lobby east',
  originalFileName: 'Lobby east.jpg',
  sha256: 'ab'.repeat(32),
  bytes: 52_428_800,
  importedAt: '2026-10-14T14:05:11Z',
  source: 'media/0123456789abcdef/source.jpg',
  preview: 'media/0123456789abcdef/preview.jpg',
  thumbnail: 'media/0123456789abcdef/thumb.jpg',
  tiles: {
    basePath: 'media/0123456789abcdef/tiles',
    tileSize: 512,
    levels: [{ size: 512 }, { size: 1024 }],
    format: 'jpg',
  },
  width: 4096,
  height: 2048,
  layout: 'mono',
  hdr: false,
  capture: {
    captureDate: '2026-09-30',
    captureTime: '14:05:11',
    camera: 'Insta360 X4',
    gps: { lat: -33.865, lon: -70.5 },
  },
  warnings: ['low-resolution: 4096 px wide; at least 6000 px is recommended'],
};

const project: ProjectInfo = {
  name: 'Riverside',
  root: '/data/Riverside',
  manifestPath: '/data/Riverside/Riverside.evxproj',
  manifest: newProjectManifest('Riverside'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.drop = null;
  mock.api.listLibrary.mockResolvedValue({ assets: [lobby], problems: [] });
  mock.api.importMedia.mockImplementation(
    async (_paths: string[], onEvent: (e: ImportEvent) => void) => {
      mock.emit = onEvent;
      return 7;
    },
  );
});
afterEach(cleanup);

const en = STRINGS.en;

describe('media library', () => {
  it('lists assets and shows metadata for the selected one', async () => {
    render(<Library t={en} lang="en" project={project} onClose={() => {}} />);
    const card = await screen.findByRole('button', { name: /Lobby east/ });
    expect(card.textContent).toContain('Panorama · 4096 × 2048');
    expect(card.querySelector('img')?.getAttribute('src')).toBe(
      'asset:///data/Riverside/media/0123456789abcdef/thumb.jpg',
    );
    fireEvent.click(card);
    const details = screen.getByRole('complementary', { name: en.details });
    expect(details.textContent).toContain('2026-09-30 14:05:11');
    expect(details.textContent).toContain('Insta360 X4');
    expect(details.textContent).toContain('-33.86500, -70.50000');
    expect(details.textContent).toContain('512 · 1024');
    expect(details.textContent).toContain('50 MB');
    expect(details.textContent).toContain('Low resolution (4,096 px wide)');
  });

  it('imports with live progress, localised errors and a summary', async () => {
    mock.api.pickMedia.mockResolvedValue(['/in/a.jpg', 'C:\\in\\b.png']);
    render(<Library t={en} lang="en" project={project} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: en.importMedia }));
    await waitFor(() =>
      expect(mock.api.importMedia).toHaveBeenCalledWith(
        ['/in/a.jpg', 'C:\\in\\b.png'],
        expect.any(Function),
      ),
    );
    const region = screen.getByRole('region', { name: en.importing });
    expect(within(region).getByText('b.png')).toBeTruthy();

    act(() => mock.emit!({ event: 'started', index: 0, path: '/in/a.jpg' }));
    act(() => mock.emit!({ event: 'progress', index: 0, stage: 'tiling', done: 21, total: 42 }));
    expect(within(region).getByText(en.stages.tiling)).toBeTruthy();
    expect(within(region).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');

    act(() =>
      mock.emit!({
        event: 'imported',
        index: 0,
        asset: { ...lobby, id: 'fedcba9876543210', name: 'a' },
      }),
    );
    act(() =>
      mock.emit!({
        event: 'failed',
        index: 1,
        path: 'C:\\in\\b.png',
        code: 'invalid',
        message: '1600×1200 is not a 360° panorama',
      }),
    );
    expect(within(region).getByRole('alert').textContent).toBe(
      en.errors.invalid + '1600×1200 is not a 360° panorama',
    );
    expect(within(region).getByRole('button', { name: en.cancelImport })).toBeTruthy();

    act(() => mock.emit!({ event: 'finished', imported: 1, failed: 1, cancelled: false }));
    expect(within(region).getByRole('status').textContent).toBe('1 imported, 1 not imported');
    expect(within(region).queryByRole('button', { name: en.cancelImport })).toBeNull();
  });

  it('imports files dropped on the window', async () => {
    const { container } = render(<Library t={en} lang="en" project={project} onClose={() => {}} />);
    await waitFor(() => expect(mock.drop).not.toBeNull());
    act(() => mock.drop!({ type: 'over' }));
    expect(container.querySelector('.evx-dropzone--active')).not.toBeNull();
    act(() => mock.drop!({ type: 'drop', paths: ['/in/stairs.hdr'] }));
    expect(container.querySelector('.evx-dropzone--active')).toBeNull();
    await waitFor(() =>
      expect(mock.api.importMedia).toHaveBeenCalledWith(['/in/stairs.hdr'], expect.any(Function)),
    );
  });

  it('cancels a running import', async () => {
    mock.api.pickMedia.mockResolvedValue(['/in/a.jpg']);
    render(<Library t={en} lang="en" project={project} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: en.importMedia }));
    fireEvent.click(await screen.findByRole('button', { name: en.cancelImport }));
    expect(mock.api.cancelImport).toHaveBeenCalledWith(7);
  });

  it('removes only after confirmation', async () => {
    render(<Library t={en} lang="en" project={project} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Lobby east/ }));
    fireEvent.click(screen.getByRole('button', { name: en.remove }));
    expect(mock.api.removeAsset).not.toHaveBeenCalled();
    expect(screen.getByText(en.removeConfirm)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.remove }));
    await waitFor(() => expect(mock.api.removeAsset).toHaveBeenCalledWith(lobby.id));
  });

  it('speaks French', async () => {
    const fr = STRINGS.fr;
    render(<Library t={fr} lang="fr" project={project} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Lobby east/ }));
    expect(screen.getByRole('button', { name: fr.importMedia })).toBeTruthy();
    expect(screen.getByRole('complementary').textContent).toContain('50 Mo');
    expect(screen.getByRole('complementary').textContent).toMatch(/Basse résolution \(4\s096 px/);
  });

  it('warns when the video converter is missing', async () => {
    mock.api.mediaTools.mockResolvedValueOnce({ ffmpegVersion: null, ffmpegRedistributable: null });
    render(<Library t={en} lang="en" project={project} onClose={() => {}} />);
    expect(await screen.findByText(en.noFfmpeg)).toBeTruthy();
  });
});

describe('projects', () => {
  it('creates a project with a valid empty environment and opens its library', async () => {
    mock.api.pickFolder.mockResolvedValue('/data');
    mock.api.createProject.mockImplementation(
      async (_p: string, name: string, manifest: string) => ({ ...project, name, manifest }),
    );
    render(<App info={null} />);
    fireEvent.click(screen.getByRole('button', { name: en.newProject }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(en.projectName), {
      target: { value: 'Usine Rivière – A' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.chooseFolder }));
    await waitFor(() =>
      expect(within(dialog).getByTestId('new-project-parent').textContent).toBe('/data'),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: en.create }));
    await waitFor(() => expect(mock.api.createProject).toHaveBeenCalled());
    const [parent, name, manifest] = mock.api.createProject.mock.calls[0]!;
    expect([parent, name]).toEqual(['/data', 'Usine Rivière – A']);
    const env = parseEnvironment(JSON.parse(manifest as string));
    expect(env.success && env.environment.id).toBe('Usine-Riviere-A');
    expect(await screen.findByTestId('project-name')).toBeTruthy();
  });

  it('refuses a project whose manifest is not a valid environment', async () => {
    mock.api.pickProject.mockResolvedValue('/data/Bad/Bad.evxproj');
    mock.api.openProject.mockResolvedValue({ ...project, manifest: '{"schemaVersion":1}' });
    render(<App info={null} />);
    fireEvent.click(screen.getByRole('button', { name: en.openProject }));
    expect((await screen.findByRole('alert')).textContent).toContain(en.invalidManifest);
    expect(mock.api.closeProject).toHaveBeenCalled();
    expect(screen.queryByTestId('project-name')).toBeNull();
  });

  it('shows Rust errors in the user language', async () => {
    mock.api.pickProject.mockResolvedValue('/nowhere');
    mock.api.openProject.mockRejectedValue({ code: 'project', message: '/nowhere does not exist' });
    render(<App info={null} />);
    fireEvent.click(screen.getByRole('button', { name: en.openProject }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      en.errors.project + '/nowhere does not exist',
    );
  });
});

describe('formatting helpers', () => {
  it('derives schema-safe IDs and readable sizes', () => {
    expect(projectId('Usine Rivière – Bâtiment A')).toBe('Usine-Riviere-Batiment-A');
    expect(projectId('—')).toBe('project');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(describeError(en, { code: 'duplicate', message: 'x' })).toBe(en.errors.duplicate);
    expect(describeError(en, new Error('boom'))).toBe(en.errors.unknown + 'Error: boom');
  });
});
