# Windows installers — build, behaviour and offline acceptance

## Build

```powershell
pnpm install
pnpm turbo run build
$env:EVX_SIGN_THUMBPRINT = scripts/windows/new-test-cert.ps1   # or the Evactis cert's thumbprint
scripts/windows/build-installers.ps1                             # → out\installers\
```

Unsigned local builds: skip `EVX_SIGN_THUMBPRINT`. CI: `.github/workflows/windows.yml`.

### Fully offline build and signing

1. On a connected machine, once per dependency change: `scripts\windows\prepare-offline-build.ps1`
   (fills the pnpm store, Cargo registry, `target\webview2` (WebView2 offline installer,
   Microsoft signature checked) and `target\.tauri` tools: NSIS, WiX).
2. Move the repository folder, `%LOCALAPPDATA%\pnpm\store` and `%USERPROFILE%\.cargo` to
   the offline station (or disconnect this machine).
3. `scripts\windows\build-installers.ps1 -Offline` — Cargo/pnpm run offline and every
   toolchain HTTP request goes to a dead proxy, so a missing cache fails instead of
   downloading. Signing with the USB token works offline; timestamps are added later
   if wanted (`docs/code-signing.md`).

CI runs step 3 after every build to keep this path working.

Installer behaviour (both apps): branded EN/FR wizard (language selector, licence,
install mode, location, Start-menu folder, desktop shortcut option, finish); default
`C:\Program Files\EVACTIS\3DWORKFLOW\<App>`; per-user option; Start-menu folder
"EVACTIS 3DWORKFLOW"; Apps & features entry with publisher Evactis; `.evxproj` → Studio,
`.evx` → Viewer with branded icons; in-place upgrades; downgrades refused; uninstall
asks before deleting app data and never touches `Documents\EVACTIS 3DWORKFLOW`.
Details and the template changes: `docs/decisions/0006-installer-templates.md`.

## What CI proves (every push)

`windows.yml` builds and signs both installers, then on Windows Server 2022 and 2025:
NSIS per-machine, MSI per-machine (both apps) and NSIS per-user (Viewer) are each
installed silently, checked (path, signature, file properties, Start menu, Apps &
features, publisher, association, file icon), launched with `--smoke-test` (the app
must render its UI in WebView2, talk to the Rust core and report **zero** network
attempts), then uninstalled and checked for leftovers.

**Limits of a hosted runner:** the network adapter cannot be disabled without killing
the job, so "networking disabled" there means outbound traffic is firewalled for the
installer, msiexec, the app and all WebView2 processes, plus a dead WinHTTP proxy. The
runner images also already have WebView2, so the embedded offline WebView2 installer is
not exercised. Both gaps are closed by the acceptance run below.

## Air-gap acceptance (Windows Sandbox, networking off)

Windows Sandbox starts from a clean image with no WebView2 runtime on Windows 10 and
an older one on some Windows 11 builds — the closest thing to a fresh client machine.

1. Enable *Windows Sandbox* (Windows 10/11 Pro or Enterprise).
2. Put the installers and `scripts\windows\` in `C:\evx-test\` on the host.
3. Double-click `docs\testing\windows-sandbox-offline.wsb` (networking disabled,
   `C:\evx-test` mapped read-only).
4. In the sandbox, open PowerShell as administrator and run:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   C:\evx-test\scripts\windows\smoke-test.ps1 -App Viewer -Installer (Get-ChildItem C:\evx-test\EVACTIS-3DWORKFLOW-Viewer-*-setup.exe).FullName -LogDir $env:TEMP\smoke
   C:\evx-test\scripts\windows\smoke-test.ps1 -App Studio -Installer (Get-ChildItem C:\evx-test\EVACTIS-3DWORKFLOW-Studio-*-en-US.msi).FullName -LogDir $env:TEMP\smoke
   ```
   For a test-signed build, first import `signer.cer` into *Trusted Root* and *Trusted
   Publishers* inside the sandbox.
5. **Delivery packages (Phase 10).** Also copy the `delivery-packages` CI artifact
   (`Evactis Demo Centre Setup.exe`, `portable\`, `demo*.evx`) to
   `C:\evx-test\packages\`, then in the sandbox:
   ```powershell
   C:\evx-test\scripts\windows\package-acceptance.ps1 -Packages C:\evx-test\packages -ViewerInstaller (Get-ChildItem C:\evx-test\EVACTIS-3DWORKFLOW-Viewer-*-setup.exe).FullName -LogDir $env:TEMP\packages
   ```
   On Windows 10 the sandbox has no WebView2 Runtime, which is the point: the
   per-facility setup must install it from its embedded offline installer (the first
   check that matters). Before running the script, note whether
   `HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`
   exists. The script runs the portable viewer *after* that install, so it proves the
   portable folder runs, not that it runs without WebView2. To check that case, open a
   fresh sandbox and double-click `portable\EVACTIS-3DWORKFLOW-Viewer.exe` first.
   Without a bundled fixed runtime it is expected to fail (assumption 66, ADR 0018).
6. Repeat on Windows 10 22H2 and Windows 11 hosts. Record results in the phase notes.
