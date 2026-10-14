import '@evactis-3dworkflow/brand/tokens.css';
import '@evactis-3dworkflow/brand/fonts.css';
import '@evactis-3dworkflow/brand/button.css';
import '@evactis-3dworkflow/brand/chrome.css';
import './style.css';
import { buttonHtml, type IconName } from '@evactis-3dworkflow/brand';
import lockupUrl from '@evactis-3dworkflow/brand/product-lockup-plate.svg?url';
import { STRINGS, detectLang, type Lang } from './i18n.ts';
import { appInfo, reportSmoke, watchNetwork } from '@evactis-3dworkflow/desktop-bridge';

const blocked = watchNetwork();
const TOOLBAR: IconName[] = [
  'home',
  'floor-plan',
  'evac-route',
  'menu',
  'info',
  'help',
  'sound-on',
  'fullscreen',
  'vr',
];

let lang: Lang = detectLang();
const root = document.getElementById('app')!;

function render(version: string) {
  const t = STRINGS[lang];
  document.documentElement.lang = lang;
  root.innerHTML = `
    <header class="viewer-top">
      <img class="viewer-lockup" src="${lockupUrl}" alt="EVACTIS 3DWORKFLOW" />
      <button type="button" class="evx-cta evx-cta--ghost" id="lang">${t.language}</button>
    </header>
    <main class="viewer-stage">
      <p class="evx-eyebrow">${t.eyebrow}</p>
      <h1 class="evx-heading">${t.title}</h1>
      <p class="viewer-empty">${t.empty}</p>
      <p class="viewer-offline" role="note">${t.offline}</p>
      <p class="viewer-version">${t.version} ${version}</p>
    </main>
    <nav class="viewer-toolbar" aria-label="${t.toolbar}">
      ${TOOLBAR.map((icon) => buttonHtml({ icon, lang })).join('')}
    </nav>`;
  root.querySelector('#lang')!.addEventListener('click', () => {
    lang = lang === 'en' ? 'fr' : 'en';
    render(version);
  });
}

const info = await appInfo();
render(info?.version ?? 'dev');
await reportSmoke(info, blocked);
