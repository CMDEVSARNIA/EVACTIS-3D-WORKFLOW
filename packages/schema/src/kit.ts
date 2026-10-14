import { z } from 'zod';

/**
 * Names from the Evactis button kit (brand/evactis-button-kit.png). The brand package
 * ships one SVG per name; a test in @evactis-3dworkflow/brand keeps the lists in sync.
 */
export const BUTTON_ICON_NAMES = [
  'home',
  'floor-plan',
  'fullscreen',
  'fullscreen-exit',
  'info',
  'help',
  'previous',
  'next',
  'sound-on',
  'sound-off',
  'close',
  'menu',
  'start-module',
  'checklist',
  'zoom-in',
  'zoom-out',
  'vr',
  'evac-route',
] as const;
export const ButtonIconNameSchema = z.enum(BUTTON_ICON_NAMES);
export type ButtonIconName = z.infer<typeof ButtonIconNameSchema>;

export const MARKER_NAMES = ['evac-route', 'info'] as const;
export const MarkerNameSchema = z.enum(MARKER_NAMES);
export type MarkerName = z.infer<typeof MarkerNameSchema>;

export const SAFETY_SIGN_NAMES = [
  'emergency-exit',
  'first-aid',
  'aed',
  'assembly-point',
  'fire-extinguisher',
  'fire-alarm',
  'warning',
] as const;
export const SafetySignNameSchema = z.enum(SAFETY_SIGN_NAMES);
export type SafetySignName = z.infer<typeof SafetySignNameSchema>;

/** A: thin white border. B: thicker light-grey frame. */
export const SafetySignStyleSchema = z.enum(['A', 'B']);
export type SafetySignStyle = z.infer<typeof SafetySignStyleSchema>;
