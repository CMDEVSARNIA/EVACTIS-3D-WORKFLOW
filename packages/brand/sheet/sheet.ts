import './sheet.css';
import {
  ICON_NAMES,
  SIGN_NAMES,
  buttonHtml,
  createMarker,
  createSign,
  signViewBox,
  type ButtonState,
} from '../src/index.ts';
import logoLockupUrl from '../logo-lockup.svg?url';
import productLockupUrl from '../product-lockup.svg?url';
import productPlateUrl from '../product-lockup-plate.svg?url';
import productStackedUrl from '../product-lockup-stacked.svg?url';

const sheet = document.getElementById('sheet')!;
const extras = document.getElementById('extras')!;

function place(el: HTMLElement, x: number, y: number) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  sheet.append(el);
  return el;
}

function html(markup: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as HTMLElement;
}

// Header, as on the reference sheet.
sheet.append(
  html(`<header class="sheet__head">
    <img class="sheet__logo" src="${logoLockupUrl}" alt="Evactis" />
    <div><p class="sheet__title">3DWORKFLOW button kit</p>
    <p class="sheet__subtitle">Preview over a light-to-dark backdrop to test legibility</p></div>
  </header>`),
);

// 6 rows × 3 groups of [default, hover, active].
const GROUP_X = [50, 430, 810];
const STATES: ButtonState[] = ['default', 'hover', 'active'];
ICON_NAMES.forEach((icon, i) => {
  const gx = GROUP_X[i % 3]!;
  const y = 110 + 115 * Math.floor(i / 3);
  STATES.forEach((state, s) => {
    const b = html(buttonHtml({ icon, state }));
    b.dataset.testid = `btn-${icon}-${state}`;
    place(b, gx + 110 * s, y);
  });
  const label = html(`<span class="label">${icon}</span>`);
  place(label, gx - 6, y + 87);
});

// Round markers.
const evac = createMarker({ marker: 'evac-route', label: 'Evacuation route' });
place(evac, 52, 832).dataset.testid = 'marker-evac-default';
const evacActive = createMarker({ marker: 'evac-route', label: 'Evacuation route' });
evacActive.dataset.state = 'active';
place(evacActive, 192, 832).dataset.testid = 'marker-evac-active';
place(createMarker({ marker: 'info', label: 'Information' }), 344, 844).dataset.testid =
  'marker-info-default';
place(createMarker({ marker: 'info', label: 'Information', attention: true }), 484, 844).dataset.testid =
  'marker-info-attention';

// Safety signs, style A then style B.
const SIGN_CX = [104, 244, 384, 524, 664, 804, 944];
(['A', 'B'] as const).forEach((style, row) => {
  const cy = row === 0 ? 1043 : 1193;
  SIGN_NAMES.forEach((name, i) => {
    const { w, h } = signViewBox(name, style);
    const el = createSign(name, style);
    el.dataset.testid = `sign-${name}-${style}`;
    place(el, SIGN_CX[i]! - w / 2, cy - h / 2);
  });
});

// Extras: the new product lockup and the website-style chrome.
const chrome = (theme: 'dark' | 'light') => `
  <div class="evx-chrome chrome-demo" data-theme="${theme}">
    <p class="evx-eyebrow">Safe plans . Clear paths</p>
    <h1 class="evx-heading">See the space.<br />Understand the plan.</h1>
    <p class="lead">EVACTIS 3DWORKFLOW turns facilities into interactive environments that run entirely offline.</p>
    <ul class="evx-bullets">
      <li>Every layer of your facility unified — safety, operations, assets, and emergency response.</li>
      <li>Runs on your own hardware, with no cloud service or internet connection.</li>
    </ul>
    <div class="ctas"><button class="evx-cta" type="button">Open environment</button>
    <button class="evx-cta evx-cta--ghost" type="button">Explore</button></div>
  </div>`;

extras.innerHTML = `
  <h2>Product lockup — new element for review</h2>
  <div class="row"><div class="on-paper" data-testid="lockup-paper"><img src="${productLockupUrl}" alt="EVACTIS 3DWORKFLOW" height="64" /></div></div>
  <div class="row">
    <div class="on-ink" data-testid="lockup-ink"><img src="${productPlateUrl}" alt="EVACTIS 3DWORKFLOW" height="72" /></div>
    <div class="on-paper" data-testid="lockup-stacked"><img src="${productStackedUrl}" alt="EVACTIS 3DWORKFLOW" height="120" /></div>
  </div>
  <h2>Chrome — dark (default) and light</h2>
  <div class="row" data-testid="chrome">${chrome('dark')}${chrome('light')}</div>`;
