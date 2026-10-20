/**
 * Skin editing operations (Phase 7). An environment without a skin is delivered with
 * the Evactis default; the first edit copies the default in, so authors always start
 * from it. Placements are stored per breakpoint as overrides of the one they inherit
 * from (desktop ← tablet ← phone, desktop ← kiosk).
 */
import {
  DEFAULT_SKIN,
  SKIN_TOKEN_VALUE,
  SkinSchema,
  type Breakpoint,
  type Environment,
  type LocalizedText,
  type Placement,
  type Skin,
  type SkinCommand,
} from '@evactis-3dworkflow/schema';
import { colors, contrast } from '@evactis-3dworkflow/brand';
import { EditError } from './ops.ts';

/** The skin the delivered Viewer will use. */
export function effectiveSkin(env: Environment): Skin {
  return env.skin ?? SkinSchema.parse(DEFAULT_SKIN);
}

function skin(env: Environment): Skin {
  env.skin ??= SkinSchema.parse(DEFAULT_SKIN);
  return env.skin;
}

function element(env: Environment, id: string) {
  const e = skin(env).elements.find((x) => x.id === id);
  if (!e) throw new EditError(`unknown skin element ${id}`);
  return e;
}

const r0 = (n: number) => Math.round(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Changes an element's placement at one breakpoint (the others keep inheriting). */
export function setPlacement(env: Environment, id: string, bp: Breakpoint, patch: Placement) {
  const e = element(env, id);
  const clean: Placement = { ...patch };
  if (clean.x !== undefined) clean.x = Math.max(0, Math.min(400, r0(clean.x)));
  if (clean.y !== undefined) clean.y = Math.max(0, Math.min(400, r0(clean.y)));
  if (clean.scale !== undefined) clean.scale = Math.max(0.5, Math.min(2.5, r2(clean.scale)));
  e.layout[bp] = { ...(e.layout[bp] ?? {}), ...clean };
}

/** Removes a breakpoint's overrides: it inherits again. Desktop is the base and stays. */
export function inherit(env: Environment, id: string, bp: Breakpoint) {
  if (bp === 'desktop') throw new EditError('desktop is the base layout');
  delete element(env, id).layout[bp];
}

/** Toolbar buttons at a breakpoint, in order. Menu, floor plan and evac route stay. */
export function setToolbarButtons(
  env: Environment,
  id: string,
  bp: Breakpoint,
  buttons: SkinCommand[],
) {
  const e = element(env, id);
  if (e.type !== 'toolbar') throw new EditError('only toolbars have buttons');
  for (const keep of ['menu', 'evac-route'] as const)
    if (!buttons.includes(keep)) throw new EditError(`the ${keep} button stays on every screen`);
  setPlacement(env, id, bp, { buttons: [...new Set(buttons)] });
}

/**
 * The theme tokens authors may change. Safety colours (ISO 7010 families) and the
 * layout insets the Viewer publishes are not among them.
 */
export const THEME_TOKENS = {
  '--evx-navy': colors.navy,
  '--evx-green': colors.green,
  '--evx-green-strong': colors.greenStrong,
  '--evx-white': colors.white,
  '--evx-btn-radius': '18%',
} as const;
export type ThemeToken = keyof typeof THEME_TOKENS;

/** Colour pairs that must stay legible, with the WCAG minimum for each. */
export const CONTRAST_RULES: {
  fg: ThemeToken | '#0A0A0A';
  bg: ThemeToken | '#0A0A0A';
  min: number;
  what: 'icons' | 'active' | 'eyebrow';
}[] = [
  // Icons and small text (menu, language switch) on the button face and panels.
  { fg: '--evx-white', bg: '--evx-navy', min: 4.5, what: 'icons' },
  // Icon on a pressed button (non-text, 3:1).
  { fg: '--evx-white', bg: '--evx-green-strong', min: 3, what: 'active' },
  // Eyebrow labels on the title plate.
  { fg: '--evx-green', bg: '#0A0A0A', min: 4.5, what: 'eyebrow' },
];

/** The value of a theme token in this skin (the brand value unless changed). */
export function tokenValue(sk: Skin, name: ThemeToken): string {
  return sk.tokens[name] ?? THEME_TOKENS[name];
}

/** Contrast of every rule with this skin's tokens. */
export function contrastReport(sk: Skin) {
  const v = (x: ThemeToken | '#0A0A0A') =>
    x.startsWith('#') ? x : tokenValue(sk, x as ThemeToken);
  return CONTRAST_RULES.map((r) => ({ ...r, ratio: contrast(v(r.fg), v(r.bg)) }));
}

/** Contrast below a rule's minimum. */
export class ContrastError extends EditError {
  constructor(
    readonly what: 'icons' | 'active' | 'eyebrow',
    readonly ratio: number,
    readonly min: number,
  ) {
    super(`contrast ${ratio.toFixed(1)}:1 is below ${min}:1 (${what})`);
  }
}

/**
 * Sets a theme token; null restores the brand value. Colours are #RRGGBB, the radius a
 * length; a colour that would make icons or labels hard to read is refused.
 */
export function setToken(env: Environment, name: string, value: string | null) {
  if (!(name in THEME_TOKENS)) throw new EditError(`not a theme token: ${name}`);
  const s = skin(env);
  if (value === null) {
    delete s.tokens[name];
    return;
  }
  const colour = name !== '--evx-btn-radius';
  if (
    colour
      ? !/^#[0-9a-fA-F]{6}$/.test(value)
      : !SKIN_TOKEN_VALUE.test(value) || value.startsWith('#')
  )
    throw new EditError(colour ? 'colours are #RRGGBB' : 'the radius is a length (px or %)');
  const next = { ...s, tokens: { ...s.tokens, [name]: colour ? value.toUpperCase() : value } };
  for (const r of contrastReport(next))
    if (r.ratio < r.min) throw new ContrastError(r.what, r.ratio, r.min);
  s.tokens = next.tokens;
}

export function renameSkin(env: Environment, name: string) {
  if (!name.trim()) throw new EditError('a skin needs a name');
  skin(env).name = name.trim().slice(0, 80);
}

/** Back to the Evactis default (the environment carries no skin of its own). */
export function resetSkin(env: Environment) {
  delete env.skin;
}

/** Client co-branding shown next to the Evactis lockup. */
export function setBranding(
  env: Environment,
  patch: { coBrand?: boolean; clientName?: LocalizedText | null; clientLogo?: string | null },
) {
  const b = env.settings.branding;
  if (patch.coBrand !== undefined) b.coBrand = patch.coBrand;
  if (patch.clientName !== undefined) {
    if (patch.clientName && Object.values(patch.clientName).some((v) => v))
      b.clientName = patch.clientName;
    else delete b.clientName;
  }
  if (patch.clientLogo !== undefined) {
    if (patch.clientLogo) b.clientLogo = patch.clientLogo;
    else delete b.clientLogo;
  }
}

/**
 * The file a client logo is shown from. Photo import flattens images onto black for
 * the album copy, so a PNG or WebP logo keeps its transparency from the original.
 */
export function logoPath(asset: { source: string; preview?: string }): string {
  return /\.(png|webp|jpe?g)$/i.test(asset.source) ? asset.source : (asset.preview ?? asset.source);
}

/** Widths (CSS px) up to which the phone and tablet layouts apply. */
export function setBreakpoints(env: Environment, widths: { phone?: number; tablet?: number }) {
  const s = skin(env);
  const phone = Math.round(widths.phone ?? s.breakpoints.phone);
  const tablet = Math.round(widths.tablet ?? s.breakpoints.tablet);
  if (phone < 320 || tablet > 2000 || phone >= tablet)
    throw new EditError('the phone width must be at least 320 px and below the tablet width');
  s.breakpoints = { phone, tablet };
}
