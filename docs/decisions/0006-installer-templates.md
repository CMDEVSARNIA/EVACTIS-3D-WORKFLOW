# 0006 — Patched installer templates

**Context.** Tauri's default templates install to `Program Files\<productName>`, name
shortcuts after `productName`, and use the exe icon for associated files. The brief
requires `Program Files\EVACTIS\3DWORKFLOW\<App>`, a Start-menu folder "EVACTIS
3DWORKFLOW" with "3DWORKFLOW <App>" shortcuts, and branded file-type icons.

**Decision.** Vendor the exact templates of the bundler pinned by the CLI
(`packaging/windows/upstream/`, tauri-bundler 2.10.2) and derive per-app templates with
`tools/windows/make-installer-templates.mjs`. Each patch must match an exact number of
times, so a CLI upgrade that changes the template fails loudly instead of silently.
NSIS keeps Tauri's "both" install mode (per-machine default, per-user option); WiX
stays per-machine, non-advertised ProgIDs carry `filetypes\<ext>.ico`.

**Consequences.** Upgrading `@tauri-apps/cli` requires re-vendoring the templates (see
`packaging/windows/upstream/README.md`); `pnpm check` verifies the generated copies.
