# 0008 — Offline code signing on a hardware token (supersedes 0007)

**Context.** Evactis rejected cloud signing services: the signing key, like client
data, must not depend on a third party's cloud, and the whole build-and-sign process
must be able to run fully offline. CA/B Forum rules (June 2023) require code-signing
keys on certified hardware, so a downloadable PFX is not available either.

**Decision.**
- Release signing uses an OV certificate on a **USB hardware token** at an Evactis
  signing station that may be permanently offline. `scripts/windows/sign.ps1` signs
  by certificate thumbprint (how token certificates appear) and never needs network.
- Builds can run offline: `useLocalToolsDir` keeps NSIS/WiX/WebView2 in
  `target/.tauri`; `prepare-offline-build.ps1` fills the pnpm, Cargo and Tauri caches;
  `build-installers.ps1 -Offline` blocks the toolchain's network and fails on any cache
  miss. CI runs this offline rebuild on every push.
- Timestamping is decoupled: offline signing omits it, and
  `timestamp-later.ps1` adds it from any connected PC by sending only hashes (options
  in `docs/code-signing.md`).
- CI signs with a TEST certificate only; GitHub secrets never hold the Evactis key.

**Consequences.** Releases are produced at the signing station, not by CI. Without a
timestamp hop, signatures expire with the certificate; the documented options make
that an explicit per-release choice.
