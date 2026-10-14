# Upstream installer templates

Unmodified copies of `installer.nsi` and `main.wxs` from **tauri-bundler 2.10.2**
(the bundler pinned by `@tauri-apps/cli` 2.12.2), licensed MIT/Apache-2.0.

`tools/windows/make-installer-templates.mjs` applies the EVACTIS 3DWORKFLOW changes
and writes `apps/*/src-tauri/windows/{installer.nsi,main.wxs}`. When the Tauri CLI
is upgraded, replace these files with the matching bundler version and re-run
`pnpm installers:templates`; the script fails loudly if a patch no longer applies.
