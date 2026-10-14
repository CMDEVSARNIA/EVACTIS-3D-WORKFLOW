import * as Dialog from '@radix-ui/react-dialog';
import lockupUrl from '@evactis-3dworkflow/brand/product-lockup-plate.svg?url';
import type { AppInfo } from '@evactis-3dworkflow/desktop-bridge';
import type { Strings } from './i18n.ts';

export function AboutDialog({ t, info }: { t: Strings; info: AppInfo | null }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger className="evx-cta evx-cta--ghost">{t.about}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="evx-chrome fixed left-1/2 top-1/2 w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 p-8 shadow-2xl">
          <img src={lockupUrl} alt="EVACTIS 3DWORKFLOW" className="mb-6 h-12" />
          <Dialog.Title className="evx-heading text-xl">{t.aboutTitle}</Dialog.Title>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt>{t.version}</dt>
            <dd data-testid="about-version">{info?.version ?? 'dev'}</dd>
            <dt>{t.publisher}</dt>
            <dd>Evactis — evactis.ca</dd>
            <dt>{t.identifier}</dt>
            <dd>{info?.identifier ?? 'ca.evactis.3dworkflow.studio'}</dd>
          </dl>
          <Dialog.Description className="mt-4 text-sm">{t.aboutOffline}</Dialog.Description>
          <p className="mt-2 text-sm opacity-80">{t.licenses}</p>
          <Dialog.Close className="evx-cta mt-6">{t.close}</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
