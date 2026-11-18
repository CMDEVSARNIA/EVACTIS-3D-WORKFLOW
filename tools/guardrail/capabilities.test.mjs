import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * What the desktop pages may ask of the Rust shell (docs/security-review.md): Tauri's core
 * defaults and the window's own full-screen switch (F11), nothing else. A new permission
 * must be added here on purpose, with the review updated.
 */
const ALLOWED = [
  'core:default',
  'core:window:allow-is-fullscreen',
  'core:window:allow-set-fullscreen',
];

for (const app of ['studio', 'viewer-desktop']) {
  test(`${app}: the main window has only the reviewed permissions`, () => {
    const cap = JSON.parse(
      readFileSync(
        new URL(`../../apps/${app}/src-tauri/capabilities/default.json`, import.meta.url),
        'utf8',
      ),
    );
    assert.deepEqual(cap.windows, ['main']);
    assert.deepEqual([...cap.permissions].sort(), [...ALLOWED].sort());
  });
}
