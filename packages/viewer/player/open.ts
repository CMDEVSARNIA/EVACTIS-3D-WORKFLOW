/**
 * Opening a delivery package in a page: the packaged player (intranet, browser folder,
 * single file, SCORM) and the 3DWORKFLOW Viewer desktop app share this. It reads the
 * integrity manifest, asks for the passphrase of an encrypted package (a wrong one is
 * refused), and gives the Viewer each file only after it has passed its check and been
 * decrypted in memory. A file that fails stops the page with a clear message.
 */
import {
  IntegrityError,
  PackageReader,
  PassphraseError,
  QUICK_START_NAME,
  type ReadStored,
} from '@evactis-3dworkflow/package-format';
import { DEFAULT_SKIN } from '@evactis-3dworkflow/schema';
import { createViewer, type Viewer, type ViewerOptions } from '../src/index.ts';
import { askPassphrase, playerStrings, showProblem } from './ui.ts';

declare global {
  interface Window {
    viewer?: Viewer;
  }
}

export interface OpenOptions {
  stage: HTMLElement;
  read: ReadStored;
  language?: string;
  audience?: string;
  sceneId?: string;
  /** A training module to start (the SCORM launch). */
  moduleId?: string;
  kiosk?: boolean;
  learnerName?: string;
  /** Tried before asking (desktop smoke tests); if refused, the run fails. */
  passphrase?: string;
  /** Hides the quick-start link (the desktop app has the PDF beside it). */
  noQuickStart?: boolean;
}

export type OpenState = 'locked' | 'true' | 'integrity-error' | 'error';

/** Marks progress on <body data-ready> (tests and smoke runs watch it). */
const mark = (s: OpenState) => (document.body.dataset.ready = s);

export class OpenError extends Error {
  override name = 'OpenError';
}

export async function openPackage(o: OpenOptions): Promise<Viewer> {
  const t = playerStrings(o.language ?? navigator.language);
  // Set by the first failure; an integrity failure during start-up (a tile of the first
  // view) must not be overwritten by the start-up finishing.
  let failure: unknown = null;
  const fail = (e: unknown) => {
    if (failure) return;
    failure = e;
    window.viewer?.destroy();
    delete window.viewer;
    showProblem(o.stage, e instanceof IntegrityError ? t.altered(e.path) : t.cannotOpen(String(e)));
    mark(e instanceof IntegrityError ? 'integrity-error' : 'error');
  };
  try {
    const pkg = await PackageReader.open(o.read);
    if (pkg.encrypted) {
      mark('locked');
      if (o.passphrase !== undefined) {
        try {
          await pkg.unlock(o.passphrase);
        } catch (e) {
          throw e instanceof PassphraseError ? new OpenError('the passphrase was refused') : e;
        }
      } else
        await askPassphrase(o.stage, t, async (passphrase, progress) => {
          try {
            await pkg.unlock(passphrase, progress);
            return true;
          } catch (e) {
            if (e instanceof PassphraseError) return false;
            throw e;
          }
        });
    }
    const env = JSON.parse(new TextDecoder().decode(await pkg.bytes('environment.json')));
    const module = (env.modules ?? []).find((m: { id: string }) => m.id === o.moduleId) as
      | { audienceIds?: string[]; startSceneId?: string }
      | undefined;
    const m = pkg.manifest;
    const options: ViewerOptions = {
      assets: {
        url: (path) =>
          pkg.url(path).catch((e: unknown) => {
            if (e instanceof IntegrityError) fail(e);
            throw e;
          }),
      },
      language: o.language,
      // A module for one audience opens as that audience.
      audience: o.audience ?? module?.audienceIds?.[0],
      sceneId: module?.startSceneId ?? o.sceneId,
      skin: env.skin ?? DEFAULT_SKIN,
      kiosk: o.kiosk || m.kiosk === true,
      learnerName: o.learnerName,
      packageInfo: {
        kind: m.kind,
        createdAt: m.createdAt,
        producer: m.producer,
        digest: pkg.digest,
        quickStart:
          !o.noQuickStart && m.files.some((f) => f.path === QUICK_START_NAME)
            ? () => pkg.urlOfStored(QUICK_START_NAME)
            : undefined,
      },
    };
    const viewer = await createViewer(o.stage, env, options);
    if (failure) {
      viewer.destroy();
      throw failure;
    }
    window.viewer = viewer;
    document.documentElement.lang = viewer.language;
    viewer.on('languagechange', ({ language }) => (document.documentElement.lang = language));
    if (o.moduleId) await viewer.startModule(o.moduleId);
    if (failure) throw failure;
    mark('true');
    return viewer;
  } catch (e) {
    fail(e);
    throw e;
  }
}

export { playerStrings, showProblem } from './ui.ts';
