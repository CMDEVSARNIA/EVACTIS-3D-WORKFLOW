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

/**
 * F11 switches the window between full screen and its usual (maximized) state, as in
 * browsers. Needs the window's set-fullscreen permission (capabilities/default.json).
 */
export function fullScreenKey(): void {
  if (!isTauri()) return;
  addEventListener('keydown', (e) => {
    if (e.key !== 'F11' || e.repeat) return;
    e.preventDefault();
    const w = getCurrentWindow();
    void w.isFullscreen().then((on) => w.setFullscreen(!on));
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
