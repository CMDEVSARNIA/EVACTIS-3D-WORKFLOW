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
| `packages/viewer` | 3DWORKFLOW Viewer core: `createViewer()`, tiles, controls, transitions, actions, hotspots. Demo page in `demo/`. |
| `packages/demo-facility` | Seeded demo facility: procedural panoramas + tiles + validated environment (`pnpm build` renders it). |
| `packages/desktop-bridge` | UI side of the desktop shell (app info, smoke-test report, network watch). |
| `crates/evx-media` | Studio media pipeline: validation, EXIF, cube tiling, previews, HDR, stereo, video via LGPL FFmpeg, GLB/splat checks. No network code. |
| `crates/evx-core` | UI-free Rust core (identity, launch args, navigation guard, project location, smoke report). |
| `crates/evx-desktop` | Tauri shell shared by both apps (window, offline navigation guard, commands). |
| `apps/studio` | 3DWORKFLOW Studio: Tauri v2 + React + Vite + Tailwind + Radix. |
| `apps/viewer-desktop` | 3DWORKFLOW Viewer desktop: Tauri v2 + vanilla TS. |
| `packaging/windows` | EULA placeholder, vendored upstream installer templates. |
| `scripts/windows` | Test certificate, signing, installer build, offline firewall, smoke test. |
| `scripts/linux` | Real-app smoke test: built Studio/Viewer in a network namespace with no interfaces, screenshots. |
| `tools/` | Offline guardrails (URL scan, licences, CSP), static test server, installer template generator, smoke-report checker. |
| `e2e/` | Playwright tests; all run in network-blocked mode (`e2e/offline.ts`). |
| `docs/` | Decisions (`docs/decisions/`), licences, IT deployment, brand usage, signage note. |

## Commands

- `pnpm install` then `pnpm check` — the CI gate: format, lint (incl. external-URL rule),
  generated-asset checks, typecheck, unit tests, builds, Rust core tests, URL guardrail,
  licence guardrail, Playwright (offline mode, visual + legibility).
- `pnpm brand:generate` — regenerate tokens.css, logos, kit SVGs, fonts, app/file icons,
  installer bitmaps. `pnpm installers:templates` — regenerate NSIS/WiX templates.
- `pnpm test:e2e:update` — refresh visual baselines (Linux; review the diff first).
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
- [ ] Phase 4 — Studio core editing
- [ ] Phase 5 — Safety and emergency layer
- [ ] Phase 6 — Rich features
- [ ] Phase 7 — Skin designer and Evactis default skin
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
