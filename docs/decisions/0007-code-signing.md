# 0007 — Code signing

**Status.** Superseded by [0008](0008-offline-code-signing.md): no cloud or CI-held key.

**Decision.** Every `.exe`, `.msi` and the NSIS uninstaller are Authenticode-signed
(SHA-256, RFC 3161 timestamp) through `bundle.windows.signCommand` →
`scripts/windows/sign.ps1`. CI uses the Evactis certificate when the
`WINDOWS_CERTIFICATE_PFX` / `WINDOWS_CERTIFICATE_PASSWORD` secrets exist; otherwise a
throw-away self-signed TEST certificate (`CN=Evactis (TEST - not for distribution)`),
trusted only on the smoke-test runner. See `docs/code-signing.md`.

**Consequences.** Test-signed builds show "Unknown publisher" on any real machine and
must never be distributed. Release signing (Phase 12) only needs the secrets set.
