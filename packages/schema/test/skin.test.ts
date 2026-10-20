import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIN, SkinSchema, breakpointFor, placementFor } from '../src/index.ts';

describe('skins', () => {
  const skin = SkinSchema.parse(DEFAULT_SKIN);
  const el = (id: string) => skin.elements.find((e) => e.id === id)!;

  it('picks breakpoints by width, kiosk by deployment', () => {
    expect(breakpointFor(skin, 375)).toBe('phone');
    expect(breakpointFor(skin, 600)).toBe('phone');
    expect(breakpointFor(skin, 768)).toBe('tablet');
    expect(breakpointFor(skin, 1440)).toBe('desktop');
    expect(breakpointFor(skin, 1920)).toBe('desktop');
    expect(breakpointFor(skin, 1080, true)).toBe('kiosk');
  });

  it('cascades placements: desktop, then tablet, then phone; kiosk from desktop', () => {
    const toolbar = el('toolbar');
    expect(placementFor(toolbar, 'desktop')).toMatchObject({ anchor: 'bottom', scale: 1 });
    expect(placementFor(toolbar, 'tablet')).toMatchObject({ anchor: 'bottom', scale: 0.85 });
    // Phone inherits the tablet's anchor and overrides scale and buttons.
    expect(placementFor(toolbar, 'phone')).toMatchObject({ anchor: 'bottom', scale: 0.75, x: 8 });
    expect(placementFor(toolbar, 'phone').buttons).toHaveLength(6);
    expect(placementFor(toolbar, 'kiosk').buttons).not.toContain('fullscreen');
    expect(placementFor(el('radar'), 'phone').hidden).toBe(true);
    expect(placementFor(el('radar'), 'tablet').hidden).toBe(false);
  });

  it('only accepts colour and length tokens (nothing that could fetch)', () => {
    const ok = SkinSchema.safeParse({
      ...DEFAULT_SKIN,
      tokens: { '--evx-navy': '#123456', '--evx-btn-size': '64px' },
    });
    expect(ok.success).toBe(true);
    for (const bad of [
      { '--evx-navy': 'url(https://example.com/x.png)' },
      { '--evx-navy': 'red; background: url(x)' },
      { color: '#fff' },
    ])
      expect(SkinSchema.safeParse({ ...DEFAULT_SKIN, tokens: bad }).success).toBe(false);
  });

  it('keeps the evac-route, floor-plan and menu buttons on every breakpoint', () => {
    for (const bp of ['phone', 'tablet', 'desktop', 'kiosk'] as const)
      expect(placementFor(el('toolbar'), bp).buttons).toEqual(
        expect.arrayContaining(['evac-route', 'floor-plan', 'menu']),
      );
  });
});
