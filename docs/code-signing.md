# Code signing — offline, no cloud

All installers and binaries are Authenticode-signed (SHA-256). By Evactis decision
(ADR 0008) **no cloud signing service is used** and the whole build-and-sign process
must be able to run on a machine with networking disabled.

## The certificate: an OV code-signing certificate on a USB hardware token

Since June 2023 public CAs must keep code-signing private keys on certified hardware,
so a certificate can no longer be bought as a downloadable `.pfx` file. Without a cloud
HSM, that means a **USB token** (e.g. a SafeNet/Thales eToken) shipped by the CA. The
key never leaves the token and the token needs no network.

1. Buy an **OV** code-signing certificate from a public CA, choosing *hardware token*
   delivery, for the legal entity **Evactis** (shown as "Publisher" in Windows).
   EV is also possible; under current Microsoft SmartScreen behaviour EV and OV build
   download reputation the same way, so OV is the cost-effective choice.
2. Install the token's driver/minidriver on the **signing station** — a Windows 10/11
   x64 machine, which may be permanently offline. The certificate then appears in
   `CurrentUser\My`; note its SHA-1 thumbprint.
3. Prepare the station once (online, or by copying caches — see
   `docs/windows-installers.md`): `scripts\windows\prepare-offline-build.ps1`.

## Signing a release (fully offline)

```powershell
$env:EVX_SIGN_THUMBPRINT = '<token certificate thumbprint>'
scripts\windows\build-installers.ps1 -Offline        # signs every exe, msi and the uninstaller
signtool verify /pa /v out\installers\*.msi
```

signtool asks the token for its PIN (enable the token client's single-logon option to
enter it once per build).

## Timestamps — the one thing that needs a connection

A timestamp proves a file was signed while the certificate was valid; without one the
signature **stops validating when the certificate expires** (CA/Browser Forum rules are shortening maximum validity, so plan for roughly yearly renewal). Timestamps come from a public timestamp authority, so a fully
offline build cannot obtain them. Choose per release:

| Option | Network | Result |
| --- | --- | --- |
| **A. Deferred timestamp (recommended)** | One brief hop on *any* connected PC; no key or token involved — only signature hashes are sent | Copy `out\installers` there, run `scripts\windows\timestamp-later.ps1 -Path <folder>`, copy back. Installers and MSIs stay valid indefinitely. The program files *inside* them are not timestamped (see below). |
| **B. Staged timestamp** | Same hop, twice | Build with `pnpm tauri build --no-bundle`, sign the app .exe, timestamp it (A), then run `pnpm tauri bundle` with signing on; `sign.ps1` skips the already-signed exe. Everything, inner files included, is timestamped. |
| **C. Never connect** | None | Everything works, but after the certificate expires Windows reports the signatures as expired. Re-sign and re-issue before expiry. |

Inner program files without a timestamp still run after expiry (Windows does not
re-check installed files), but tools such as AppLocker/WDAC publisher rules may refuse
them. Use option B for clients with such policies.

## CI

GitHub Actions never holds the Evactis key. It signs with a throw-away self-signed TEST
certificate (`CN=Evactis (TEST - not for distribution)`) to prove the pipeline, and runs
an offline rebuild to prove signing works without network. Test-signed builds show
"Unknown publisher" anywhere else and must never be given to clients.
