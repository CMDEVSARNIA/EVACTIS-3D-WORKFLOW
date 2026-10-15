# 0010 — Local media pipeline (Studio)

**Context.** Phase 3: Studio imports panoramas (JPG/PNG/TIFF/HDR, mono and stereo),
360 video, GLB models and Gaussian splats, validates them, reads capture metadata and
produces what the Viewer needs — on the author's machine only, with no upload and no
network access, fast enough for 12K panoramas on an ordinary laptop.

**Decision.**
- **A Rust crate, `crates/evx-media`, with no network code.** Decoding and tiling run
  natively and in parallel (`image` + `rayon`); a 12288 × 6144 panorama imports in
  about 10 s on four cores, with four tile levels (512, 1024, 2048, 4096).
- **Project layout.** One folder per asset, `media/<id>/`, named by the first 16 hex
  digits of the file's SHA-256, holding `source.<ext>` (byte-for-byte original),
  `preview.jpg` (2048 × 1024), `thumb.jpg` (512 × 256), `tiles/` and `asset.json` (the
  record, `recordVersion: 1`). Content-hash IDs make re-imports detectable and paths
  collision-free.
- **Atomic imports.** Work happens in `media/.import-*` and is renamed into place only
  when everything succeeded; errors and cancellation delete the staging folder, and
  opening a project removes leftovers from a crash.
- **One cube layout for every tiler.** `packages/viewer/src/panorama/cube-basis.json` is
  read by the Viewer (TypeScript) and compiled into the Rust tiler (`include_str!`), so
  Studio's tiles and the renderer cannot disagree. A unit test checks rendered tiles
  against an analytic panorama.
- **Tile ladder.** 512 px faces doubling up to the face size that preserves the source
  resolution (width ÷ π, rounded to whole 512 px tiles). Each level samples a
  half-resolution pyramid image of matching density (no aliasing). JPEG quality 88.
- **HDR** is tone-mapped (Reinhard, automatic exposure from log-average luminance) for
  previews and tiles; the original `.hdr` is kept. HDR is limited to 16K wide (32-bit
  float decode).
- **Stereo** (1:1 top-bottom, 4:1 side-by-side) keeps the full source for VR (Phase 9);
  previews and thumbnails come from the left eye; no tiles.
- **360 video through a bundled LGPL FFmpeg, run as a separate process.** H.264 MP4
  sources up to 4096 px wide are remuxed losslessly; anything else is converted with
  the first encoder that works from: NVENC, Quick Sync, AMF, Media Foundation H.264,
  OpenH264, then VP9 WebM. libx264/libx265 (GPL) are never used. Output is capped at
  4096 px wide for decoder compatibility; the original is kept. Every call passes
  `-protocol_whitelist file,pipe`, so a crafted playlist cannot make FFmpeg open a URL.
  The build refuses FFmpeg builds configured with `--enable-gpl` or `--enable-nonfree`
  (`scripts/windows/get-ffmpeg.ps1`), and the Windows smoke test re-checks the
  installed copy. A developer's own FFmpeg on `PATH` is used if no bundled copy exists
  (local use is not redistribution).
- **3D assets** get structural checks only in this phase (GLB header/length/JSON chunk;
  PLY with Gaussian properties and a complete body; `.splat` record size; `.ksplat`
  header; `.spz` gzip + NGSP header). Rendering is Phase 9.
- **Studio integration.** The open project is held in Rust; the UI never passes a
  project path to library commands. The asset protocol is opened for that project's
  `media/` only, and Studio's page CSP adds just the local-file protocol (`asset:`,
  `http://asset.localhost`). Imports stream progress over a Tauri channel (~10 events/s
  per file) and can be cancelled. Native dialogs use `rfd` directly.

**Consequences.** Imports work identically connected or air-gapped. Studio's installer
grows by the size of the FFmpeg binaries. Evactis must keep the FFmpeg
source available for each release (assumption 14). VP9 fallback files are larger and
slower to encode than hardware H.264, but always available.
