import { createButton, createMarker, createSign } from '@evactis-3dworkflow/brand';
import { describe, expect, it } from 'vitest';
import { artOf, standaloneSvg } from '../src/vr.ts';

/** VR draws hotspots from the same kit artwork as the screen, as standalone images. */
describe('VR artwork', () => {
  it('makes kit SVG standalone: no CSS variables or currentColor, a drawing size', () => {
    const { markup, height } = standaloneSvg(
      '<svg viewBox="0 0 40 20" width="9"><path stroke="currentColor" fill="var(--evx-icon-accent, #71B043)"/></svg>',
      200,
    );
    expect(height).toBe(100);
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(markup).toContain('width="200" height="100"');
    expect(markup).not.toContain('width="9"');
    expect(markup).not.toMatch(/var\(|currentColor/);
    expect(markup).toContain('fill="#71B043"');
  });

  it('takes each hotspot kind from its element', () => {
    const button = artOf(createButton({ icon: 'next', label: 'Go' }));
    expect(button).toMatchObject({ plate: true });
    expect('svg' in button && button.svg).toContain('<svg');
    const sign = artOf(createSign('fire-extinguisher', 'A', 'Extinguisher'));
    expect('svg' in sign && !sign.plate).toBe(true);
    expect('svg' in artOf(createMarker({ marker: 'info', label: 'Info' }))).toBe(true);
    const text = document.createElement('button');
    text.textContent = ' FACP ';
    expect(artOf(text)).toEqual({ text: 'FACP' });
  });
});
