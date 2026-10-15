/**
 * Bridge between the desktop UIs (Studio, Viewer) and the shared Rust shell
 * (crates/evx-desktop). Safe to import in a plain browser: every call is a no-op
 * outside Tauri.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';

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
