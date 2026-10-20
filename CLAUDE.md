# EVACTIS 3DWORKFLOW

Official product name: **EVACTIS 3DWORKFLOW** — capitals, no space between "3D" and
"WORKFLOW". Publisher: **Evactis** (evactis.ca). Components:

- **3DWORKFLOW Studio** — desktop authoring app (Evactis staff). Windows name: "EVACTIS 3DWORKFLOW Studio".
- **3DWORKFLOW Viewer** — framework-free client player. Windows name: "EVACTIS 3DWORKFLOW Viewer".
- **3DWORKFLOW Site Server** — optional, client-hosted, LAN-only (Phase 11).

Taglines: "Safe plans. Clear paths." · "See the space. Understand the plan."

## The four positioning requirements (non-negotiable; override any default)

1. **Full facility intelligence** — every layer (safety, operations, assets, emergency
   response) unified in one interactive environment.
2. **Equal clarity for every audience** — staff, contractors, leadership, first responders.
3. **A finished product, not a data dump** — a complete, ready-to-navigate environment.
4. **Zero cloud exposure** — runs entirely on the client's hardware with no cloud
   service or internet connection; no third party ever hosts or holds standing access
   to raw or in-progress facility data; delivered on the client's preferred medium,
   including fully air-gapped setups.

In practice: **no SaaS backend, no telemetry, no CDNs, no external fonts, no "phone
home" update checks, no third-party APIs at runtime.** Never add a dependency that
makes network calls at runtime.

## Brand summary (source of truth: images in `brand/`; re-open them before any UI work)

- Logo mark: navy block "E" whose middle bar is an open doorway, green arrow exiting.
  Traced to `packages/brand/logo-mark.svg` (IoU ≥ 0.99 vs `brand/evactis-logo-mark.png`,
  enforced by a test). Never recolour, stretch or redraw it. On dark backgrounds use
  the paper-plate lockup.
- Logo: the mark doubles as the "E" of EVACTIS, followed by "VACTIS" (green "I"), as on
  evactis.ca. Product lockup adds "3DWORKFLOW" (green "3D") — `product-lockup*.svg`.
- Colours (sampled): navy `#0A2F5B`, green `#71B043`, green-strong `#5D9518`, ink
  `#0A0A0A`, surface-dark `#101809`, paper `#FAFAFA`; derived text-green `#4A7A13` (small green text on light
  backgrounds only); safety: green `#00843D`, red
  `#C8102E`, yellow `#F2C230` + `#1A1A1A` border. Tokens: `packages/brand/src/tokens.ts`.
- Type: Inter (bundled, OFL) for body and heavy all-caps headings; eyebrow labels are
  small letter-spaced green caps after a short green rule; green square-dot bullets.
- Chrome: dark by default (ink + dark-green radial glows), light mode matches the header bar.
- Button kit: 18 icons × 3 states (default / hover-focus / active), 2 round markers,
  7 safety signs in styles A and B. Brand sheet: `pnpm --filter @evactis-3dworkflow/brand sheet:dev`.
- Safety signs follow ISO 7010 conventions but are not certified artwork; never claim
  compliance in the UI (see `docs/safety-signage.md`).

## Repository map

| Path | What |
| --- | --- |
| `brand/` | Reference images (logo, button kit, website captures). Do not edit. |
| `packages/schema` | Environment document: Zod schema, `schemaVersion`, migrations, reference checks, i18n helpers. |
| `packages/brand` | Tokens, logo/lockups, icons, button/marker/sign components, fonts, brand sheet, asset generator. |
| `packages/viewer` | 3DWORKFLOW Viewer core: `createViewer()`, tiles, controls, transitions, actions, hotspots, skin chrome. Demo page in `demo/` (`?kiosk`, `?no-skin`, `?bg=`). |
| `packages/print` | Evacuation plan PDFs (letter/tabloid, bilingual, "You are here") and equipment register (CSV/XLSX/PDF); pdf-lib, no network. |
| `packages/demo-facility` | Seeded demo facility: procedural panoramas + tiles + validated environment (`pnpm build` renders it); Phase 6 media (HDR office, alarm, photos, PDF; WebM videos from `scripts/video.ts`). |
| `packages/desktop-bridge` | UI side of the desktop shell (app info, smoke-test report, network watch). |
| `crates/evx-media` | Studio media pipeline: validation, EXIF, cube tiling, previews, HDR, stereo, video via LGPL FFmpeg, GLB/splat checks. No network code. |
| `crates/evx-core` | UI-free Rust core (identity, launch args, navigation guard, project location, smoke report). |
| `crates/evx-desktop` | Tauri shell shared by both apps (window, offline navigation guard, commands). |
| `apps/studio` | 3DWORKFLOW Studio: Tauri v2 + React + Vite + Tailwind + Radix. Editor in `src/editor/` (store, ops, safetyOps, contentOps, skinOps, autolink, Tour/Floors/Safety/Content/Skin/Versions); `src/testing/` is the e2e-only in-memory backend. |
| `apps/viewer-desktop` | 3DWORKFLOW Viewer desktop: Tauri v2 + vanilla TS. |
| `packaging/windows` | EULA placeholder, vendored upstream installer templates. |
| `scripts/windows` | Test certificate, signing, installer build, offline firewall, smoke test. |
| `scripts/linux` | Real-app smoke test: built Studio/Viewer in a network namespace with no interfaces, screenshots. |
| `tools/` | Offline guardrails (URL scan, licences, CSP), static test server, installer template generator, smoke-report checker. |
| `e2e/` | Playwright tests; all run in network-blocked mode (`e2e/offline.ts`). Fixtures in `e2e/fixtures/` import real media with the Rust pipeline. |
| `docs/` | Decisions (`docs/decisions/`), licences, IT deployment, brand usage, signage note. |

## Commands

- `pnpm install` then `pnpm check` — the CI gate: format, lint (incl. external-URL rule),
  generated-asset checks, typecheck, unit tests, builds, Rust core tests, URL guardrail,
  licence guardrail, Playwright (offline mode, visual + legibility).
- `pnpm brand:generate` — regenerate tokens.css, logos, kit SVGs, fonts, app/file icons,
  installer bitmaps. `pnpm installers:templates` — regenerate NSIS/WiX templates.
- `pnpm test:e2e:update` — refresh visual baselines (Linux; review the diff first).
- `node e2e/fixtures/studio-project.mjs` — build Studio's browser test build + imported test media
  (`target/e2e-studio-project`); Playwright does this itself.
- `pnpm --filter @evactis-3dworkflow/viewer dev` — Viewer demo facility at http://127.0.0.1:1430.
- `cargo test --workspace` — all Rust tests (Linux needs webkit2gtk-4.1 dev packages).
- `scripts/linux/real-app-smoke.sh` — run the built apps with no network interfaces (Studio
  imports a 12K panorama + 360 video); screenshots in `target/real-app-smoke/`. CI job
  "Real apps offline (Linux)" runs it on every push. Build first with
  `pnpm --filter <app> tauri build --no-bundle` and `cargo build --release -p evx-media --example import`.
- Windows installers: `scripts/windows/build-installers.ps1` (`-Offline` for air-gapped
  builds after `prepare-offline-build.ps1`); smoke test:
  `scripts/windows/smoke-test.ps1` (see `docs/windows-installers.md`).
- Set `TURBO_TELEMETRY_DISABLED=1` (Turborepo collects telemetry by default; CI sets it).

## Identifiers (never change after first release)

- Bundle IDs: `ca.evactis.3dworkflow.studio`, `ca.evactis.3dworkflow.viewer`.
- Executables: `EVACTIS-3DWORKFLOW-Studio.exe`, `EVACTIS-3DWORKFLOW-Viewer.exe`.
- MSI upgrade codes: Studio `909A880C-A380-4ACC-B63B-4C710E275196`, Viewer `31227426-D911-4A16-AC52-B73EF932C17F`.
- File types: `.evxproj` "EVACTIS 3DWORKFLOW Project" (Studio), `.evx` "EVACTIS 3DWORKFLOW Environment" (Viewer).

## Working rules

- Read this file at the start of every session; keep the phase checklist current.
- Each phase ends working, tested and committed; summarise and wait for go-ahead.
- Re-open `brand/` images when building or changing UI; compare, don't recall.
- Record every dependency, font and binary licence in `docs/licenses.md`.
- Small focused commits; a `docs/decisions/` entry for each significant choice.
- Write tests with features. Never mark a phase done with failing checks or guardrails.
- Safety content: never auto-generate evacuation routes or equipment locations without a
  human placing or confirming them (`confirmed` field in the schema); every printed plan
  carries a "verify on site" note and a date.
- Ambiguity: pick the simplest interpretation that keeps future phases possible, record
  it under Assumptions below, continue. Ask only for hard-to-reverse decisions.

## Phase checklist

- [x] **Phase 1 — Foundations and brand** (awaiting review)
  - [x] Monorepo (pnpm + Turborepo, TS strict), `pnpm check`
  - [x] Schema package (full data model, schemaVersion 1, migrations, reference checks)
  - [x] Brand package: traced logo, lockups, tokens, local fonts, 18 icons × 3 states, markers, signs A/B
  - [x] Brand sheet + visual and legibility tests (gradient + 3 synthetic panoramas)
  - [x] Tauri v2 shells for Studio and Viewer, offline navigation guard, `--smoke-test`
  - [x] Windows CI: signed (test cert) NSIS + MSI, silent install → launch → uninstall
  - [x] Visual sign-off of brand sheet and product lockup by Evactis (2026-10-14)
  - [x] Offline build + signing path (USB token, no cloud; ADR 0008)
  - [x] First green run of the Windows workflow on GitHub Actions (2026-10-15: build, signatures, offline rebuild, 5 install variants × windows-2022/2025)
  - [ ] Full air-gap acceptance in Windows Sandbox (`docs/windows-installers.md`)
- [x] **Phase 2 — Viewer core** (awaiting review)
  - [x] Equirect + multi-resolution cube tiles, render on demand
  - [x] Mouse, touch (drag/pinch), wheel, keyboard and gyro control
  - [x] Fade / zoom / walk transitions (reduced motion aware)
  - [x] Action system, conditions, variables, audiences, quiz questions
  - [x] Public API `createViewer(el, environment, options)` with events and methods
  - [x] Relative, local-only asset loading; no eval; strict CSP clean
  - [x] Seeded demo facility (6 procedural scenes, 2 floors) navigable on desktop and mobile in network-blocked Playwright, with screenshot tests
  - [x] Core bundle budget (< 300 KB gz; currently ~167 KB)
- [x] **Phase 3 — Local media pipeline (Studio)** (awaiting review)
  - [x] `evx-media`: validate, copy + SHA-256 IDs, EXIF, cube tiles (shared layout JSON), previews, HDR, stereo, GLB/splat checks, atomic staging, cancel
  - [x] 360 video via FFmpeg (LGPL-only encoder chain, file/pipe protocols only)
  - [x] Studio: create/open project, library grid + details, import by picker or drag-drop, progress, cancel, EN/FR errors
  - [x] 12K panorama imported, tiled and shown in the Studio library with networking removed (Linux, real binary, `--smoke-import`)
  - [x] Windows: LGPL FFmpeg bundled; 12K panorama (~10 s) + 360 video import pass in the installed app with Studio and FFmpeg firewalled (windows-2022/2025)
  - [x] Studio-made tiles render in the right directions in the Viewer (e2e compass test)
  - [x] Phase 1 carry-over: first green Windows workflow
- [x] **Phase 4 — Studio core editing** (awaiting review)
  - [x] Tour editor: scenes from the library, live preview (the real Viewer, editing mode), start view, north
  - [x] Hotspots placed by clicking the preview, dragged to move; link and information hotspots
  - [x] Action editor (go to scene, information, turn view, floor plan, packaged file)
  - [x] Floors: buildings/floors, plan import (raster), two-point scale, plan north, scene placement
  - [x] Link suggestions from plan positions, GPS and capture order (author accepts each)
  - [x] Undo/redo (Ctrl+Z/Ctrl+Y, labelled), validated autosave, local versions in `.evx-history`
  - [x] Acceptance: 10-scene, 2-floor tour built in the UI and walked in the Viewer (`e2e/studio-tour.spec.ts`)
- [x] **Phase 5 — Safety and emergency layer** (awaiting review)
  - [x] Schema: postings, type symbols, shared safety helpers (audience filter, nearest route, bearings)
  - [x] Demo facility: equipment on both floors, primary + alternative routes, assembly point, postings, first-responder-only layer (FACP, riser, FDC, key box, electrical)
  - [x] Viewer: equipment sign hotspots from one position per item, floor-plan view with "You are here", animated route chevrons, evac-route button (nearest primary, alternative one tap away), audience switcher and lock
  - [x] Studio Safety tab: equipment synced between list, scene and plan; route drawing with suggested scenes/directions; postings; named confirmation (cleared on move); audience lock
  - [x] Printable evacuation plans (PDF, letter + tabloid, bilingual, "You are here" per posting, legend, verify-on-site note + date); register CSV/XLSX/PDF
  - [x] Acceptance: first responders see layers staff do not, routes animate (`e2e/viewer-safety.spec.ts`); Studio places, routes, prints legibly at letter and tabloid (`e2e/studio-safety.spec.ts`)
- [x] **Phase 6 — Rich features** (awaiting review)
  - [x] Live layers with a "smoke conditions" variant (haze denser at the ceiling), switcher, announced
  - [x] Animated regions (video on a polygon, conditional, still with reduced motion)
  - [x] Adaptive HDR (luminance map from the importer; exposure follows the view)
  - [x] 360° video scenes with controls and timed hotspots
  - [x] Spatial audio (alarm at its panel) with direction captions
  - [x] Floor-plan radar widget, photo albums, local PDF reader (pdf.js, no worker, no eval)
  - [x] Studio: import sounds/PDFs/photos (Rust), Content tab, media action editor, timed hotspots
  - [x] Acceptance: each feature demonstrated in the demo facility (`e2e/viewer-rich.spec.ts`), authored in Studio (`e2e/studio-content.spec.ts`)
- [x] **Phase 7 — Skin designer and Evactis default skin** (awaiting review)
  - [x] Schema: skins as elements (toolbar, logo, title, radar, language) at 9 anchors per breakpoint (phone/tablet/desktop/kiosk, cascading), safe tokens
  - [x] Viewer: skin chrome (`skin`, `kiosk` options, `setSkin()`), anchors in flex rows, overflow commands in the menu, published insets, info/help/menu panels, co-branding
  - [x] Evactis default skin: button-kit toolbar (bottom; fewer buttons on smaller screens), plate lockup top-left, eyebrow scene titles, radar + language top-right, larger kiosk targets
  - [x] Studio Skin tab: real Viewer at 375/768/1440/1080p (landscape + portrait), select/drag/nudge, anchor picker, offsets, size, visibility, inherit, toolbar buttons + direction (side toolbar), theme colours with contrast refusal, client logo/name, screen widths
  - [x] Acceptance: layout at 375, 768, 1440 and 1080p kiosk (both orientations) and legibility over the gradient + 3 panoramas (`e2e/viewer-skin.spec.ts`); designer (`e2e/studio-skin.spec.ts`)
- [ ] Phase 8 — Training modules
- [ ] Phase 9 — 3D, stereo and VR
- [ ] Phase 10 — Offline packaging and delivery
- [ ] Phase 11 — 3DWORKFLOW Site Server (optional)
- [ ] Phase 12 — Hardening and handover

## Assumptions (Phase 1)

1. **Logo = mark-as-"E" + "VACTIS"**, as on evactis.ca, not mark followed by a full
   "EVACTIS" (which would read "EEVACTIS"). The product lockup follows the same rule.
   *Confirmed by Evactis, 2026-10-14.*
2. **Wordmark typeface**: no vector wordmark was supplied, so "VACTIS" is rebuilt in
   Poppins ExtraBold outlines, tracked to match the website capture. Replace with the
   official vector if Evactis has one (ADR 0005).
3. **`.evxproj` is a file**: a project is a folder containing `<name>.evxproj` (manifest
   JSON) + `media/`. Windows cannot associate a folder by extension, so the manifest is
   what double-clicks open (ADR 0004). *Confirmed by Evactis, 2026-10-14.*
4. **WebView2**: installers embed the offline WebView2 installer (installed only if
   missing); the Phase 10 portable Viewer will use a fixed-version runtime (ADR 0003).
5. **"Networking disabled" in CI** = product processes firewalled + dead system proxy,
   because a hosted runner cannot drop its adapter. True air-gap acceptance runs in
   Windows Sandbox with networking disabled (`docs/windows-installers.md`).
6. **Per-user install** is offered by the NSIS setup (`/CurrentUser`, no admin for
   standard users). The MSI is per-machine only, for IT deployment.
7. **WiX produces one MSI per language** (en-US, fr-FR); NSIS is one bilingual setup.
8. **Active-state contrast**: white icon on green-strong is 3.6:1 — meets WCAG 1.4.11
   (3:1 non-text), not 4.5:1. Kept to match the kit; flagged for review.
9. **Safety-sign pictograms** are original drawings in ISO 7010 colour/shape families,
   not ISO artwork.
10. **Code signing is offline, no cloud** (Evactis, 2026-10-14): OV certificate on a USB
    hardware token at a signing station; builds and signing run with networking off;
    release installers timestamped afterwards via a hash-only hop (option A, standard) (`docs/code-signing.md`, ADR 0008). CI only
    ever uses a TEST certificate.
11. **Viewer hotspots behind the camera** stay keyboard-focusable; focusing one turns the
    view to it (accessibility over strict "hide what you can't see").
12. **Demo panoramas are procedural** (ray-cast rooms), so the repository holds no
    photographs and the demo is regenerated deterministically on build.

## Assumptions (Phase 3)

13. **Stereo panoramas get no tiles yet**: previews come from the left eye; VR (Phase 9)
    uses the full source.
14. **FFmpeg source offer**: Studio ships an LGPL FFmpeg; `ffmpeg\SOURCE.txt` carries a
    written offer to provide the corresponding source on physical media for three years.
    *Needs Evactis confirmation (legal), or ship the source archive in each release kit.*
15. **Playback video is capped at 4096 px wide** (H.264 decoder compatibility); originals
    are kept in the project for later re-conversion.
16. **HDR panoramas are tone-mapped automatically** (Reinhard, log-average exposure); the
    original `.hdr` is kept.
17. **A developer's FFmpeg on `PATH` is not licence-checked at runtime**: running it
    locally is not distribution. The copy Studio ships is checked at build and smoke time.

## Assumptions (hardening, before Phase 4)

18. **CTA buttons use large bold text** (700, 19 px): white on green-strong is 3.6:1,
    which meets WCAG AA only as "large text" (3:1). Matches the website CTA. The brand
    sheet baseline was updated (buttons only; logos unchanged). *Flag for Evactis review.*
19. **Light mode uses a derived darker green (`#4A7A13`) for small green text**
    (eyebrows): green-strong is 3.5:1 on paper, below 4.5:1. Dark mode (default, as on
    the website) is unchanged. *Flag for Evactis review.*
20. **Contrast is enforced by test** (`e2e/contrast.ts`): every visible text in Studio
    (both themes, both languages, About dialog) and the Viewer shell must meet WCAG AA.

## Assumptions (Phase 4)

21. **Versions save the project file only** (`<project>/.evx-history/`): media is
    content-addressed and never modified, so the manifest is a complete version. A
    version may point at media removed from the library since; restoring reports it.
22. **Floor plans are raster images** (PNG/JPG/TIFF, scaled to 4096 px). PDF and CAD
    plans are exported to PNG first; native PDF/DXF import would need a large renderer.
23. **Links are suggested, never created automatically**: from plan positions, then GPS,
    then capture order, within 30 m. Hotspots are aimed at the floor where the neighbour
    stands (camera height 1.6 m); the author checks where each lands.
24. **Phase 4 action editor** covers navigation and information actions; safety,
    training and media actions get their editors in Phases 5, 6 and 8 (existing ones are
    kept and listed).
25. **Undo history lasts for the session** (100 steps); versions are the long-term
    history. Automatic versions: on open and every 10 minutes of editing, 30 kept.
26. **Plan placement is by mouse**; a keyboard alternative is planned for Phase 12.

## Assumptions (Phase 5)

27. **Only confirmed content prints or routes** in the delivered Viewer; the register
    lists every item and marks unconfirmed ones. Moving, retyping or redrawing clears
    a confirmation; text and inspection-date edits keep it (ADR 0012).
28. **Postings and type symbols were added to schema v1** without a version bump: v1
    is unreleased and both default to empty.
29. **Printed plans are bilingual on one sheet** (English then French), as commonly
    posted in Canadian workplaces; print fonts are static Inter, latin subset.
30. **Legible = nothing under 8 pt on letter**, scaled up on tabloid; checked by unit
    and e2e tests. *Evactis to review a physical print of both sizes.*
31. **Route scenes and walking directions are suggested from the drawing** (scenes
    within 3 m of the line) and applied by the author; never set automatically.
32. **Register scene links are relative** (`index.html?scene=<id>`), valid inside the
    Phase 10 delivery package.

## Assumptions (Phase 6)

33. **Smoke is a haze, not a simulation**: a panorama has no depth, so visibility (m)
    becomes one haze amount, denser towards the ceiling. Hotspots and signs stay crisp
    (they are the interface, not part of the scene).
34. **Adaptive HDR works from a luminance map** next to 8-bit tiles (±8 stops around
    the tone-mapped average); exposure moves −2 to +1.5 stops.
35. **Spatial audio uses stereo panning plus facing gain**, not HRTF, so it behaves the
    same in every webview; captions say where a sound comes from.
36. **The radar is a Viewer option** (`radar: true`, on in the demo); the Phase 7 skin
    decides where it sits.
37. **Region clips are package files referenced by path** (WebM/MP4 or an image) until
    a clip import exists; the demo's two WebM files are generated by a script and
    committed (builds need no FFmpeg).
38. **Animated regions take an optional condition** (additive to unreleased schema v1),
    e.g. a strobe only while the alarm sounds.
39. **Studio previews never autoplay sounds**; authors press "Play in the preview".

## Assumptions (Phase 7)

40. **Kiosk is a deployment option, not a width**: the kiosk layout applies when the
    environment is delivered as a kiosk (Phase 10 sets it), at any size or orientation.
41. **Breakpoints follow the Viewer's own width** (phone ≤ 600 px, tablet ≤ 1100 px,
    editable per skin), so an embedded Viewer lays out like a full-screen one.
42. **Skins are structured, not free HTML/CSS**: five element types at nine anchors.
    New widgets (e.g. Phase 8 training progress) are added to the schema and renderer.
43. **Theme tokens are limited to five brand tokens** in Studio (button face, accent,
    pressed button, icons/text, corner radius); safety colours are never themeable, and
    colours that fail the contrast rules are refused (ADR 0014).
44. **Menu and evacuation route stay on every toolbar**; other buttons without room move
    into the menu. Audience and live-layer switches live in the menu's settings.
45. **The VR button stays hidden until Phase 9**; full screen is never offered on a kiosk.
46. **Client logos are PNG/JPG/WebP** shown from the original file (transparency kept);
    SVG logos are exported to PNG first. The 3DWORKFLOW Viewer desktop shell gets the
    skin with environment loading in Phase 10.

## Requirements added by Evactis

- **Insta360 originals drop straight into Studio** (Evactis, 2026-10-15): `.insp` photos
  and `.insv` videos must import without a manual export from Insta360's app, so Studio
  needs dual-fisheye stitching. Plan: Insta360's developer kit if its terms allow fully
  offline use and redistribution (Evactis to apply), plus a built-in photo stitcher as
  fallback. Camera: **Insta360 X5**. Blocked on: sample originals + matching Insta360 exports
  (non-sensitive location), SDK decision. Until then, originals get a clear EN/FR
  message instead of "unsupported".

## Future work (out of scope for now)

- Stitching for cameras other than Insta360 (assume stitched equirects).
- Building automation / live sensor feeds — `Equipment.attributes` is reserved for a
  later local integration.
- Any Evactis-hosted cloud service, payments, or licensing server. If licensing is
  ever needed it must work offline (signed licence files).
