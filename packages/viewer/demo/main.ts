import { DEFAULT_SKIN } from '@evactis-3dworkflow/schema';
import { paintBackdrop, BACKDROPS, type BackdropName } from '../../brand/sheet/backdrops.ts';
import { createViewer, type Viewer } from '../src/index.ts';
import './demo.css';

declare global {
  interface Window {
    viewer?: Viewer;
    viewerError?: string;
  }
}

/**
 * The demo facility in the Viewer with the Evactis default skin.
 *   ?scene= ?lang= ?audience=   where to start
 *   ?kiosk                      kiosk layout (large touch targets, no full screen)
 *   ?no-skin                    panorama and hotspots only
 *   ?bg=gradient|bright|dark|busy  legibility tests: the skin over a test backdrop
 */
const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage')!;

try {
  // Relative, same-folder JSON: works from a local server or the desktop app.
  const env = await (await fetch('./environment.json')).json();
  const viewer = await createViewer(stage, env, {
    baseUrl: './',
    language: params.get('lang') ?? undefined,
    audience: params.get('audience') ?? undefined,
    sceneId: params.get('scene') ?? undefined,
    reducedMotion: params.has('reduced-motion') || undefined,
    editing: params.has('editing') || undefined,
    skin: params.has('no-skin') ? null : (env.skin ?? DEFAULT_SKIN),
    kiosk: params.has('kiosk'),
  });
  window.viewer = viewer;
  document.documentElement.lang = viewer.language;
  viewer.on('languagechange', ({ language }) => (document.documentElement.lang = language));

  const bg = params.get('bg') as BackdropName | null;
  if (bg && BACKDROPS.includes(bg)) {
    // A fixed backdrop between the panorama and the skin, for legibility tests.
    const c = document.createElement('canvas');
    c.className = 'demo-backdrop';
    c.width = stage.clientWidth;
    c.height = stage.clientHeight;
    paintBackdrop(c.getContext('2d')!, bg);
    viewer.element.insertBefore(c, viewer.element.querySelector('.evx-skin'));
    document.body.dataset.backdrop = bg;
  }
  document.body.dataset.ready = 'true';
} catch (e) {
  window.viewerError = String(e);
  stage.textContent = `Could not open the environment: ${String(e)}`;
  document.body.dataset.ready = 'error';
}
