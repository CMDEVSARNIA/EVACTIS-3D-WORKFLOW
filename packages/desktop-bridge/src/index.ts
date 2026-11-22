/**
 * Bridge between the desktop UIs (Studio, Viewer) and the shared Rust shell
 * (crates/evx-desktop). Safe to import in a plain browser: every call is a no-op
 * outside Tauri.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Collects any network request the page attempts outside its own origin (resource
 * timing + CSP violations) and, when the app was started with --smoke-test, reports
 * to the Rust core, which writes the report and exits.
 */
export function watchNetwork(): string[] {
  const seen: string[] = [];
  const local = (u: string) =>
    u.startsWith(location.origin) ||
    /^(data|blob|ipc|asset|tauri):/.test(u) ||
    /^https?:\/\/(ipc|asset|tauri)\.localhost\//.test(u);
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!local(e.name)) seen.push(e.name);
  }).observe({ type: 'resource', buffered: true });
  document.addEventListener('securitypolicyviolation', (e) =>
    seen.push(e.blockedURI || e.violatedDirective),
  );
  return seen;
}

export interface AppInfo {
  name: string;
  version: string;
  publisher: string;
  identifier: string;
  openPath: string | null;
  smokeTest: boolean;
  /** Studio smoke runs: a media file to import into a scratch project. */
  smokeImport: string | null;
  /** Smoke runs only (Viewer): the passphrase to try on an encrypted package. */
  smokePassphrase: string | null;
}

export async function appInfo(): Promise<AppInfo | null> {
  return isTauri() ? invoke<AppInfo>('app_info') : null;
}

export interface SmokeExtra {
  /** What was verified beyond start-up, e.g. a media import. */
  checks?: string[];
  error?: string;
}

export async function reportSmoke(
  info: AppInfo | null,
  blocked: string[],
  extra: SmokeExtra = {},
): Promise<void> {
  if (!info?.smokeTest) return;
  // Give fonts and images a moment so late requests are caught too.
  await new Promise((r) => setTimeout(r, 1500));
  await invoke('smoke_report', {
    userAgent: navigator.userAgent,
    location: location.href,
    blockedRequests: blocked,
    checks: extra.checks ?? [],
    error: extra.error ?? null,
  });
}

/** Full screen as a button sees it: on or off, a toggle, and news of changes. */
export interface FullScreen {
  readonly on: boolean;
  toggle(): Promise<void>;
  /** Calls `changed` whenever full screen starts or ends (button, F11, Esc); returns a stop function. */
  watch(changed: () => void): () => void;
}

let windowFull: FullScreen | null = null;

/**
 * The app window's full screen (the whole monitor, no title bar or taskbar). One shared
 * instance, so F11 and every button agree. Needs the window's is-/set-fullscreen
 * permissions (capabilities/default.json). Null outside the desktop app.
 */
export function windowFullScreen(): FullScreen | null {
  if (!isTauri()) return null;
  if (windowFull) return windowFull;
  const w = getCurrentWindow();
  const listeners = new Set<() => void>();
  let on = false;
  const set = (next: boolean) => {
    if (next === on) return;
    on = next;
    for (const l of listeners) l();
  };
  // A full-screen change resizes the page, whatever caused it.
  const check = () => void w.isFullscreen().then(set, () => undefined);
  check();
  addEventListener('resize', check);
  windowFull = {
    get on() {
      return on;
    },
    async toggle() {
      await w.setFullscreen(!on);
      set(await w.isFullscreen());
    },
    watch(changed) {
      listeners.add(changed);
      return () => listeners.delete(changed);
    },
  };
  return windowFull;
}

/**
 * Full screen for an app's own button: the window's in the desktop app; in a browser
 * (tests, development) the page's. Null where neither is possible.
 */
export function fullScreen(): FullScreen | null {
  const win = windowFullScreen();
  if (win) return win;
  if (typeof document === 'undefined' || !document.fullscreenEnabled) return null;
  return {
    get on() {
      return !!document.fullscreenElement;
    },
    async toggle() {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    },
    watch(changed) {
      document.addEventListener('fullscreenchange', changed);
      return () => document.removeEventListener('fullscreenchange', changed);
    },
  };
}

/**
 * F11 switches the window between full screen and its usual (maximized) state, as in
 * browsers.
 */
export function fullScreenKey(): void {
  const full = windowFullScreen();
  if (!full) return;
  addEventListener('keydown', (e) => {
    if (e.key !== 'F11' || e.repeat) return;
    e.preventDefault();
    void full.toggle();
  });
}

/** Interface sizes offered (1 = 100 %). */
export const ZOOM_STEPS = [0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;

/**
 * Sets the size of the whole interface, like a browser's zoom: the window's webview is
 * scaled, so layout, text and the preview stay consistent. Outside the desktop app (tests,
 * development) the page's CSS zoom stands in.
 */
export async function setInterfaceZoom(scale: number): Promise<void> {
  if (isTauri()) await getCurrentWebview().setZoom(scale);
  else document.documentElement.style.zoom = scale === 1 ? '' : String(scale);
}

/** The next interface size up (+1) or down (-1) from `scale`. */
export function stepZoom(scale: number, dir: 1 | -1): number {
  const i = ZOOM_STEPS.findIndex((z) => z >= scale - 1e-6);
  const at = i === -1 ? ZOOM_STEPS.length - 1 : i;
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, at + dir))]!;
}
