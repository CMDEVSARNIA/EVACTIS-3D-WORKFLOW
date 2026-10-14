import { ICONS, escapeXml, iconSvg, type IconName } from './icons.ts';

/**
 * The Evactis Viewer button (brand/evactis-button-kit.png), framework-free.
 *
 * States, left to right on the sheet:
 * - default: navy fill, short green indicator bar
 * - hover / keyboard focus: navy fill, green outline, full-width green bar
 * - active / selected (`aria-pressed="true"`): green fill, navy bar
 *
 * Styling lives in button.css. `data-state` forces a state for the brand sheet and
 * visual tests; real UIs rely on :hover, :focus-visible and aria-pressed.
 */
export type ButtonState = 'default' | 'hover' | 'active';

export interface ButtonOptions {
  icon: IconName;
  /** Accessible name. Defaults to the icon's label in `lang`. */
  label?: string;
  lang?: 'en' | 'fr';
  /** Makes the button a toggle (aria-pressed). */
  pressed?: boolean;
  /** Force a visual state (brand sheet, screenshots). */
  state?: ButtonState;
}

function labelFor(opts: ButtonOptions): string {
  return opts.label ?? ICONS[opts.icon].label[opts.lang ?? 'en'];
}

/** Static HTML for a button. */
export function buttonHtml(opts: ButtonOptions): string {
  const label = escapeXml(labelFor(opts));
  const pressed = opts.pressed === undefined ? '' : ` aria-pressed="${opts.pressed}"`;
  const state = opts.state ? ` data-state="${opts.state}"` : '';
  return (
    `<button type="button" class="evx-btn" data-icon="${opts.icon}" aria-label="${label}" title="${label}"${pressed}${state}>` +
    `${iconSvg(opts.icon)}<span class="evx-btn__bar" aria-hidden="true"></span></button>`
  );
}

/** Creates a button element. */
export function createButton(opts: ButtonOptions, doc: Document = document): HTMLButtonElement {
  const tpl = doc.createElement('template');
  tpl.innerHTML = buttonHtml(opts);
  return tpl.content.firstElementChild as HTMLButtonElement;
}

/** Sets a toggle button's selected state. */
export function setButtonPressed(button: HTMLButtonElement, pressed: boolean): void {
  button.setAttribute('aria-pressed', String(pressed));
}

/** Swaps the icon (e.g. sound-on ↔ sound-off, fullscreen ↔ fullscreen-exit). */
export function setButtonIcon(
  button: HTMLButtonElement,
  icon: IconName,
  lang: 'en' | 'fr' = 'en',
): void {
  const label = ICONS[icon].label[lang];
  button.dataset.icon = icon;
  button.setAttribute('aria-label', label);
  button.title = label;
  const tpl = button.ownerDocument.createElement('template');
  tpl.innerHTML = iconSvg(icon);
  button.querySelector('svg')?.replaceWith(tpl.content.firstElementChild as SVGElement);
}
