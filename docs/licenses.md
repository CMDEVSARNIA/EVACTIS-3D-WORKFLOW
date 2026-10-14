# Licences — EVACTIS 3DWORKFLOW

Every dependency, font and binary that ships in, or is used to build, EVACTIS
3DWORKFLOW is recorded here. `pnpm check` fails if a shipped dependency uses a licence
outside the allowed set (`tools/guardrail/check-licenses.mjs`) or if the generated
tables below are stale.

**Allowed:** MIT, MIT-0, Apache-2.0, BSD-2/3-Clause, ISC, 0BSD, Zlib, Unicode-3.0,
Unicode-DFS-2016, Unlicense, CC0-1.0, BSL-1.0, MPL-2.0 (file-level copyleft; shipped
unmodified), OFL-1.1 (fonts). Anything else needs a `docs/decisions/` entry first.

**Runtime network rule:** no dependency may make network calls at runtime. Each
entry below was added with that checked; the offline guardrail tests enforce it.

## Generated dependency tables

- [npm production dependencies](licenses/npm-production.md) (Studio and Viewer UIs)
- [Rust crates in the Windows build](licenses/rust-crates.md)

## Key runtime libraries

| Library | Use | Licence | Network at runtime |
| --- | --- | --- | --- |
| three 0.186.1 | Viewer panorama rendering (WebGL) | MIT | None. Documentation comments are stripped from the shipped bundle; one citation remains inside a shader comment string (allowlisted). |
| zod 4.1.13 | Environment validation | MIT | None. Configured `jitless` so it never probes `eval`/`new Function`. |

## Fonts (bundled — never loaded from Google Fonts or a CDN)

| Font | Use | Licence | Embedding / redistribution |
| --- | --- | --- | --- |
| Inter (variable, Latin + Latin Ext.), via `@fontsource-variable/inter` 5.2.8 | UI body and headings in Studio, Viewer, brand sheet | SIL OFL 1.1 — `packages/brand/fonts/Inter-OFL.txt` | Allowed: OFL permits bundling and redistribution with software, including commercial, provided the licence travels with the font and the font is not sold by itself. |
| Poppins ExtraBold, via `@fontsource/poppins` 5.2.7 | Converted to outlines for the "VACTIS" wordmark and "3DWORKFLOW" in the lockups. The font file itself is not shipped. | SIL OFL 1.1 — `packages/brand/fonts/Poppins-OFL.txt` | Allowed: OFL places no restriction on artwork (logos) created with the font. |

## Binaries and runtimes

| Component | Where | Licence / terms | Notes |
| --- | --- | --- | --- |
| Microsoft Edge WebView2 Runtime (offline installer) | Embedded in Studio and Viewer installers | Microsoft WebView2 Runtime distribution terms (redistribution permitted) | Installed only if missing. See ADR 0003. |
| Microsoft Visual C++ runtime | Statically linked (`+crt-static`) | Part of the MSVC toolchain licence | No redistributable is shipped or downloaded. |
| NSIS 3 (via Tauri bundler) | Build-time; stub embedded in setup .exe | zlib/libpng licence | |
| WiX Toolset 3 (via Tauri bundler) | Build-time only | MS-RL | Not redistributed. |
| ffmpeg (LGPL build) | Phase 3 — not yet included | LGPL-2.1+ | To be recorded with exact build and source offer. |

## Build and test tools (not shipped)

TypeScript (Apache-2.0), Vite (MIT), Vitest (MIT), Playwright (Apache-2.0), ESLint
(MIT), typescript-eslint (MIT), Prettier (MIT), Turborepo (MPL-2.0; telemetry disabled
via `TURBO_TELEMETRY_DISABLED=1`), Tailwind CSS (MIT), React plugin for Vite (MIT),
jsdom (MIT), Testing Library (MIT), resvg-js (MPL-2.0), opentype.js (MIT), pngjs
(MIT), jpeg-js (BSD-3-Clause; demo panorama encoding), esbuild (MIT; library minification), Tauri CLI (Apache-2.0 OR MIT), Rust toolchain (Apache-2.0 OR MIT).

## Vendored source

| Source | Licence | Notes |
| --- | --- | --- |
| `packaging/windows/upstream/` — `installer.nsi`, `main.wxs` from tauri-bundler 2.10.2 | Apache-2.0 OR MIT | Modified copies generated into `apps/*/src-tauri/windows/`. |

## Reference artwork

`brand/` holds Evactis's own reference images (logo, button kit, website captures).
They are the source of truth for the brand package and are © Evactis.
