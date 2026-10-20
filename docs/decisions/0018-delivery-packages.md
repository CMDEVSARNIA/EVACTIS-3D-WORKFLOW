# 0018 — Delivery packages: one format, verified at launch, decrypted in memory

**Context.** Phase 10: Studio's Package dialog produces a Windows installer with the
environment, a `.evx` file, a portable viewer, an intranet bundle, a browser folder
opened from disk, a single HTML file and SCORM. Every package can be encrypted with a
passphrase (AES-256-GCM, Argon2id), carries a SHA-256 integrity manifest verified at
launch, a version/date stamp, a bilingual quick-start PDF and an offline notice. Done
when each installs or launches offline on Windows 10 and 11, a wrong passphrase is
refused and a tampered file fails the integrity check. Zero cloud exposure throughout.

**Decision.**
- **One package format for every kind** (`packages/package-format`, mirrored in Rust by
  `crates/evx-package`). `evx-manifest.json` lists every file with its size and SHA-256,
  plus kind, creation date, producer, environment id/title, `offline: true` and the
  encryption parameters. The players differ only in how they read stored bytes: HTTP
  (intranet, SCORM), `<script>` chunks (browser folder), inline blocks (single file), a
  stored ZIP (`.evx`, read by Rust in the desktop Viewer).
- **Encryption.** Argon2id (64 MiB, 2 passes, 1 lane, 16-byte salt) derives a 256-bit key
  from the NFC-normalised passphrase (8 characters minimum). Each content file becomes an
  opaque blob `content/NNNNNN.bin` = nonce ‖ AES-256-GCM ciphertext ‖ tag, with the blob
  name as associated data (blobs cannot be swapped); an encrypted index maps paths to
  blobs, so file names are hidden too. A wrong passphrase fails the index's tag. Only
  the player, the quick-start PDF and the README stay plain: a recipient can read how to
  open the package without the passphrase. Decrypted bytes live in memory only, as blob
  URLs that last as long as the page; nothing is written to disk or cached.
- **Integrity.** Every stored file (blobs included) is checked against the manifest
  before use. The desktop Viewer verifies the whole package when it opens it (Rust) and
  every file again as the page reads it; browser kinds verify each file as it loads (a
  full pass would mean reading the whole environment before showing anything). A failed
  check stops the environment with a message naming the file, never a partial view. The
  manifest's own SHA-256 prefix is shown in the info panel ("Package check") so a
  delivered copy can be compared with what Evactis made.
- **WebCrypto first, audited pure JS second.** `crypto.subtle` covers SHA-256 and
  AES-GCM where the page is a secure context; `@noble/hashes` / `@noble/ciphers` cover
  plain-http intranets and Argon2id everywhere (WebCrypto has no Argon2). No WebAssembly
  or workers, so the strict CSP holds. Rust uses RustCrypto `argon2` + `aes-gcm`; a
  shared test vector keeps the two implementations identical.
- **From disk (file://)** browsers forbid `fetch` of neighbouring files and taint
  WebGL with `file:` images. The browser folder therefore stores the environment as
  classic `<script>` files that hand base64 chunks to the page (`__evxChunk`), and the
  single file embeds them as `<script type="application/octet-stream">` blocks; bytes
  become blob URLs, which WebGL accepts. One classic (non-module) player build is used
  for both. The README lists what degrades: slower opening, videos read whole into
  memory, no VR offered, reduced resolution in the single file.
- **Single HTML file**: tile levels above 2048 px per cube face are dropped; Studio
  estimates the size beforehand and asks for "Make it anyway" above 50 MB.
- **Intranet bundle** replaces the page's CSP with `default-src 'self'` and no outside
  source in any directive; nothing in the player ever names another origin.
- **Desktop kinds reuse the 3DWORKFLOW Viewer program.** Portable = Viewer exe +
  `environment.evx` + `viewer.json` (+ optional fixed WebView2 runtime in `webview2\`,
  used when present). The per-facility installer is a generated NSIS script compiled by
  the makensis that Studio bundles: per user (no administrator rights), Start menu
  shortcut "Evactis – <facility>", Apps & features entry, opens straight into its
  environment, uninstaller that removes only the files it installed.
- **Studio writes packages only into a folder picked for export**, file by file, with
  safe relative names; it never overwrites an existing output and removes the outputs of
  a package that failed. Unconfirmed safety items are counted in the dialog because the
  delivered Viewer leaves them out (ADR 0012).

**Alternatives rejected.**
- *A single encrypted archive decrypted by a WebAssembly library*: blocked by the CSP and
  hides nothing more than per-file blobs do.
- *Verifying the whole package before showing anything in browsers*: minutes for large
  tours over a share; per-file checks give the same guarantee for what is shown.
- *Rebuilding the Viewer per facility (Tauri bundle per client)*: needs the Rust
  toolchain at Evactis for every delivery and a fresh signature of the program each
  time. A generated NSIS wrapper around the already-signed Viewer is fast and offline.
- *MSI per facility*: WiX is not redistributable in Studio (MS-RL, build-time only) and
  per-user MSIs are awkward; IT departments get the Viewer MSI plus a `.evx`.

**Consequences.**
- Per-facility setups made in Studio are **unsigned** until signed at the signing
  station (ADR 0008); Studio says so when one is made. The Viewer program inside is
  already signed.
- **WebView2 on clean PCs.** Per-facility installers carry Microsoft's offline WebView2
  installer (bundled with Studio, ~180 MB) and run it only where the runtime is missing,
  exactly as the Viewer's own setup does; the author can leave it out. Portable viewers
  cannot install anything: they use a fixed WebView2 runtime when Studio was built with
  one (`build-installers.ps1 -WebView2FixedRuntime`), else the runtime already on the PC
  (part of Windows 11 and updated Windows 10; missing from Windows Sandbox on 10).
- Packages over 4 GB or 65,535 files need ZIP64 (not yet written; the packager refuses).
- Windows acceptance (CI): packages are made with `tools/package.mjs`, the same library
  as the dialog, with the signed Viewer and Tauri's NSIS; the dialog itself is covered
  by Playwright (`e2e/studio-package.spec.ts`) and Studio's Rust commands by unit tests.
