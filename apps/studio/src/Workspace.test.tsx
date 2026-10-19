import { parseEnvironment, type Environment } from '@evactis-3dworkflow/schema';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetRecord, ProjectInfo } from './api.ts';
import { newProjectManifest } from './format.ts';
import { STRINGS } from './i18n.ts';
import { Workspace } from './Workspace.tsx';

const mock = vi.hoisted(() => ({
  api: {
    saveProject: vi.fn<(json: string) => Promise<void>>(async () => {}),
    snapshot: vi.fn(async () => null),
    snapshots: vi.fn(async () => []),
    listLibrary: vi.fn(async () => ({ assets: [] as AssetRecord[], problems: [] })),
    mediaTools: vi.fn(async () => ({ ffmpegVersion: 'n8.0', ffmpegRedistributable: true })),
    onFileDrop: vi.fn(async () => () => {}),
    fileUrl: (root: string, rel: string) => `asset://${root}/${rel}`,
  },
}));
vi.mock('./api.ts', async (orig) => ({
  ...(await orig<typeof import('./api.ts')>()),
  api: mock.api,
  desktop: () => true,
}));
// The live preview needs WebGL; it is covered by the Playwright tests.
vi.mock('./editor/Preview.tsx', () => ({ Preview: () => <div data-testid="preview" /> }));

const en = STRINGS.en;
const project: ProjectInfo = {
  name: 'Riverside',
  root: '/data/Riverside',
  manifestPath: '/data/Riverside/Riverside.evxproj',
  manifest: newProjectManifest('Riverside'),
};

function env(withScene: boolean): Environment {
  const e = parseEnvironment(JSON.parse(project.manifest));
  if (!e.success) throw e.error;
  if (withScene)
    e.environment.scenes.push({
      id: 'lobby',
      name: { en: 'Lobby', fr: 'Hall' },
      media: { type: 'equirect', source: 'media/abc/source.jpg', hdr: false },
      initialView: { yaw: 0, pitch: 0, fov: 90 },
      northOffsetDeg: 0,
      audienceIds: [],
    });
  return e.environment;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('Workspace', () => {
  it('opens on the media library for a new project and on the tour otherwise', () => {
    const { unmount } = render(
      <Workspace t={en} lang="en" project={project} environment={env(false)} onClose={() => {}} />,
    );
    expect(
      screen.getByRole('tab', { name: en.editor.tabs.media }).getAttribute('aria-selected'),
    ).toBe('true');
    unmount();
    render(
      <Workspace t={en} lang="en" project={project} environment={env(true)} onClose={() => {}} />,
    );
    expect(
      screen.getByRole('tab', { name: en.editor.tabs.tour }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.getByTestId('scene-inspector')).toBeTruthy();
  });

  it('undoes with Ctrl+Z, except while typing, and saves after a pause', async () => {
    vi.useFakeTimers();
    try {
      render(
        <Workspace t={en} lang="en" project={project} environment={env(true)} onClose={() => {}} />,
      );
      const name = screen.getByLabelText(en.editor.nameEn) as HTMLInputElement;
      fireEvent.change(name, { target: { value: 'Main lobby' } });
      expect(screen.getByTestId('save-status').dataset.status).toBe('pending');
      // In a text field, Ctrl+Z belongs to the field.
      fireEvent.keyDown(name, { key: 'z', ctrlKey: true });
      expect(name.value).toBe('Main lobby');
      await act(async () => vi.advanceTimersByTimeAsync(1500));
      expect(mock.api.saveProject).toHaveBeenCalledTimes(1);
      expect(JSON.parse(mock.api.saveProject.mock.calls[0]![0]).scenes[0].name.en).toBe(
        'Main lobby',
      );
      act(() => void fireEvent.keyDown(window, { key: 'z', ctrlKey: true }));
      expect((screen.getByLabelText(en.editor.nameEn) as HTMLInputElement).value).toBe('Lobby');
      act(() => void fireEvent.keyDown(window, { key: 'y', ctrlKey: true }));
      expect((screen.getByLabelText(en.editor.nameEn) as HTMLInputElement).value).toBe(
        'Main lobby',
      );
      expect(screen.getByRole('button', { name: en.editor.undo }).getAttribute('title')).toBe(
        en.editor.undoWhat(en.editor.labels.renameScene),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves pending edits before closing', async () => {
    const onClose = vi.fn();
    render(
      <Workspace t={en} lang="en" project={project} environment={env(true)} onClose={onClose} />,
    );
    fireEvent.change(screen.getByLabelText(en.editor.nameFr), { target: { value: 'Grand hall' } });
    fireEvent.click(screen.getByRole('button', { name: en.closeProject }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mock.api.saveProject).toHaveBeenCalledTimes(1);
  });
});
