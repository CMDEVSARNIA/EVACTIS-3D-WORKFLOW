/**
 * The 18 Viewer button icons from brand/evactis-button-kit.png, redrawn on a 24 px
 * grid: 2 px round-capped strokes in `currentColor`, matching the kit's line weight.
 * Elements marked `accent` take the icon accent colour (green on the navy states,
 * white on the green "active" state) — only the evac-route arrow uses it, as on the
 * sheet.
 */
export interface IconDef {
  label: { en: string; fr: string };
  /** SVG elements drawn in currentColor. */
  body: string;
  /** SVG elements drawn in the accent colour. */
  accent?: string;
}

const dot = (cx: number, cy: number, r = 1.3) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;

export const ICONS = {
  home: {
    label: { en: 'Home', fr: 'Accueil' },
    body: '<path d="M3.5 11 12 3.8l8.5 7.2"/><path d="M5.8 9.2V20h12.4V9.2"/><path d="M10 20v-5.2h4V20"/>',
  },
  'floor-plan': {
    label: { en: 'Floor plan', fr: 'Plan d’étage' },
    body: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 11H9"/><path d="M12.5 3.5V11h4"/><path d="M13 14.5v6"/>',
  },
  fullscreen: {
    label: { en: 'Full screen', fr: 'Plein écran' },
    body: '<path d="M4 9V4h5"/><path d="M15 4h5v5"/><path d="M20 15v5h-5"/><path d="M9 20H4v-5"/>',
  },
  'fullscreen-exit': {
    label: { en: 'Exit full screen', fr: 'Quitter le plein écran' },
    body: '<path d="M4 9.5h5.5V4"/><path d="M14.5 4v5.5H20"/><path d="M20 14.5h-5.5V20"/><path d="M9.5 20v-5.5H4"/>',
  },
  info: {
    label: { en: 'Information', fr: 'Information' },
    body: `<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/>${dot(12, 7.6)}`,
  },
  help: {
    label: { en: 'Help', fr: 'Aide' },
    body: `<circle cx="12" cy="12" r="9"/><path d="M9.4 9.4a2.7 2.7 0 0 1 5.3.7c0 1.8-2.7 2.3-2.7 4"/>${dot(12, 17.1)}`,
  },
  previous: {
    label: { en: 'Previous', fr: 'Précédent' },
    body: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  },
  next: {
    label: { en: 'Next', fr: 'Suivant' },
    body: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  },
  'sound-on': {
    label: { en: 'Sound on', fr: 'Son activé' },
    body: '<path d="M3.5 9.3h3.3L11 6v12l-4.2-3.3H3.5z"/><path d="M14.6 9.6a3.4 3.4 0 0 1 0 4.8"/><path d="M17.3 7a7.2 7.2 0 0 1 0 10"/>',
  },
  'sound-off': {
    label: { en: 'Sound off', fr: 'Son désactivé' },
    body: '<path d="M3.5 9.3h3.3L11 6v12l-4.2-3.3H3.5z"/><path d="m15 10 4 4"/><path d="m19 10-4 4"/>',
  },
  close: {
    label: { en: 'Close', fr: 'Fermer' },
    body: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  },
  menu: {
    label: { en: 'Menu', fr: 'Menu' },
    body: '<path d="M4 6.5h16"/><path d="M4 12h16"/><path d="M4 17.5h16"/>',
  },
  'start-module': {
    label: { en: 'Start training module', fr: 'Commencer le module de formation' },
    body: '<circle cx="12" cy="12" r="9"/><path d="M10.2 8.6v6.8l5.2-3.4z" fill="currentColor"/>',
  },
  checklist: {
    label: { en: 'Checklist', fr: 'Liste de vérification' },
    body: '<path d="m3.5 6.3 1.4 1.4 2.6-2.6"/><path d="M10.5 6.5h10"/><path d="m3.5 11.8 1.4 1.4 2.6-2.6"/><path d="M10.5 12h10"/><path d="m3.5 17.3 1.4 1.4 2.6-2.6"/><path d="M10.5 17.5h10"/>',
  },
  'zoom-in': {
    label: { en: 'Zoom in', fr: 'Zoom avant' },
    body: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 5.2 5.2"/><path d="M10.5 7.6v5.8"/><path d="M7.6 10.5h5.8"/>',
  },
  'zoom-out': {
    label: { en: 'Zoom out', fr: 'Zoom arrière' },
    body: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 5.2 5.2"/><path d="M7.6 10.5h5.8"/>',
  },
  vr: {
    label: { en: 'VR headset', fr: 'Casque de RV' },
    body: '<path d="M4.5 7.5h15a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-4l-2.1-2.4a1.9 1.9 0 0 0-2.8 0L8.5 16.5h-4A1.5 1.5 0 0 1 3 15V9a1.5 1.5 0 0 1 1.5-1.5z"/>',
  },
  'evac-route': {
    label: { en: 'Evacuation route', fr: 'Itinéraire d’évacuation' },
    body: '<path d="M14 8V4.5H5.5v15H14V16"/>',
    accent: '<path d="M9.5 12h11"/><path d="m17 8.5 3.5 3.5-3.5 3.5"/>',
  },
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconSvgOptions {
  /** Main stroke colour. Default `currentColor`. */
  color?: string;
  /**
   * Accent colour. Default uses the `--evx-icon-accent` custom property so the
   * button states can switch it; pass a hex for standalone SVG files.
   */
  accent?: string;
  /** Rendered size in px; omitted = scales with its container. */
  size?: number;
  /** Adds role="img" + <title>; otherwise the icon is aria-hidden (decorative). */
  title?: string;
}

/** Returns a standalone `<svg>` string for an icon. */
export function iconSvg(name: IconName, opts: IconSvgOptions = {}): string {
  const def: IconDef = ICONS[name];
  const color = opts.color ?? 'currentColor';
  const accent = opts.accent ?? 'var(--evx-icon-accent, #71B043)';
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
  const a11y = opts.title
    ? ` role="img" aria-label="${escapeXml(opts.title)}"`
    : ' aria-hidden="true" focusable="false"';
  const titleEl = opts.title ? `<title>${escapeXml(opts.title)}</title>` : '';
  const body = color === 'currentColor' ? def.body : def.body.replaceAll('currentColor', color);
  const accentGroup = def.accent ? `<g stroke="${accent}">${def.accent}</g>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"${size} fill="none" ` +
    `stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"` +
    `${a11y}>${titleEl}${body}${accentGroup}</svg>`
  );
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
