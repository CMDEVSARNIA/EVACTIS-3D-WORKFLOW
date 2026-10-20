import { z } from 'zod';
import { IdSchema } from './primitives.ts';

/**
 * Skins: the Viewer's interface around the panorama (toolbar, logo, scene title,
 * radar, language switch), laid out per breakpoint. Each element sits at one of nine
 * anchors; elements sharing an anchor stack in order, so they never overlap each
 * other. Placements cascade: desktop is the base, tablet and kiosk override desktop,
 * phone overrides tablet.
 */

export const BREAKPOINTS = ['phone', 'tablet', 'desktop', 'kiosk'] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];

export const ANCHORS = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
] as const;
export type Anchor = (typeof ANCHORS)[number];

/** What a toolbar button does. `sound` toggles mute; `vr` shows only where VR works. */
export const SKIN_COMMANDS = [
  'home',
  'previous',
  'next',
  'floor-plan',
  'evac-route',
  'menu',
  'info',
  'help',
  'sound',
  'zoom-in',
  'zoom-out',
  'fullscreen',
  'vr',
] as const;
export type SkinCommand = (typeof SKIN_COMMANDS)[number];

export const SKIN_ELEMENT_TYPES = ['toolbar', 'logo', 'title', 'radar', 'language'] as const;
export type SkinElementType = (typeof SKIN_ELEMENT_TYPES)[number];

export const PlacementSchema = z.object({
  anchor: z.enum(ANCHORS).optional(),
  /** Inset from the anchor's edges, CSS px. */
  x: z.number().min(0).max(400).optional(),
  y: z.number().min(0).max(400).optional(),
  scale: z.number().min(0.5).max(2.5).optional(),
  hidden: z.boolean().optional(),
  /** Toolbars: a row or a column. */
  orientation: z.enum(['horizontal', 'vertical']).optional(),
  /** Toolbars: the buttons shown here, in order; the rest move into the menu. */
  buttons: z.array(z.enum(SKIN_COMMANDS)).optional(),
});
export type Placement = z.infer<typeof PlacementSchema>;

export const SkinElementSchema = z.object({
  id: IdSchema,
  type: z.enum(SKIN_ELEMENT_TYPES),
  layout: z
    .object({
      phone: PlacementSchema.optional(),
      tablet: PlacementSchema.optional(),
      desktop: PlacementSchema,
      kiosk: PlacementSchema.optional(),
    })
    .strict(),
});
export type SkinElement = z.infer<typeof SkinElementSchema>;

/**
 * Theme tokens override the brand's CSS custom properties. Values are limited to
 * colours and lengths: anything else (notably `url(…)`) could make the page fetch.
 */
export const SKIN_TOKEN_NAME = /^--evx-[a-z0-9-]+$/;
export const SKIN_TOKEN_VALUE =
  /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|\d+(\.\d+)?(px|rem|em|%)?)$/;

export const SkinSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(80),
  tokens: z
    .record(
      z.string().regex(SKIN_TOKEN_NAME, 'Token names start with --evx-'),
      z.string().regex(SKIN_TOKEN_VALUE, 'Tokens take a hex colour or a length'),
    )
    .default({}),
  /** Widths (CSS px, inclusive) up to which the phone and tablet layouts apply. */
  breakpoints: z
    .object({
      phone: z.number().int().min(320).max(1200).default(600),
      tablet: z.number().int().min(480).max(2000).default(1100),
    })
    .default({ phone: 600, tablet: 1100 }),
  elements: z.array(SkinElementSchema).default([]),
});
export type Skin = z.infer<typeof SkinSchema>;
export type SkinInput = z.input<typeof SkinSchema>;

/** Kiosk applies when the deployment says so (any size, any orientation). */
export function breakpointFor(skin: Skin, width: number, kiosk = false): Breakpoint {
  if (kiosk) return 'kiosk';
  if (width <= skin.breakpoints.phone) return 'phone';
  if (width <= skin.breakpoints.tablet) return 'tablet';
  return 'desktop';
}

/** The placement in effect: desktop ← tablet ← phone, desktop ← kiosk. */
export function placementFor(
  el: SkinElement,
  bp: Breakpoint,
): Required<Pick<Placement, 'anchor' | 'x' | 'y' | 'scale' | 'hidden'>> & Placement {
  const chain: (Placement | undefined)[] =
    bp === 'phone'
      ? [el.layout.desktop, el.layout.tablet, el.layout.phone]
      : bp === 'tablet'
        ? [el.layout.desktop, el.layout.tablet]
        : bp === 'kiosk'
          ? [el.layout.desktop, el.layout.kiosk]
          : [el.layout.desktop];
  const p: Placement = Object.assign({}, ...chain.filter(Boolean));
  return { anchor: 'top-left', x: 16, y: 16, scale: 1, hidden: false, ...p };
}

const ALL_BUTTONS: SkinCommand[] = [...SKIN_COMMANDS];

/**
 * The Evactis default skin: the button kit as a bottom toolbar (fewer buttons on
 * smaller screens; the rest in the menu), the plate lockup top-left with the scene
 * title under it as a website-style eyebrow, the radar and language switch top-right.
 * Kiosks get bigger touch targets and no full-screen button.
 */
export const DEFAULT_SKIN: SkinInput = {
  id: 'evactis-default',
  name: 'Evactis default',
  breakpoints: { phone: 600, tablet: 1100 },
  elements: [
    {
      id: 'logo',
      type: 'logo',
      layout: {
        desktop: { anchor: 'top-left', x: 16, y: 16, scale: 1 },
        phone: { x: 10, y: 10, scale: 0.75 },
        kiosk: { x: 28, y: 28, scale: 1.4 },
      },
    },
    {
      id: 'title',
      type: 'title',
      layout: {
        desktop: { anchor: 'top-left', x: 16, y: 12, scale: 1 },
        tablet: { scale: 0.9 },
        phone: { x: 10, y: 8, scale: 0.8 },
        kiosk: { x: 28, y: 16, scale: 1.4 },
      },
    },
    {
      id: 'language',
      type: 'language',
      layout: {
        desktop: { anchor: 'top-right', x: 16, y: 16 },
        phone: { x: 10, y: 10 },
        kiosk: { x: 28, y: 28, scale: 1.4 },
      },
    },
    {
      id: 'radar',
      type: 'radar',
      layout: {
        desktop: { anchor: 'top-right', x: 16, y: 12 },
        phone: { hidden: true },
        kiosk: { x: 28, y: 16, scale: 1.5 },
      },
    },
    {
      id: 'toolbar',
      type: 'toolbar',
      layout: {
        desktop: {
          anchor: 'bottom',
          x: 16,
          y: 16,
          scale: 1,
          orientation: 'horizontal',
          buttons: ALL_BUTTONS,
        },
        tablet: {
          scale: 0.85,
          buttons: [
            'home',
            'previous',
            'next',
            'floor-plan',
            'evac-route',
            'menu',
            'info',
            'sound',
            'zoom-in',
            'zoom-out',
            'fullscreen',
          ],
        },
        phone: {
          x: 8,
          y: 10,
          scale: 0.75,
          buttons: ['menu', 'previous', 'floor-plan', 'evac-route', 'next', 'home'],
        },
        kiosk: {
          x: 28,
          y: 28,
          scale: 1.25,
          buttons: [
            'home',
            'previous',
            'next',
            'floor-plan',
            'evac-route',
            'menu',
            'info',
            'help',
            'sound',
            'zoom-in',
            'zoom-out',
          ],
        },
      },
    },
  ],
};
