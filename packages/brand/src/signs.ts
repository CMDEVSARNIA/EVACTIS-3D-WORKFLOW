import { colors } from './tokens.ts';
import { escapeXml } from './icons.ts';

/**
 * Safety-sign hotspots from the bottom two rows of brand/evactis-button-kit.png.
 * Colour families and shapes follow ISO 7010 conventions (green square = safe
 * condition, red square = fire equipment, yellow triangle = warning). The
 * pictograms are Evactis drawings, not ISO artwork; signage used in a real
 * deliverable must be reviewed by a qualified person (docs/safety-signage.md).
 */
export type SignName =
  | 'emergency-exit'
  | 'first-aid'
  | 'aed'
  | 'assembly-point'
  | 'fire-extinguisher'
  | 'fire-alarm'
  | 'warning';
export type SignStyle = 'A' | 'B';

interface SignDef {
  family: 'safe' | 'fire' | 'warning';
  label: { en: string; fr: string };
  /** Pictogram on a 64 × 64 grid. `{bg}` is replaced by the sign colour. */
  art: string;
}

const W = colors.white;
const stroke = (w: number) =>
  `fill="none" stroke="${W}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

const corner = (rot: number) =>
  `<g transform="rotate(${rot} 32 32)"><path d="M13 13 25 25" ${stroke(5)}/><path d="M25.5 15.5V25.5H15.5" ${stroke(5)}/></g>`;

export const SIGNS: Record<SignName, SignDef> = {
  'emergency-exit': {
    family: 'safe',
    label: { en: 'Emergency exit', fr: 'Sortie de secours' },
    art: `<path d="M39 22V13.5H17.5v37H39V42" ${stroke(4.5)}/><path d="M27 32h25M44 24l8 8-8 8" ${stroke(4.5)}/>`,
  },
  'first-aid': {
    family: 'safe',
    label: { en: 'First aid', fr: 'Premiers soins' },
    art: `<path d="M24.5 11h15v13.5H53v15H39.5V53h-15V39.5H11v-15h13.5z" fill="${W}"/>`,
  },
  aed: {
    family: 'safe',
    label: {
      en: 'Automated external defibrillator (AED)',
      fr: 'Défibrillateur externe automatisé (DEA)',
    },
    art:
      `<path d="M32 53C29.5 50.6 10 38.5 10 24.5 10 16.5 16 11.5 22.6 11.5c4.4 0 7.6 2.3 9.4 5.6 1.8-3.3 5-5.6 9.4-5.6C48 11.5 54 16.5 54 24.5 54 38.5 34.5 50.6 32 53z" fill="${W}"/>` +
      `<path d="M35 18.5 26.5 32.5h6.2L29.5 45l9.5-15.5h-6.3z" fill="{bg}"/>`,
  },
  'assembly-point': {
    family: 'safe',
    label: { en: 'Assembly point', fr: 'Point de rassemblement' },
    art: `${corner(0)}${corner(90)}${corner(180)}${corner(270)}<circle cx="32" cy="32" r="5.5" fill="${W}"/>`,
  },
  'fire-extinguisher': {
    family: 'fire',
    label: { en: 'Fire extinguisher', fr: 'Extincteur' },
    art:
      `<rect x="26" y="23" width="14" height="30" rx="4.5" fill="${W}"/>` +
      `<rect x="29.5" y="16.5" width="7" height="8" rx="1.5" fill="${W}"/>` +
      `<path d="M31 13.5h11" ${stroke(3.5)}/>` +
      `<path d="M29.5 19.5c-5 0-8 2.5-8 8V35" ${stroke(3.5)}/>`,
  },
  'fire-alarm': {
    family: 'fire',
    label: { en: 'Fire alarm', fr: 'Alarme incendie' },
    art:
      `<path d="M32 15.5a2.8 2.8 0 0 1 2.8 2.8v.9c5.9 1.4 9.4 6.4 9.4 12.5v6.7l3.8 4.6H16v0l3.8-4.6v-6.7c0-6.1 3.5-11.1 9.4-12.5v-.9a2.8 2.8 0 0 1 2.8-2.8z" fill="${W}"/>` +
      `<path d="M27.5 47.5a4.6 4.6 0 0 0 9 0" ${stroke(3.5)}/>` +
      `<path d="M13 21.5a20 20 0 0 1 4.5-7.5M51 21.5a20 20 0 0 0-4.5-7.5" ${stroke(3.5)}/>`,
  },
  warning: {
    family: 'warning',
    label: { en: 'Warning', fr: 'Avertissement' },
    art: '',
  },
};

export const SIGN_NAMES = Object.keys(SIGNS) as SignName[];

const familyColor = { safe: colors.safeGreen, fire: colors.fireRed, warning: colors.warningYellow };

export interface SignSvgOptions {
  title?: string;
  size?: number;
}

/** Size of each sign's viewBox, in px at 1x. */
export function signViewBox(name: SignName, style: SignStyle): { w: number; h: number } {
  if (name === 'warning') return style === 'A' ? { w: 112, h: 99 } : { w: 124, h: 109 };
  return style === 'A' ? { w: 96, h: 96 } : { w: 112, h: 112 };
}

/** Returns a standalone SVG for a safety sign in style A or B. */
export function signSvg(name: SignName, style: SignStyle = 'A', opts: SignSvgOptions = {}): string {
  const def = SIGNS[name];
  const { w, h } = signViewBox(name, style);
  const title = opts.title ?? def.label.en;
  const size = opts.size ? ` width="${opts.size}" height="${(opts.size * h) / w}"` : '';
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"${size} role="img" ` +
    `aria-label="${escapeXml(title)}"><title>${escapeXml(title)}</title>`;
  return `${head}${def.family === 'warning' ? warningBody(style) : squareBody(def, style)}</svg>`;
}

function squareBody(def: SignDef, style: SignStyle): string {
  const bg = familyColor[def.family];
  const art = def.art.replaceAll('{bg}', bg);
  if (style === 'A') {
    // Thin white border.
    return (
      `<rect x="0" y="0" width="96" height="96" rx="15" fill="${W}"/>` +
      `<rect x="5" y="5" width="86" height="86" rx="11" fill="${bg}"/>` +
      `<g transform="translate(11.2 11.2) scale(1.15)">${art}</g>`
    );
  }
  // Thicker light-grey frame around a white border.
  return (
    `<defs><linearGradient id="evx-frame" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#E4E3E0"/><stop offset="1" stop-color="#ABAAA6"/></linearGradient></defs>` +
    `<rect x="0" y="0" width="112" height="112" rx="19" fill="url(#evx-frame)"/>` +
    `<rect x="6" y="6" width="100" height="100" rx="14" fill="${W}"/>` +
    `<rect x="11" y="11" width="90" height="90" rx="10" fill="${bg}"/>` +
    `<g transform="translate(19.2 19.2) scale(1.15)">${art}</g>`
  );
}

function warningBody(style: SignStyle): string {
  const y = colors.warningYellow;
  const k = colors.warningBorder;
  const tri = (cx: number, top: number, side: number, r: number) => {
    // Equilateral triangle with rounded corners via stroke-linejoin.
    const hgt = (side * Math.sqrt(3)) / 2;
    const p = [
      [cx, top],
      [cx + side / 2, top + hgt],
      [cx - side / 2, top + hgt],
    ]
      .map(([a, b]) => `${(a as number).toFixed(2)},${(b as number).toFixed(2)}`)
      .join(' ');
    return { points: p, r };
  };
  const mark = (cx: number, top: number, s: number) =>
    `<rect x="${cx - 3.6 * s}" y="${top}" width="${7.2 * s}" height="${30 * s}" rx="${3.6 * s}" fill="${k}"/>` +
    `<circle cx="${cx}" cy="${top + 39 * s}" r="${4.6 * s}" fill="${k}"/>`;
  if (style === 'A') {
    const outer = tri(56, 6, 100, 8);
    const inner = tri(56, 25, 70, 3);
    return (
      `<polygon points="${outer.points}" fill="${k}" stroke="${k}" stroke-width="12" stroke-linejoin="round"/>` +
      `<polygon points="${inner.points}" fill="${y}" stroke="${y}" stroke-width="4" stroke-linejoin="round"/>` +
      mark(56, 40, 1)
    );
  }
  const frame = tri(62, 6, 112, 8);
  const outer = tri(62, 13.5, 98, 8);
  const inner = tri(62, 32, 68, 3);
  return (
    `<polygon points="${frame.points}" fill="#C9C8C5" stroke="#C9C8C5" stroke-width="12" stroke-linejoin="round"/>` +
    `<polygon points="${outer.points}" fill="${k}" stroke="${k}" stroke-width="10" stroke-linejoin="round"/>` +
    `<polygon points="${inner.points}" fill="${y}" stroke="${y}" stroke-width="4" stroke-linejoin="round"/>` +
    mark(62, 46, 1)
  );
}

/** Creates a focusable safety-sign hotspot element. */
export function createSign(
  name: SignName,
  style: SignStyle,
  label: string = SIGNS[name].label.en,
  doc: Document = document,
): HTMLButtonElement {
  const el = doc.createElement('button');
  el.type = 'button';
  el.className = `evx-sign evx-sign--${style}`;
  el.dataset.sign = name;
  el.setAttribute('aria-label', label);
  el.style.setProperty('--evx-sign-size', `${signViewBox(name, style).w}px`);
  el.innerHTML = signSvg(name, style, { title: label });
  const svg = el.querySelector('svg');
  svg?.setAttribute('aria-hidden', 'true');
  svg?.removeAttribute('role');
  svg?.removeAttribute('aria-label');
  svg?.querySelector('title')?.remove();
  return el;
}
