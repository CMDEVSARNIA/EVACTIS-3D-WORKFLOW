# 0003 — WebView2 and the C runtime on air-gapped machines

**Context.** Tauri renders with Microsoft Edge WebView2. Windows 11 ships the Evergreen
runtime; Windows 10 22H2 usually has it via Edge, but an air-gapped or locked-down
Windows 10 image may not, and cannot download it. The MSVC C runtime has the same
problem.

**Options.**
| Mode | Installer size | Behaviour |
| --- | --- | --- |
| `downloadBootstrapper` (Tauri default) | +~2 MB | Downloads at install — **fails offline**. Rejected. |
| `embedBootstrapper` | +~2 MB | Still downloads. Rejected. |
| `offlineInstaller` | +~130 MB | Installs Evergreen runtime only if missing; no network. **Chosen.** |
| `fixedRuntime` | +~180 MB | App-private runtime, never updated by Windows Update. Kept for the Phase 10 portable Viewer. |

**Decision.** Both installers use `offlineInstaller` (silent). The C runtime is linked
statically (`.cargo/config.toml`: `+crt-static`), so no VC++ redistributable is needed.

**Consequences.** Setup files are roughly 130 MB larger; installs succeed with
networking disabled. The installed Evergreen runtime is serviced by the client's own
Windows Update/WSUS policy, not by us. The portable Viewer (Phase 10) will carry a
fixed-version runtime instead, because it cannot install anything.

**Amendment (2026-10-15): how the offline installer is embedded.** tauri-bundler 2.10.2
resolves the `offlineInstaller` file name with an HTTP `HEAD` request to Microsoft on
*every* build, even when the file is cached (`webview2_guid_path` in
`bundle/windows/util.rs`). That made builds with networking disabled impossible. Both
apps now set `webviewInstallMode: skip`, so the bundler makes no request, and our
generated NSIS/WiX templates (`tools/windows/make-installer-templates.mjs`) always embed
the file named by `EVX_WEBVIEW2_INSTALLER` at build time. `scripts/windows/get-webview2.ps1`
downloads it once on a connected machine (also run by `prepare-offline-build.ps1`) into
`target\webview2\` and refuses any file not signed by Microsoft Corporation; with
`-Offline` it only verifies the staged copy. Installed behaviour is unchanged: silent,
and only when no WebView2 runtime is present.
