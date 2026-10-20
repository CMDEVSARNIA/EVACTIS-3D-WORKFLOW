import { DEFAULT_SKIN } from '@evactis-3dworkflow/schema';
import { createViewer, type Viewer } from '../src/index.ts';
import { Lms } from './lms.ts';
import './player.css';

declare global {
  interface Window {
    viewer?: Viewer;
  }
}

/**
 * The 3DWORKFLOW Viewer page shipped in packages: opens `environment.json` from its own
 * folder with the environment's skin (or the Evactis default).
 *   ?scene= ?lang= ?audience=   where to start
 *   ?kiosk                      kiosk layout
 *   ?module=<id>                start a training module (the SCORM launch)
 * Inside an LMS (SCORM 1.2 or 2004), the module's result is reported to it.
 */
const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage')!;
const lms = Lms.connect(window);
document.body.dataset.lms = lms?.version ?? 'none';

try {
  const env = await (await fetch('./environment.json')).json();
  const moduleId = params.get('module');
  const module = (env.modules ?? []).find((m: { id: string }) => m.id === moduleId) as
    | { audienceIds?: string[]; startSceneId?: string }
    | undefined;
  const viewer = await createViewer(stage, env, {
    baseUrl: './',
    language: params.get('lang') ?? undefined,
    // A module for one audience opens as that audience.
    audience: params.get('audience') ?? module?.audienceIds?.[0] ?? undefined,
    sceneId: module?.startSceneId ?? params.get('scene') ?? undefined,
    skin: env.skin ?? DEFAULT_SKIN,
    kiosk: params.has('kiosk'),
    learnerName: lms?.learnerName || undefined,
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
} catch (e) {
  const p = document.createElement('p');
  p.className = 'player-error';
  p.setAttribute('role', 'alert');
  p.textContent = `Could not open the environment: ${String(e)}`;
  stage.replaceChildren(p);
  document.body.dataset.ready = 'error';
}
