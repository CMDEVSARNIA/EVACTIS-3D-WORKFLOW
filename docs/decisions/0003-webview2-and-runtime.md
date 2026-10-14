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
