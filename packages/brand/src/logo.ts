import { WORDMARK } from './generated/wordmark.ts';

export { WORDMARK };
import { escapeXml } from './icons.ts';
import { colors } from './tokens.ts';

/**
 * The Evactis logo mark, traced from brand/evactis-logo-mark.png (alpha-mask IoU
 * ≥ 0.99, enforced by test/logo-trace.test.ts). Units are source pixels with the
 * mark's top-left at the origin.
 *
 * Rules: never recolour, stretch, rotate or redraw the mark. On dark backgrounds
 * place it on a paper plate (see `productLockupSvg({ plate: true })`).
 */
export const MARK = {
  width: 628.3,
  height: 564,
  navy: [
    // Block "E" with the door transom and upper door post.
    'M70 0H547.2L510.5 101H123.6V114.6L281.2 162.1V227.9H256V178.1L123.6 201.9V460H107V473.4H510.9L547.1 564H70A70 70 0 0 1 0 494V70A70 70 0 0 1 70 0Z',
    // Door sill and lower door post.
    'M151.4 460L256 435V348.2H281.2V460Z',
    // Door knob.
    'M224.6 292A10.4 19 0 1 1 224.6 330A10.4 19 0 1 1 224.6 292Z',
  ],
  green: ['M249.3 245H515V198.8L628.3 287.6L515 376.3V330.1H249.3Z'],
} as const;

const markPaths = (dx = 0, dy = 0, scale = 1) => {
  const t = dx || dy || scale !== 1 ? ` transform="translate(${dx} ${dy}) scale(${scale})"` : '';
  return (
    `<g${t}>` +
    MARK.navy.map((d) => `<path d="${d}" fill="${colors.navy}"/>`).join('') +
    MARK.green.map((d) => `<path d="${d}" fill="${colors.green}"/>`).join('') +
    `</g>`
  );
};

const svgOpen = (w: number, h: number, title: string, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(w)} ${fmt(h)}" role="img" ` +
  `aria-label="${escapeXml(title)}"${extra}><title>${escapeXml(title)}</title>`;

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** The logo mark alone (app icons, favicons, small spaces). */
export function logoMarkSvg(title = 'Evactis'): string {
  return `${svgOpen(MARK.width, MARK.height, title)}${markPaths()}</svg>`;
}

const glyphs = (list: readonly { d: string; color: 'navy' | 'greenStrong' }[]) =>
  list.map((g) => `<path d="${g.d}" fill="${colors[g.color]}"/>`).join('');

export interface LockupOptions {
  /** Draw on a rounded paper plate, for dark backgrounds. */
  plate?: boolean;
  title?: string;
}

function withPlate(width: number, height: number, inner: string, title: string, plate: boolean) {
  if (!plate) return `${svgOpen(width, height, title)}${inner}</svg>`;
  const pad = height * 0.32;
  const w = width + 2 * pad;
  const h = height + 2 * pad;
  return (
    `${svgOpen(w, h, title)}<rect width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(pad * 0.9)}" fill="${colors.paper}"/>` +
    `<g transform="translate(${fmt(pad)} ${fmt(pad)})">${inner}</g></svg>`
  );
}

/** EVACTIS logo: the mark doubles as the "E", followed by "VACTIS" (green "I"), as on evactis.ca. */
export function logoLockupSvg(opts: LockupOptions = {}): string {
  const inner = markPaths() + glyphs(WORDMARK.vactis);
  return withPlate(WORDMARK.vactisRight, MARK.height, inner, opts.title ?? 'Evactis', !!opts.plate);
}

/**
 * EVACTIS 3DWORKFLOW product lockup: logo + "3DWORKFLOW" in the wordmark's heavy
 * grotesk, navy with a green "3D" echoing the green "I".
 */
export function productLockupSvg(opts: LockupOptions = {}): string {
  const inner = markPaths() + glyphs(WORDMARK.vactis) + glyphs(WORDMARK.product);
  return withPlate(
    WORDMARK.productRight,
    MARK.height,
    inner,
    opts.title ?? 'EVACTIS 3DWORKFLOW',
    !!opts.plate,
  );
}

/**
 * Stacked product lockup for tight spaces (installer header, sidebar): the EVACTIS
 * logo with "3DWORKFLOW" set below it at the logo's width.
 */
export function productLockupStackedSvg(opts: LockupOptions = {}): string {
  const width = WORDMARK.vactisRight;
  const k = width / (WORDMARK.productRight - WORDMARK.productLeft);
  const gap = 96;
  const capH = WORDMARK.baseline - WORDMARK.capTop;
  const height = MARK.height + gap + capH * k;
  const inner =
    markPaths() +
    glyphs(WORDMARK.vactis) +
    `<g transform="translate(0 ${fmt(MARK.height + gap)}) scale(${k.toFixed(5)}) ` +
    `translate(${fmt(-WORDMARK.productLeft)} ${-WORDMARK.capTop})">${glyphs(WORDMARK.product)}</g>`;
  return withPlate(width, height, inner, opts.title ?? 'EVACTIS 3DWORKFLOW', !!opts.plate);
}

/** Aspect ratio (width / height) of the product lockup without plate. */
export const PRODUCT_LOCKUP_ASPECT = WORDMARK.productRight / MARK.height;
