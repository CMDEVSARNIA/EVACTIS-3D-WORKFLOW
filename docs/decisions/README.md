# Decision records

One file per significant choice: context, decision, consequences. Never rewrite an
accepted record; supersede it with a new one.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-monorepo-and-toolchain.md) | pnpm + Turborepo monorepo, TypeScript strict, pinned versions | Accepted |
| [0002](0002-offline-guardrails.md) | Three-layer offline guardrail (lint, build scan, runtime block) | Accepted |
| [0003](0003-webview2-and-runtime.md) | Embed WebView2 offline installer; static C runtime | Accepted |
| [0004](0004-project-file-layout.md) | `.evxproj` is a manifest file inside a project folder | Accepted (Evactis, 2026-10-14) |
| [0005](0005-logo-wordmark-and-lockup.md) | Traced mark, Poppins-outlined wordmark, product lockup | Accepted (Evactis, 2026-10-14) |
| [0006](0006-installer-templates.md) | Patched Tauri NSIS/WiX templates for paths, shortcuts, file icons | Accepted |
| [0007](0007-code-signing.md) | Test certificate in CI until the Evactis certificate exists | Superseded by 0008 |
| [0008](0008-offline-code-signing.md) | Offline signing on a USB hardware token; no cloud; offline builds | Accepted (Evactis, 2026-10-14) |
| [0009](0009-viewer-core-architecture.md) | Viewer core: Three.js on demand, shared cube tiles, DOM hotspots | Accepted |
