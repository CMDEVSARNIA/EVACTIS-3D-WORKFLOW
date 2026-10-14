/**
 * Evactis design tokens. Colour values were sampled from the reference images in
 * /brand (see docs/brand-usage.md for the sampling table). `tokens.css` is generated
 * from this file by `pnpm brand:generate`; never edit the CSS by hand.
 */
export const colors = {
  /** Logo "E", wordmark, button fill. Sampled: logo mark, button kit, website header. */
  navy: '#0A2F5B',
  /** Logo arrow, hover outline/indicator, accent rules, eyebrow text on dark. */
  green: '#71B043',
  /** Selected button fill, primary CTA ("Request a Consultation"), wordmark "I". */
  greenStrong: '#5D9518',
  /** Website dark background. */
  ink: '#0A0A0A',
  /** Dark green radial glow behind website sections. */
  surfaceDark: '#101809',
  /** Website header bar. */
  paper: '#FAFAFA',
  white: '#FFFFFF',
  /** Website lead paragraph on dark. */
  textMuted: '#CCCCCC',
  /** Website bullet copy on dark. */
  textSubtle: '#A3A3A3',
  /** Square bullet tile behind the green dot. */
  bulletTile: '#1F2911',
  /** Safety-sign colours from the button kit (ISO 7010 colour families). */
  safeGreen: '#00843D',
  fireRed: '#C8102E',
  warningYellow: '#F2C230',
  warningBorder: '#1A1A1A',
  /** Light-grey ring on markers and the style-B sign frame. */
  frameGrey: '#C8C7C4',
} as const;

export type ColorToken = keyof typeof colors;

export const fonts = {
  /** Body and UI: Inter (variable, bundled). */
  body: "'Inter Variable', 'Inter', 'Segoe UI', system-ui, sans-serif",
  /** Headings: heavy, tight Inter in caps, as on evactis.ca. */
  heading: "'Inter Variable', 'Inter', 'Segoe UI', system-ui, sans-serif",
} as const;

export const button = {
  /** Size at 1x, from the kit sheet (80 px buttons). */
  size: 80,
  /** Corner radius as a fraction of size. */
  radius: 0.18,
  /** Icon box as a fraction of size. */
  iconScale: 0.55,
  /** Indicator bar: width fractions for default/hover, height fraction, bottom offset. */
  indicatorShort: 0.26,
  indicatorLong: 0.62,
  indicatorHeight: 0.05,
  indicatorBottom: 0.11,
  /** Hover outline width as a fraction of size. */
  outline: 0.04,
} as const;

/** CSS custom properties, in the order they are written to tokens.css. */
export const cssVariables: Record<string, string> = {
  '--evx-navy': colors.navy,
  '--evx-green': colors.green,
  '--evx-green-strong': colors.greenStrong,
  '--evx-ink': colors.ink,
  '--evx-surface-dark': colors.surfaceDark,
  '--evx-paper': colors.paper,
  '--evx-white': colors.white,
  '--evx-text-muted': colors.textMuted,
  '--evx-text-subtle': colors.textSubtle,
  '--evx-bullet-tile': colors.bulletTile,
  '--evx-safe-green': colors.safeGreen,
  '--evx-fire-red': colors.fireRed,
  '--evx-warning-yellow': colors.warningYellow,
  '--evx-warning-border': colors.warningBorder,
  '--evx-frame-grey': colors.frameGrey,
  '--evx-font-body': fonts.body,
  '--evx-font-heading': fonts.heading,
  '--evx-btn-size': `${button.size}px`,
  '--evx-btn-radius': `${button.radius * 100}%`,
  '--evx-shadow-soft': '0 4px 10px rgb(0 0 0 / 0.35), 0 1px 2px rgb(0 0 0 / 0.3)',
};

/** Serialises the tokens to the contents of tokens.css. */
export function tokensToCss(): string {
  const lines = Object.entries(cssVariables).map(([k, v]) => `  ${k}: ${v};`);
  return [
    '/* Generated from src/tokens.ts by `pnpm brand:generate`. Do not edit. */',
    ':root {',
    ...lines,
    '}',
    '',
  ].join('\n');
}

/** WCAG relative luminance of a #RRGGBB colour. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two #RRGGBB colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
