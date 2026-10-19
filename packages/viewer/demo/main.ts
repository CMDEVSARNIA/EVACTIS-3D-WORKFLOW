import { buttonHtml, setButtonIcon, setButtonPressed } from '@evactis-3dworkflow/brand';
import { createViewer, type Viewer } from '../src/index.ts';
import './demo.css';

declare global {
  interface Window {
    viewer?: Viewer;
    viewerError?: string;
  }
}

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage')!;
const toolbar = document.querySelector<HTMLElement>('.demo-toolbar')!;

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
  });
  window.viewer = viewer;
  document.documentElement.lang = viewer.language;

  const add = (
    icon: Parameters<typeof buttonHtml>[0]['icon'],
    onClick: (b: HTMLButtonElement) => void,
    pressed?: boolean,
  ) => {
    const t = document.createElement('template');
    t.innerHTML = buttonHtml({ icon, pressed, lang: viewer.language === 'fr' ? 'fr' : 'en' });
    const b = t.content.firstElementChild as HTMLButtonElement;
    b.addEventListener('click', () => onClick(b));
    toolbar.append(b);
    return b;
  };
  add('home', () => void viewer.goToScene(viewer.environment.initialSceneId ?? 'lobby'));
  add('zoom-in', () => viewer.zoom(1.25));
  add('zoom-out', () => viewer.zoom(0.8));
  add(
    'info',
    (b) => {
      const fr = b.getAttribute('aria-pressed') !== 'true';
      setButtonPressed(b, fr);
      viewer.setLanguage(fr ? 'fr' : 'en');
      document.documentElement.lang = viewer.language;
    },
    viewer.language === 'fr',
  );
  add('fullscreen', (b) => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      setButtonIcon(b, 'fullscreen');
    } else {
      void document.documentElement.requestFullscreen?.();
      setButtonIcon(b, 'fullscreen-exit');
    }
  });
  document.body.dataset.ready = 'true';
} catch (e) {
  window.viewerError = String(e);
  stage.textContent = `Could not open the environment: ${String(e)}`;
  document.body.dataset.ready = 'error';
}
