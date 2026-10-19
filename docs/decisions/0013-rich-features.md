# 0013 — Rich features: one panorama shader, local media only, pdf.js without a worker

**Context.** Phase 6: live layers (including a "smoke conditions" variant), animated
regions, adaptive HDR, 360° video with timed hotspots, spatial audio (the alarm at its
panel), a floor-plan radar, photo albums and a local PDF viewer, each demonstrated in
the demo facility with e2e coverage. Everything must work offline, inside a strict CSP,
with nothing fetched from outside the package.

**Decision.**
- **One shader for every panorama surface** (image, tiles, video, regions):
  `exposure` (stops) and `haze` (0–1, towards a smoke colour) uniforms shared by all
  materials. A panorama has no depth, so a live layer's `visibilityM` becomes one haze
  amount (what remains of a wall ~5 m away), denser towards the ceiling where hot smoke
  gathers first. It renders existing scenes pixel-identically when neutral (Phase 2
  baselines unchanged).
- **Live layers** are switchable states over the whole environment; a scene's look is
  the sum of its overrides in the current states (exposure added, densest haze wins),
  optionally a replacement panorama. Switching is announced to screen readers.
- **Adaptive HDR**: tiles stay 8-bit (tone-mapped once at import, Reinhard on the
  log-average); the importer also writes a 128×64 log-luminance map. The Viewer meters
  the field of view on that map and shifts exposure (−2 to +1.5 stops), easing like an
  eye, snapping with reduced motion. Real HDR textures would multiply tile sizes; the
  map gives the effect for ~10 KB.
- **360° video** plays on the same sphere through a `VideoTexture`; the Viewer adds a
  play/position/sound bar. Video starts paused and muted; pressing play is the gesture
  that allows sound. Timed hotspots (`timeRange`) follow playback. Seeking needs byte
  ranges, which the desktop asset protocol and web servers provide (the test server
  now does too).
- **Animated regions**: a polygon in yaw/pitch, triangulated and subdivided onto the
  sphere, with a looping video (or image) stretched over its bounds. Optional
  `condition` (additive to schema v1) so a strobe shows only while the alarm sounds.
  Reduced motion shows the first frame.
- **Sounds** through Web Audio: spatial sources pan by the angle to the view and are
  louder when faced (StereoPanner + gain: testable and identical in every webview,
  unlike HRTF). Captions name what plays and where it comes from ("to your left"), so
  the information never depends on hearing. Nothing autoplays while authoring.
- **Radar**: a corner mini-plan centred on the reader, with the view cone (same bearing
  maths as the floor plan's "You are here") and clickable dots for other scenes.
- **Albums**: an `openAlbum` action and a gallery dialog (buttons and arrow keys).
- **PDF reader: pdf.js 4.10 (Apache-2.0)**, loaded on first use as separate chunks so
  the core stays at ~190 KB gz. No worker URL (the parser runs as a chunk on the page,
  which works from file:// and under `script-src 'self'`), `isEvalSupported: false`,
  no CMap/font/wasm downloads, no streaming or range fetches, no annotation layer (PDF
  links are never followed). The page's text is kept for screen readers. Desktop CSP
  `connect-src` allows the local asset protocol so the reader can read package files.
  Alternatives: the webview's built-in viewer (absent in WebKitGTK and headless
  Chromium) or rasterising PDFs in Studio (loses text and zoom).
- **Studio**: sounds, PDFs and photos import through the Rust pipeline (checked by
  content, not just extension); a Content tab edits sounds, documents, albums, live
  layers and regions; the action editor gains the media actions Phase 4 deferred.
- **Demo media is procedural**: the HDR office, alarm WAV, album photos and procedures
  PDF are generated at build; the two WebM videos are encoded by a script (FFmpeg) and
  committed, so builds and Windows CI need no FFmpeg.

**Consequences.**
- Region clips are package files referenced by path until a clip import exists.
- Adaptive HDR needs the luminance map; imported `.hdr` panoramas get one, older imports
  re-import to gain it.
- pdf.js chunks (~540 KB gz) ship with the Viewer but load only when a document opens.
