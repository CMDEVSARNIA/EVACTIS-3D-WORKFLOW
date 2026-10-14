# 0009 — Viewer core architecture

**Context.** Phase 2: a framework-free, offline player for 360° environments with
multi-resolution tiles, mouse/touch/keyboard/gyro control, transitions, an action
system and a public API, under 300 KB gzipped.

**Decision.**
- **Three.js (WebGL), render on demand.** Frames are drawn only when the view, content
  or a transition changes, so an idle Viewer uses no GPU/CPU (kiosks, laptops on battery).
- **Shared cube layout** (`packages/viewer/src/panorama/cube.ts`): faces f/r/b/l/u/d,
  tile path `{basePath}/{face}/{level}/{row}_{col}.{format}`, row 0 at the top. Every
  tile generator (demo facility now, Studio in Phase 3) imports the same module, so the
  renderer and generators cannot disagree. Tiles are subdivided 8×8 so quads straddling
  the camera plane clip correctly (found on SwiftShader).
- **Levels**: the lowest level is loaded for the whole sphere before a scene shows;
  finer visible tiles stream in, coarse first, six at a time. Level choice compares
  face pixels per radian with screen pixels per radian.
- **Hotspots are DOM elements** from the brand kit (buttons, markers, signs, labels,
  SVG areas) positioned per frame: keyboard focusable, screen-reader labelled, styled
  by CSS. Off-screen hotspots stay in the tab order; focusing one turns the view to it.
- **Transitions** composite a snapshot of the outgoing frame over the new scene (fade,
  zoom, walk); reduced motion degrades to a short fade.
- **Actions** run in order with conditions; anything owned by a later phase (floor plan,
  routes, modules, live layers) is emitted as an `action` event for that module.
- **Offline by construction**: assets resolve only against a local/same-origin base and
  must pass `AssetPathSchema`; external links obey `offlineLinkPolicy` and are refused
  (and reported) by default; popups are built with `textContent`, never `innerHTML`.
- **No eval**: Zod runs `jitless`; the Playwright guard fails on any CSP violation.
- **Fonts are the host's job**: the core stylesheet does not embed fonts (the skin or
  page includes `@evactis-3dworkflow/brand/fonts.css`), keeping the core CSS ~10 KB.

**Consequences.** Video, GLB, splat and VR media types plug into `PanoramaRenderer.show`
in later phases as lazily imported modules; the core budget is enforced by
`tools/guardrail/size-budget.mjs`.
