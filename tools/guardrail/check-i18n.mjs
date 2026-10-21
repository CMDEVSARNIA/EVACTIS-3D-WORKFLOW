#!/usr/bin/env node
/**
 * English/French completeness: every string table the products show has both languages,
 * with the same keys all the way down, and no French entry left as a copy of the English
 * one (unless the word is the same in both languages: listed below).
 *
 * A table is any exported object with `en` and `fr` members (the convention across the
 * repo); the modules are imported directly (Node strips their types).
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MODULES = [
  'apps/studio/src/i18n.ts',
  'apps/studio/src/editor/strings.ts',
  'apps/studio/src/editor/safetyStrings.ts',
  'apps/studio/src/editor/contentStrings.ts',
  'apps/studio/src/editor/skinStrings.ts',
  'apps/studio/src/editor/trainingStrings.ts',
  'apps/studio/src/editor/packageStrings.ts',
  'apps/viewer-desktop/src/i18n.ts',
  'packages/viewer/src/i18n.ts',
  'packages/viewer/player/ui.ts',
  'packages/packaging/src/readme.ts',
  'apps/site-server/web/src/strings.ts',
];

// The same in English and French (names, and words both languages share).
const SAME = new Set([
  'EVACTIS 3DWORKFLOW',
  'EVACTIS 3DWORKFLOW Studio',
  'EVACTIS 3DWORKFLOW Viewer',
  'EVACTIS 3DWORKFLOW Site Server',
  '3DWORKFLOW Studio',
  '3DWORKFLOW Viewer',
  'Evactis',
  'Administration',
  'Notes',
  'Note',
  'Photos',
  'Photo',
  'Question',
  'Questions',
  'Zoom',
  'Rotation',
  'Animation',
  'Navigation',
  'Message',
  'Description',
  'Type',
  'Position',
  'Audio',
  'Date',
  'Total',
  'Points',
  'Pause',
  'Distance',
  'Orientation',
  'Contact',
  'Instructions',
  'Accessible',
  'Options',
  'Version',
  'Versions',
  'Code',
  'Source',
  'Format',
  'Normal',
  'Kiosk',
  'SCORM',
  'SCORM 1.2',
  'SCORM 2004',
  'PDF',
  'CSV',
  'XLSX',
  'URL',
  'ID',
  'VR',
  'GPS',
  'HDR',
  'OK',
  'Plan',
  'Plans',
  'Sections',
  'Section',
  'Minimum',
  'Maximum',
  'Info',
  'Image',
  'Images',
  'Vidéo',
  'Article',
  'Signal',
  'Excellent',
  'Simple',
  'Standard',
  'Hotspot',
  'Hotspots',
  'Radar',
  'Logo',
  'Menu',
  'Portable',
  'Intranet',
  'Installation',
  'Lieu',
  'Mode',
  'Silence',
  'Initial',
  'Couleur',
  'Panorama',
  'Destination',
  'Direction',
  'Document',
  'Documents',
  'Album',
  'Transition',
  'Horizontal',
  'Vertical',
  'Confirmation',
  'Volume',
  'Information',
  'Module',
]);
// Strings with no letters (symbols, numbers, punctuation) need no translation; a unit
// in brackets ("Distance (m)") does not count as a word.
const wordless = (s) => !/\p{L}{2,}/u.test(s);
const same = (s) => SAME.has(s.replace(/\s*\([^)]*\)$/, ''));
// A value already given in both languages ({ en, fr }), e.g. a default title.
const bilingual = (v) =>
  v && typeof v === 'object' && Object.keys(v).every((k) => k === 'en' || k === 'fr');

const problems = [];
let tables = 0;
let checked = 0;

function compare(en, fr, path) {
  if (typeof en === 'function' || typeof fr === 'function') {
    if (typeof en !== typeof fr) problems.push(`${path}: a function in one language only`);
    return;
  }
  if (typeof en === 'string' || typeof fr === 'string') {
    if (typeof en !== typeof fr) return problems.push(`${path}: text in one language only`);
    checked++;
    if (en === fr && !same(en) && !wordless(en))
      problems.push(`${path}: French is the English text ("${en.slice(0, 60)}")`);
    if (!fr.trim() && en.trim()) problems.push(`${path}: French is empty`);
    return;
  }
  if (en && fr && typeof en === 'object' && typeof fr === 'object') {
    if (bilingual(en) && bilingual(fr)) return;
    const keys = new Set([...Object.keys(en), ...Object.keys(fr)]);
    for (const k of keys) {
      if (!(k in en)) problems.push(`${path}.${k}: French only`);
      else if (!(k in fr)) problems.push(`${path}.${k}: missing in French`);
      else compare(en[k], fr[k], `${path}.${k}`);
    }
  }
}

/** Finds `{ en, fr }` tables anywhere inside an exported value. */
const seen = new Set();
function visit(value, path) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if ('en' in value && 'fr' in value && typeof value.en === 'object' && value.en) {
    tables++;
    compare(value.en, value.fr, path);
    return;
  }
  for (const [k, v] of Object.entries(value)) visit(v, `${path}.${k}`);
}

for (const file of MODULES) {
  const mod = await import(pathToFileURL(join(repo, file)).href);
  for (const [name, value] of Object.entries(mod)) visit(value, `${file}:${name}`);
}

if (problems.length) {
  console.error(`EN/FR guardrail: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`EN/FR guardrail: ${tables} tables, ${checked} strings, all in both languages.`);
