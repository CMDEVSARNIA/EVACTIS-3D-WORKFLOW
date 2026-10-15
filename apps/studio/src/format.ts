import { createEmptyEnvironment } from '@evactis-3dworkflow/schema';
import { isCommandError } from './api.ts';
import type { Lang, Strings } from './i18n.ts';

/** Localised sentence for a command error (codes come from Rust, see studio.rs). */
export function describeError(t: Strings, e: unknown): string {
  if (!isCommandError(e)) return t.errors.unknown + String(e);
  const prefix = t.errors[e.code as keyof Strings['errors']] ?? t.errors.unknown;
  // Codes whose sentence is complete on its own.
  if (e.code === 'cancelled' || e.code === 'duplicate' || e.code === 'no-project') return prefix;
  return prefix + e.message;
}

export function formatBytes(bytes: number, lang: Lang): string {
  const units = lang === 'fr' ? ['o', 'Ko', 'Mo', 'Go'] : ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const n = new Intl.NumberFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    maximumFractionDigits: i === 0 ? 0 : 1,
  }).format(v);
  return `${n} ${units[i]}`;
}

export function formatNumber(n: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-CA' : 'en-CA').format(n);
}

/** Notes from Rust start with a stable code ("low-resolution: …"); show them localised. */
export function describeWarning(t: Strings, warning: string, lang: Lang): string {
  const m = /^low-resolution: (\d+) px/.exec(warning);
  if (m) return t.lowResolution(formatNumber(Number(m[1]), lang));
  return warning;
}

/** Environment ID derived from the project name (schema IDs are ASCII). */
export function projectId(name: string): string {
  const id = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+|-+$/g, '')
    .slice(0, 64);
  return id || 'project';
}

/** The manifest written into a new project: a valid, empty environment. */
export function newProjectManifest(name: string, now = new Date()): string {
  const env = createEmptyEnvironment(projectId(name), { en: name, fr: name }, now);
  return JSON.stringify(env, null, 2) + '\n';
}
