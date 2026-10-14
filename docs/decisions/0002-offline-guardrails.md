# 0002 — Offline guardrails

**Context.** "Zero cloud exposure" must be enforced mechanically, not by review alone.

**Decision.** Three independent layers, all in `pnpm check` / CI:

1. **Source** — ESLint `no-restricted-syntax` rejects external URL literals in source
   (XML namespaces, loopback and Tauri IPC origins excepted). `no-eval` family on.
2. **Build output** — `tools/guardrail/scan-urls.mjs` greps every built JS/CSS/HTML/
   JSON/SVG for `http(s)://`/`ws(s)://` URLs not on `tools/guardrail/allowlist.json`
   (each entry carries a reason). Built HTML gets `default-src 'self'` CSP.
3. **Runtime** —
   - Playwright: every test runs with DNS mapped to nothing, a dead proxy except
     loopback, and request interception that aborts and records any non-local request;
     a test fails if anything was attempted. A self-test proves the guard works.
   - Desktop apps: the webview may only navigate to bundled content
     (`evx_core::net::is_app_url`), Tauri CSP restricts connections to IPC, no HTTP/
     updater/shell plugins are installed. In `--smoke-test` mode the UI reports every
     non-local resource or CSP violation; any entry fails the Windows smoke test.
   - Windows smoke test: product processes firewalled + dead WinHTTP proxy.

Plus `tools/guardrail/check-licenses.mjs` keeps every shipped dependency on an allowed
licence and listed in `docs/licenses/`.

**Consequences.** A dependency that phones home fails CI at runtime even if its URL is
built dynamically. Adding a URL to the allowlist is a reviewed change.
