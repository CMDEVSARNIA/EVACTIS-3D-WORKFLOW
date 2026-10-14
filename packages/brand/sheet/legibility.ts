import './sheet.css';
import { ICON_NAMES, SIGN_NAMES, buttonHtml, createMarker, createSign } from '../src/index.ts';
import { BACKDROPS, paintBackdrop, type BackdropName } from './backdrops.ts';

// Renders the full kit over one backdrop: ?bg=gradient|bright|dark|busy
const name = (new URLSearchParams(location.search).get('bg') ?? 'gradient') as BackdropName;
if (!BACKDROPS.includes(name)) throw new Error(`Unknown backdrop ${name}`);

const canvas = document.getElementById('backdrop') as HTMLCanvasElement;
paintBackdrop(canvas.getContext('2d')!, name);
document.body.dataset.backdrop = name;

const kit = document.getElementById('kit')!;
const add = (el: HTMLElement, x: number, y: number, id: string) => {
  el.style.position = 'absolute';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.dataset.testid = id;
  kit.append(el);
};
const t = document.createElement('template');
ICON_NAMES.forEach((icon, i) => {
  (['default', 'hover', 'active'] as const).forEach((state, s) => {
    t.innerHTML = buttonHtml({ icon, state });
    add(t.content.firstElementChild as HTMLElement, 20 + (i % 6) * 196 + s * 62, 20 + Math.floor(i / 6) * 100, `btn-${icon}-${state}`);
  });
});
kit.querySelectorAll<HTMLElement>('.evx-btn').forEach((b) => b.style.setProperty('--evx-btn-size', '56px'));
add(createMarker({ marker: 'evac-route', label: 'Evacuation route' }), 30, 330, 'marker-evac');
add(createMarker({ marker: 'info', label: 'Information', attention: true }), 180, 342, 'marker-info');
SIGN_NAMES.forEach((sign, i) => {
  add(createSign(sign, 'A'), 320 + i * 122, 330, `sign-${sign}-A`);
  add(createSign(sign, 'B'), 320 + i * 122, 470, `sign-${sign}-B`);
});
document.body.dataset.ready = 'true';
