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
    radar: !params.has('no-radar'),
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
  add('floor-plan', () => void viewer.showFloorPlan());
  // The evac-route button shows the nearest primary route; the banner offers the other.
  const evac = add('evac-route', () => {
    if (viewer.activeRoute) viewer.hideRoute();
    else viewer.showRoute();
  });
  viewer.on('routechange', ({ routeId }) => setButtonPressed(evac, routeId !== null));
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
  // Audience switcher (hidden when the package locks the audience).
  if (!viewer.environment.settings.lockAudience) {
    const label = document.createElement('label');
    label.className = 'demo-audience';
    const name = document.createElement('span');
    const select = document.createElement('select');
    const fill = () => {
      const fr = viewer.language.startsWith('fr');
      name.textContent = fr ? 'Public' : 'Audience';
      select.replaceChildren(
        ...viewer.environment.audiences.map((a) => {
          const o = document.createElement('option');
          o.value = a.id;
          o.textContent = a.name[viewer.language] ?? a.name.en ?? a.id;
          return o;
        }),
      );
      select.value = viewer.audience ?? '';
    };
    fill();
    viewer.on('languagechange', fill);
    viewer.on('audiencechange', ({ audience }) => (select.value = audience ?? ''));
    select.addEventListener('change', () => viewer.setAudience(select.value || null));
    label.append(name, select);
    toolbar.append(label);
  }
  // Live layers (e.g. "Conditions: Normal / Smoke"), one switcher each.
  for (const layer of viewer.environment.liveLayers) {
    const label = document.createElement('label');
    label.className = 'demo-audience';
    const name = document.createElement('span');
    const select = document.createElement('select');
    select.dataset.layerId = layer.id;
    const L = (t: Record<string, string>) => t[viewer.language] ?? t.en ?? '';
    const fill = () => {
      name.textContent = L(layer.name);
      select.replaceChildren(
        ...layer.states.map((st) => {
          const o = document.createElement('option');
          o.value = st.id;
          o.textContent = L(st.name);
          return o;
        }),
      );
      select.value = viewer.liveLayers.find((l) => l.layerId === layer.id)?.stateId ?? '';
    };
    fill();
    viewer.on('languagechange', fill);
    viewer.on('livelayerchange', ({ layerId, stateId }) => {
      if (layerId === layer.id) select.value = stateId;
    });
    select.addEventListener('change', () => void viewer.setLiveLayer(layer.id, select.value));
    label.append(name, select);
    toolbar.append(label);
  }
  document.body.dataset.ready = 'true';
} catch (e) {
  window.viewerError = String(e);
  stage.textContent = `Could not open the environment: ${String(e)}`;
  document.body.dataset.ready = 'error';
}
