import type { Environment } from './environment.ts';

export interface MissingTranslation {
  path: (string | number)[];
  language: string;
}

const isLocalized = (v: unknown, langs: string[]): v is Record<string, string> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  // Must use at least one enabled language, so records like `{ by, at }` are not mistaken
  // for text.
  return (
    entries.some(([k]) => langs.includes(k)) &&
    entries.every(([k, val]) => /^[a-z]{2}(-[A-Z]{2})?$/.test(k) && typeof val === 'string')
  );
};

/**
 * Lists every localized string that lacks one of the environment's enabled languages
 * (or holds only whitespace). Studio surfaces these before packaging.
 */
export function findMissingTranslations(env: Environment): MissingTranslation[] {
  const out: MissingTranslation[] = [];
  const langs = env.settings.languages;
  const walk = (v: unknown, path: (string | number)[]) => {
    if (isLocalized(v, langs)) {
      for (const lang of langs) if (!v[lang]?.trim()) out.push({ path, language: lang });
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i]));
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        // Skin props and attributes are free-form, not user-facing text.
        if (k === 'tokens' || k === 'attributes' || k === 'props') continue;
        walk(x, [...path, k]);
      }
  };
  walk(env, []);
  return out;
}

/** Picks the best string for `lang`, falling back to `fallback`, then to any value. */
export function localize(
  text: Record<string, string> | undefined,
  lang: string,
  fallback = 'en',
): string {
  if (!text) return '';
  return text[lang] ?? text[lang.slice(0, 2)] ?? text[fallback] ?? Object.values(text)[0] ?? '';
}
