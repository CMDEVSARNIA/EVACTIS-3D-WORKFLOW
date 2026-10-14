// @vitest-environment jsdom
import { BUTTON_ICON_NAMES, SAFETY_SIGN_NAMES, MARKER_NAMES } from '@evactis-3dworkflow/schema';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ICON_NAMES,
  ICONS,
  SIGN_NAMES,
  colors,
  contrast,
  createButton,
  createMarker,
  cssVariables,
  iconSvg,
  setButtonIcon,
  setButtonPressed,
  signSvg,
  tokensToCss,
} from '../src/index.ts';

describe('kit names', () => {
  it('match the schema so environments can only reference shipped artwork', () => {
    expect([...ICON_NAMES].sort()).toEqual([...BUTTON_ICON_NAMES].sort());
    expect([...SIGN_NAMES].sort()).toEqual([...SAFETY_SIGN_NAMES].sort());
    expect([...MARKER_NAMES].sort()).toEqual(['evac-route', 'info']);
  });

  it('ships all 18 icons with English and French labels', () => {
    expect(ICON_NAMES).toHaveLength(18);
    for (const name of ICON_NAMES) {
      expect(ICONS[name].label.en.length).toBeGreaterThan(0);
      expect(ICONS[name].label.fr.length).toBeGreaterThan(0);
    }
  });
});

describe('tokens', () => {
  it('tokens.css is generated from tokens.ts', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    expect(readFileSync(join(here, '../src/tokens.css'), 'utf8')).toBe(tokensToCss());
  });

  it('every colour token is a #RRGGBB hex', () => {
    for (const v of Object.values(colors)) expect(v).toMatch(/^#[0-9A-F]{6}$/);
    expect(cssVariables['--evx-navy']).toBe(colors.navy);
  });

  // Non-text contrast (WCAG 1.4.11) for icon on button face, and text contrast for chrome.
  it.each([
    ['white icon on navy', colors.white, colors.navy, 4.5],
    ['white icon on green-strong (active)', colors.white, colors.greenStrong, 3],
    ['navy bar on green-strong (active)', colors.navy, colors.greenStrong, 3],
    ['green bar on navy (hover)', colors.green, colors.navy, 3],
    ['white heading on ink', colors.white, colors.ink, 7],
    ['muted body on ink', colors.textMuted, colors.ink, 4.5],
    ['subtle body on ink', colors.textSubtle, colors.ink, 4.5],
    ['green eyebrow on ink', colors.green, colors.ink, 4.5],
    ['navy heading on paper', colors.navy, colors.paper, 7],
    ['white on safe green', colors.white, colors.safeGreen, 4.5],
    ['white on fire red', colors.white, colors.fireRed, 4.5],
    ['black on warning yellow', colors.warningBorder, colors.warningYellow, 7],
  ])('%s ≥ %f:1', (_n, fg, bg, min) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

describe('icons', () => {
  it('render on a 24 px grid with no external references', () => {
    for (const name of ICON_NAMES) {
      const svg = iconSvg(name);
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).not.toMatch(/href=|url\(http|https?:\/\/(?!www\.w3\.org)/);
    }
  });

  it('only the evac-route icon uses the accent colour', () => {
    const accented = ICON_NAMES.filter((n) => iconSvg(n).includes('--evx-icon-accent'));
    expect(accented).toEqual(['evac-route']);
  });

  it('is decorative unless titled', () => {
    expect(iconSvg('home')).toContain('aria-hidden="true"');
    expect(iconSvg('home', { title: 'Accueil' })).toContain('<title>Accueil</title>');
  });
});

describe('button component', () => {
  it('creates an accessible button with the localised label', () => {
    const b = createButton({ icon: 'floor-plan', lang: 'fr' });
    expect(b.tagName).toBe('BUTTON');
    expect(b.type).toBe('button');
    expect(b.getAttribute('aria-label')).toBe('Plan d’étage');
    expect(b.querySelector('.evx-btn__bar')).not.toBeNull();
    expect(b.hasAttribute('aria-pressed')).toBe(false);
  });

  it('supports toggle state and icon swaps', () => {
    const b = createButton({ icon: 'sound-on', pressed: false });
    setButtonPressed(b, true);
    expect(b.getAttribute('aria-pressed')).toBe('true');
    setButtonIcon(b, 'sound-off');
    expect(b.dataset.icon).toBe('sound-off');
    expect(b.getAttribute('aria-label')).toBe('Sound off');
    expect(b.querySelectorAll('svg')).toHaveLength(1);
  });

  it('escapes custom labels', () => {
    const b = createButton({ icon: 'info', label: '<img src=x onerror=alert(1)>' });
    expect(b.querySelector('img')).toBeNull();
    expect(b.getAttribute('aria-label')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('markers and signs', () => {
  it('marker buttons expose one accessible name and hide inner SVGs', () => {
    const m = createMarker({ marker: 'info', label: 'Electrical room', attention: true });
    expect(m.getAttribute('aria-label')).toBe('Electrical room');
    expect(m.dataset.attention).toBe('true');
    m.querySelectorAll('svg').forEach((s) => expect(s.getAttribute('aria-hidden')).toBe('true'));
  });

  it('every sign renders in both styles with its colour family', () => {
    for (const name of SIGN_NAMES)
      for (const style of ['A', 'B'] as const) {
        const svg = signSvg(name, style);
        expect(svg).toContain('role="img"');
        const fam =
          name === 'warning'
            ? colors.warningYellow
            : ['fire-extinguisher', 'fire-alarm'].includes(name)
              ? colors.fireRed
              : colors.safeGreen;
        expect(svg).toContain(fam);
      }
  });
});
