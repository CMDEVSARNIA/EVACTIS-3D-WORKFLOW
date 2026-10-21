# Performance budgets — EVACTIS 3DWORKFLOW

*Phase 12. Budgets are ceilings checked on every push; going over one fails CI and needs
a decision (raise it here, with the reason, or make the change smaller).*

## Download size (gzipped) — `tools/guardrail/size-budget.mjs`

| What | Budget | 2026-10-21 | Notes |
| --- | --- | --- | --- |
| Viewer core (`evactis-viewer.js`, Three.js included) | 300 KB | 219 KB | Everything needed to show a panorama |
| Packaged player (`player.js`) | 260 KB | 222 KB | First load of a delivered intranet/SCORM package |
| Classic player, one file (`player-classic-dist/player.js`) | 1550 KB | 1372 KB | Packages opened from disk (no module loading there); loaded once from the local disk |
| PDF reader (`pdf.js` + engine `pdf.worker.js`) | 110 + 440 KB | 96 + 395 KB | Only when a document is opened |
| Training certificate (`certificate.js`) | 720 KB | 639 KB | Only when a certificate is made; carries the embedded fonts |
| GLB loader / VR / splats | 18 / 7 / 6 KB | 14 / 4 / 4 KB | Only in 3D scenes, VR |
| Studio (`index-*.js`) | 220 KB | 189 KB | Desktop app, loaded from disk |
| Viewer desktop shell (`index-*.js`) | 95 KB | 77 KB | |
| Site Server environment page (`view-*.js`) | 260 KB | 226 KB | Over the site network |

## Waiting time — `e2e/performance.spec.ts`

Measured in CI (headless Chromium, software rendering, shared runner), so these catch
regressions; real hardware is faster.

| Moment | Budget |
| --- | --- |
| Open the demo facility → first panorama shown | 4 s |
| … → every tile of it loaded | 8 s |
| Scene change → next scene fully loaded | 3 s |
| Open a delivered intranet package (each file verified as it loads) | 8 s |

## Checked by hand on reference PCs (Evactis)

Frame rate cannot be measured meaningfully on CI's software renderer. Before a release,
on the reference PCs (a typical office laptop with integrated graphics, a kiosk PC, a
tablet, a headset's browser for VR):

1. Open the demo facility and a real client environment; turn the view continuously for
   ten seconds in each scene type (panorama, 360° video, GLB, splat). It should feel
   smooth (≈ 60 frames per second; Chrome's frame-rate meter, `Ctrl+Shift+P` → "Show
   frames per second meter", gives the number).
2. Import a 12K panorama and a 5.7K 360° video in Studio; note the times (Windows CI
   records the panorama at about 10 s on a hosted runner).
3. Open an encrypted `.evx` of a large environment in the Viewer; note the time to the
   first scene (verification and key derivation are included).

Record the results in the release notes.
