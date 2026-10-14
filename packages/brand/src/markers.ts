import { ICONS, escapeXml } from './icons.ts';
import { colors } from './tokens.ts';

/**
 * Round hotspot markers from the row below the button grid on
 * brand/evactis-button-kit.png.
 *
 * - evac-route: navy disc, white door-exit icon with green arrow. Default has a light
 *   grey ring; hover/active has a thick green ring.
 * - info: white disc, navy ring, navy "i". Attention (unvisited) state turns the ring
 *   green and adds a pulsing green halo (the pulse is CSS, see markers.css).
 */
export type MarkerName = 'evac-route' | 'info';
export type EvacMarkerState = 'default' | 'active';
export type InfoMarkerState = 'default' | 'attention';

const evacIcon = (x: number, y: number, size: number, accent: string) => {
  const def = ICONS['evac-route'];
  const s = size / 24;
  return (
    `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${colors.white}" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${def.body}` +
    `<g stroke="${accent}">${def.accent}</g></g>`
  );
};

/** Evac-route marker, 104 × 104 at 1x. */
export function evacMarkerSvg(state: EvacMarkerState = 'default', title = 'Evacuation route'): string {
  const ring = state === 'active' ? colors.green : colors.frameGrey;
  const inner = state === 'active' ? 43 : 45.5;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 104 104" role="img" aria-label="${escapeXml(title)}">` +
    `<title>${escapeXml(title)}</title>` +
    `<circle cx="52" cy="52" r="52" fill="${ring}"/>` +
    `<circle cx="52" cy="52" r="${inner}" fill="${colors.navy}"/>` +
    evacIcon(21, 21, 62, colors.green) +
    `</svg>`
  );
}

/** Info marker, 80 × 80 at 1x (the attention halo is drawn outside, to 112 × 112). */
export function infoMarkerSvg(
  state: InfoMarkerState = 'default',
  title = 'Information',
  opts: { drawHalo?: boolean } = {},
): string {
  const attention = state === 'attention';
  const drawHalo = attention && (opts.drawHalo ?? true);
  const ring = attention ? colors.greenStrong : colors.navy;
  const o = drawHalo ? 16 : 0;
  const size = 80 + 2 * o;
  const c = size / 2;
  const halo = drawHalo
    ? `<circle cx="${c}" cy="${c}" r="54" fill="${colors.green}" fill-opacity="0.16" stroke="${colors.green}" stroke-opacity="0.7" stroke-width="2.5" class="evx-halo"/>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeXml(title)}">` +
    `<title>${escapeXml(title)}</title>${halo}` +
    `<circle cx="${c}" cy="${c}" r="40" fill="${colors.white}"/>` +
    `<circle cx="${c}" cy="${c}" r="34" fill="none" stroke="${ring}" stroke-width="3.5"/>` +
    `<circle cx="${c}" cy="${c - 14.5}" r="4.8" fill="${colors.navy}"/>` +
    `<rect x="${c - 3.8}" y="${c - 5}" width="7.6" height="23" rx="3.8" fill="${colors.navy}"/>` +
    `</svg>`
  );
}

export interface MarkerElementOptions {
  marker: MarkerName;
  /** Accessible name, normally the hotspot title. */
  label: string;
  /** Info markers: show the pulsing halo until visited. */
  attention?: boolean;
}

/**
 * Builds a focusable marker button. Hover/focus switches the evac marker to its
 * green-ring state via CSS (markers.css); `attention` adds the info halo.
 */
export function createMarker(opts: MarkerElementOptions, doc: Document = document): HTMLButtonElement {
  const el = doc.createElement('button');
  el.type = 'button';
  el.className = `evx-marker evx-marker--${opts.marker}`;
  el.setAttribute('aria-label', opts.label);
  if (opts.attention) el.dataset.attention = 'true';
  el.innerHTML =
    opts.marker === 'evac-route'
      ? `<span class="evx-marker__face evx-marker__face--default">${evacMarkerSvg('default', opts.label)}</span>` +
        `<span class="evx-marker__face evx-marker__face--active">${evacMarkerSvg('active', opts.label)}</span>`
      : `<span class="evx-marker__halo" aria-hidden="true"></span>` +
        `<span class="evx-marker__face evx-marker__face--default">${infoMarkerSvg('default', opts.label)}</span>` +
        `<span class="evx-marker__face evx-marker__face--attention">${infoMarkerSvg('attention', opts.label, { drawHalo: false })}</span>`;
  el.querySelectorAll('svg').forEach((s) => {
    s.setAttribute('aria-hidden', 'true');
    s.removeAttribute('role');
    s.removeAttribute('aria-label');
    s.querySelector('title')?.remove();
  });
  return el;
}
