import { describe, expect, it } from 'vitest';
import { STRINGS, detectLang } from './i18n.ts';

describe('viewer strings', () => {
  it('French and English have the same keys and no empty values', () => {
    expect(Object.keys(STRINGS.fr).sort()).toEqual(Object.keys(STRINGS.en).sort());
    for (const lang of ['en', 'fr'] as const)
      for (const v of Object.values(STRINGS[lang])) expect(v.trim()).not.toBe('');
  });
  it('detects French locales', () => {
    expect(detectLang({ language: 'fr-CA' })).toBe('fr');
    expect(detectLang({ language: 'en-CA' })).toBe('en');
    expect(detectLang({})).toBe('en');
  });
});
