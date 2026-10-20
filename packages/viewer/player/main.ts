import {
  IntegrityError,
  PackageReader,
  PassphraseError,
  QUICK_START_NAME,
} from '@evactis-3dworkflow/package-format';
import { DEFAULT_SKIN } from '@evactis-3dworkflow/schema';
import { createViewer, type Viewer } from '../src/index.ts';
import { Lms } from './lms.ts';
import { packageSource } from './source.ts';
import { askPassphrase, playerStrings, showProblem } from './ui.ts';
import './player.css';

declare global {
  interface Window {
    viewer?: Viewer;
  }
}

/**
 * The 3DWORKFLOW Viewer page shipped in packages (intranet bundle, browser folder, single
 * HTML file, SCORM). It opens the package's integrity manifest, asks for the passphrase
 * if the package is encrypted, and gives the Viewer every file only after it has passed
 * its check (and been decrypted, in memory). A file that fails stops the page.
 *   ?scene= ?lang= ?audience=   where to start
 *   ?kiosk                      kiosk layout (or the package's own kiosk setting)
 *   ?module=<id>                start a training module (the SCORM launch)
 */
const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage')!;
const t = playerStrings(params.get('lang') ?? navigator.language);
// Started before anything awaits: a browser-folder page defines its data hooks here.
const source = packageSource();

function fail(e: unknown) {
  window.viewer?.destroy();
  delete window.viewer;
  showProblem(stage, e instanceof IntegrityError ? t.altered(e.path) : t.cannotOpen(String(e)));
  document.body.dataset.ready = e instanceof IntegrityError ? 'integrity-error' : 'error';
}

async function main() {
  const lms = Lms.connect(window);
  document.body.dataset.lms = lms?.version ?? 'none';
  const { mode, read } = await source;
  document.body.dataset.mode = mode;
  const pkg = await PackageReader.open(read);
  if (pkg.encrypted) {
    document.body.dataset.ready = 'locked';
    await askPassphrase(stage, t, async (passphrase, progress) => {
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
  const moduleId = params.get('module');
  const module = (env.modules ?? []).find((m: { id: string }) => m.id === moduleId) as
    | { audienceIds?: string[]; startSceneId?: string }
    | undefined;
  const m = pkg.manifest;
  const viewer = await createViewer(stage, env, {
    assets: {
      url: (path) =>
        pkg.url(path).catch((e: unknown) => {
          if (e instanceof IntegrityError) fail(e);
          throw e;
        }),
    },
    language: params.get('lang') ?? undefined,
    // A module for one audience opens as that audience.
    audience: params.get('audience') ?? module?.audienceIds?.[0] ?? undefined,
    sceneId: module?.startSceneId ?? params.get('scene') ?? undefined,
    skin: env.skin ?? DEFAULT_SKIN,
    kiosk: params.has('kiosk') || m.kiosk === true,
    learnerName: lms?.learnerName || undefined,
    packageInfo: {
      kind: m.kind,
      createdAt: m.createdAt,
      producer: m.producer,
      digest: pkg.digest,
      quickStart: m.files.some((f) => f.path === QUICK_START_NAME)
        ? () => pkg.urlOfStored(QUICK_START_NAME)
        : undefined,
    },
  });
  window.viewer = viewer;
  document.documentElement.lang = viewer.language;
  viewer.on('languagechange', ({ language }) => (document.documentElement.lang = language));
  if (lms) {
    viewer.on('modulecomplete', (r) => lms.complete(r));
    addEventListener('pagehide', () => lms.finish());
  }
  if (moduleId) await viewer.startModule(moduleId);
  document.body.dataset.ready = 'true';
}

main().catch(fail);
