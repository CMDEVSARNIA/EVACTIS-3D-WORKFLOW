import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { api, type ProjectInfo } from './api.ts';
import { describeError, newProjectManifest } from './format.ts';
import type { Strings } from './i18n.ts';

export function NewProjectDialog({
  t,
  disabled,
  onCreated,
}: {
  t: Strings;
  disabled: boolean;
  onCreated: (p: ProjectInfo) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function choose() {
    const folder = await api.pickFolder(t.location);
    if (folder) setParent(folder);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!parent) return;
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject(parent, name.trim(), newProjectManifest(name.trim()));
      setOpen(false);
      onCreated(project);
    } catch (err) {
      setError(describeError(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setError(null);
      }}
    >
      <Dialog.Trigger className="evx-cta" disabled={disabled}>
        {t.newProject}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="evx-chrome fixed top-1/2 left-1/2 w-[min(92vw,36rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 p-8 shadow-2xl">
          <Dialog.Title className="evx-heading text-xl">{t.newProjectTitle}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm opacity-80">
            {t.projectFolderHint}
          </Dialog.Description>
          <form className="mt-6 grid gap-5" onSubmit={create}>
            <label className="grid gap-2 text-sm">
              <span className="font-semibold">{t.projectName}</span>
              <input
                className="evx-field"
                value={name}
                maxLength={80}
                required
                placeholder={t.projectNamePlaceholder}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="grid gap-2 text-sm">
              <span className="font-semibold">{t.location}</span>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="evx-cta evx-cta--ghost" onClick={choose}>
                  {t.chooseFolder}
                </button>
                <span className="break-all opacity-80" data-testid="new-project-parent">
                  {parent ?? t.noFolder}
                </span>
              </div>
            </div>
            {error && (
              <p role="alert" className="evx-alert">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <button type="submit" className="evx-cta" disabled={busy || !parent || !name.trim()}>
                {t.create}
              </button>
              <Dialog.Close className="evx-cta evx-cta--ghost">{t.cancel}</Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
