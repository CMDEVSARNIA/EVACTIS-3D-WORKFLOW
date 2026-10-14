# 0001 — Monorepo and toolchain

**Context.** Studio, Viewer, the shared schema and brand system, and later the Site
Server evolve together; the brief fixes pnpm workspaces + Turborepo, TypeScript strict,
Tauri v2, Vitest and Playwright.

**Decision.**
- pnpm 10 workspaces (`packages/*`, `apps/*`) + Turborepo 2; Cargo workspace for Rust.
- Exact version pins (`save-exact`). Versions chosen are current stable lines with
  known APIs: TypeScript 5.9, Vite 7, Vitest 3, Zod 4.1, React 19.2, Tailwind 4.1,
  Tauri 2.12 (CLI 2.12.2 / bundler 2.10.2), Playwright 1.56.
  TypeScript 7 (native) is deliberately not adopted yet: typescript-eslint does not
  support it.
- Source imports use `.ts` extensions (`rewriteRelativeImportExtensions`), so the brand
  generator runs under Node's built-in type stripping with no extra tooling.
- Turborepo telemetry is disabled (`TURBO_TELEMETRY_DISABLED=1` in CI and docs).
  Remote caching is not configured and must never be.

**Consequences.** One `pnpm check` gates everything. Upgrades are deliberate PRs that
update `docs/licenses/*` via the licence guardrail.
