import '@evactis-3dworkflow/brand/tokens.css';
import '@evactis-3dworkflow/brand/fonts.css';
import '@evactis-3dworkflow/brand/button.css';
import '@evactis-3dworkflow/brand/chrome.css';
import '@evactis-3dworkflow/viewer/player.css';
import './style.css';
import { buttonHtml } from '@evactis-3dworkflow/brand';
import lockupUrl from '@evactis-3dworkflow/brand/product-lockup-plate.svg?url';
import { openPackage, playerStrings, showProblem } from '@evactis-3dworkflow/viewer/open-package';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { STRINGS, detectLang, type Lang } from './i18n.ts';
import {
  appInfo,
  fullScreen,
  fullScreenKey,
  reportSmoke,
  watchNetwork,
  windowFullScreen,
  type AppInfo,
} from '@evactis-3dworkflow/desktop-bridge';

/**
 * The 3DWORKFLOW Viewer window. It opens the `.evx` it was launched with (double-click),
 * else the one named in `viewer.json` beside the executable (portable folder, per-facility
 * install), else shows the start screen with "Open an environment…". The Rust side checks
 * every file of the package as it opens; this page then reads the files one at a time
 * (checked again), asks for the passphrase of an encrypted package and decrypts in memory,
 * with the same code as the browser packages (packages/viewer/player/open.ts).
 */
const blocked = watchNetwork();
fullScreenKey();
/** The window's full screen (a page's in a browser); null where there is none. */
const full = fullScreen();
/** Stops the start screen following full-screen changes once an environment is open. */
let stopWatching: (() => void) | null = null;

/** What the Rust side reports about the package it opened and checked. */
interface Opened {
  path: string;
  kind: string;
  title: Record<string, string>;
  encrypted: boolean;
  kiosk: boolean;
  files: number;
}

let lang: Lang = detectLang();
const root = document.getElementById('app')!;

function render(version: string) {
  const t = STRINGS[lang];
  document.documentElement.lang = lang;
  root.innerHTML = `
    <header class="viewer-top">
      <img class="viewer-lockup" src="${lockupUrl}" alt="EVACTIS 3DWORKFLOW" />
      <div class="viewer-controls">
        <button type="button" class="evx-cta evx-cta--ghost" id="lang">${t.language}</button>
        ${full ? `<span id="full">${buttonHtml({ icon: full.on ? 'fullscreen-exit' : 'fullscreen', lang })}</span>` : ''}
      </div>
    </header>
    <main class="viewer-stage">
      <p class="evx-eyebrow">${t.eyebrow}</p>
      <h1 class="evx-heading">${t.title}</h1>
      <p class="viewer-empty">${t.empty}</p>
      <p><button type="button" class="evx-cta" id="open">${t.open}</button></p>
      <p class="viewer-offline" role="note">${t.offline}</p>
      <p class="viewer-version">${t.version} ${version}</p>
    </main>`;
  root.querySelector('#full button')?.addEventListener('click', () => {
    void full?.toggle().catch(() => undefined);
  });
  stopWatching?.();
  stopWatching = full?.watch(() => render(version)) ?? null;
  root.querySelector('#lang')!.addEventListener('click', () => {
    lang = lang === 'en' ? 'fr' : 'en';
    render(version);
  });
  root.querySelector('#open')!.addEventListener('click', () => {
    if (!isTauri()) return;
    void invoke<string | null>('pick_package', { title: t.pickTitle, filter: t.pickFilter })
      .then((path) => (path ? show(path, info) : null))
      .catch(() => undefined); // shown on the page
  });
}

/** The stage the environment fills (the start screen goes). */
function stage(): HTMLElement {
  stopWatching?.();
  stopWatching = null;
  window.viewer?.destroy();
  delete window.viewer;
  root.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'player-stage';
  root.append(el);
  return el;
}

/**
 * Opens a package (`path`, or the launch / beside-the-executable one when null). Returns
 * what a smoke run verified, null when there is nothing to open; throws when it cannot.
 */
async function show(path: string | null, info: AppInfo | null): Promise<string[] | null> {
  let opened: Opened | null;
  try {
    opened = await invoke<Opened | null>('viewer_package', { path });
  } catch (e) {
    // Checked in Rust before anything is shown: an altered file stops it here.
    const message = String(e);
    const t = playerStrings(lang);
    const altered = /"(.+)" failed its integrity check/.exec(message);
    showProblem(stage(), altered ? t.altered(altered[1]!) : t.cannotOpen(message));
    document.body.dataset.ready = altered ? 'integrity-error' : 'error';
    throw new Error(message);
  }
  if (!opened) return null;
  const title = opened.title[lang] ?? Object.values(opened.title)[0] ?? '';
  document.title = `${title} – EVACTIS 3DWORKFLOW Viewer`;
  const viewer = await openPackage({
    stage: stage(),
    read: (p) => invoke<ArrayBuffer>('package_read', { path: p }).then((b) => new Uint8Array(b)),
    language: lang,
    kiosk: opened.kiosk,
    // Smoke runs only: tried instead of asking; a refused one fails the run.
    passphrase: info?.smokePassphrase ?? undefined,
    // The quick-start PDF ships beside the package in installs and portable folders.
    noQuickStart: true,
    // The toolbar's full-screen button fills the monitor, not just this window.
    fullScreen: windowFullScreen() ?? undefined,
  });
  return [
    `opened ${opened.kind} package "${title}"`,
    `${opened.files} files verified (SHA-256) on open`,
    ...(opened.encrypted ? ['decrypted in memory with the passphrase'] : []),
    `${viewer.environment.scenes.length} scenes, showing "${viewer.sceneId}"`,
  ];
}

const info = await appInfo();
render(info?.version ?? 'dev');
let checks: string[] | null = null;
let error: string | undefined;
if (isTauri()) {
  try {
    checks = await show(null, info);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
}
await reportSmoke(info, blocked, { checks: checks ?? [], error });
