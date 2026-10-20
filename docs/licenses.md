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
| image 0.25.8 (+ zune-jpeg, png, tiff, hdr decoders) | Studio media import: decode, resize, encode tiles | MIT OR Apache-2.0 | None (no network code). |
| kamadak-exif 0.6.1 | Studio: capture date, GPS, camera from EXIF | BSD-2-Clause | None. |
| rayon 1.11.0 | Studio: parallel tile rendering | MIT OR Apache-2.0 | None. |
| rfd 0.16.0 | Studio: native open / folder dialogs (Windows COM dialogs; GTK on Linux) | MIT | None. Used directly instead of tauri-plugin-dialog, which also bundles tauri-plugin-fs. |
| pdf-lib 1.17.1 (+ pako, @pdf-lib/standard-fonts, @pdf-lib/upng) | Studio: printed evacuation plans and register PDFs (`packages/print`); Viewer and packaged player: training certificates (lazy chunk, Phase 8) | MIT (pako: MIT AND Zlib) | None. No network code (its `fetch` mentions are documentation comments). |
| @pdf-lib/fontkit 1.1.1 | Embeds subsets of the bundled Inter in those PDFs (plans, registers, certificates) | MIT | None. |
| pdfjs-dist 4.10.38 | Viewer: local PDF reader (loaded on first use, separate chunks) | Apache-2.0 (LICENSE text to ship with the Viewer; no NOTICE file) | None as used: no worker URL, `isEvalSupported: false`, no font/CMap/wasm downloads, no streaming or range fetches; only the package file it is given. Its optional native `@napi-rs/canvas` is removed by a pnpm override. |

## Fonts (bundled — never loaded from Google Fonts or a CDN)

| Font | Use | Licence | Embedding / redistribution |
| --- | --- | --- | --- |
| Inter (variable, Latin + Latin Ext.), via `@fontsource-variable/inter` 5.2.8 | UI body and headings in Studio, Viewer, brand sheet | SIL OFL 1.1 — `packages/brand/fonts/Inter-OFL.txt` | Allowed: OFL permits bundling and redistribution with software, including commercial, provided the licence travels with the font and the font is not sold by itself. |
| Inter static Regular/SemiBold/Bold/ExtraBold (Latin), via `@fontsource/inter` 5.2.8 — `packages/brand/fonts/print/` | Embedded (subset) in printed PDFs; PDF fonts must be static | SIL OFL 1.1 — same licence file as above | Allowed: OFL permits embedding in documents. |
| Poppins ExtraBold, via `@fontsource/poppins` 5.2.7 | Converted to outlines for the "VACTIS" wordmark and "3DWORKFLOW" in the lockups. The font file itself is not shipped. | SIL OFL 1.1 — `packages/brand/fonts/Poppins-OFL.txt` | Allowed: OFL places no restriction on artwork (logos) created with the font. |

## Binaries and runtimes

| Component | Where | Licence / terms | Notes |
| --- | --- | --- | --- |
| Microsoft Edge WebView2 Runtime (offline installer) | Embedded in Studio and Viewer installers | Microsoft WebView2 Runtime distribution terms (redistribution permitted) | Installed only if missing. See ADR 0003. |
| Microsoft Visual C++ runtime | Statically linked (`+crt-static`) | Part of the MSVC toolchain licence | No redistributable is shipped or downloaded. |
| NSIS 3 (via Tauri bundler) | Build-time; stub embedded in setup .exe | zlib/libpng licence | |
| WiX Toolset 3 (via Tauri bundler) | Build-time only | MS-RL | Not redistributed. |
| FFmpeg — `ffmpeg.exe`, `ffprobe.exe` (BtbN/FFmpeg-Builds static win64 **LGPL** build) | Studio only, `<install>\ffmpeg\`; run as separate processes for 360 video import | GNU LGPL (2.1 or later; v3 when built with `--enable-version3`) — `ffmpeg\LICENSE.txt` ships beside it | `scripts/windows/get-ffmpeg.ps1` refuses any build configured with `--enable-gpl` or `--enable-nonfree`; the Windows smoke test re-checks the installed copy. The exact archive, URL and SHA-256 are recorded in `ffmpeg\SOURCE.txt`, which also carries Evactis's written offer of the corresponding source (see ADR 0010, assumption 14). Signed with the Evactis key so application-control policies accept it. Every invocation is limited to `-protocol_whitelist file,pipe`. |

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
