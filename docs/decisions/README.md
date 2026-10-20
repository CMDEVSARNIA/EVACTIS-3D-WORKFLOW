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
| [0010](0010-local-media-pipeline.md) | Local media pipeline: Rust tiler, content-hash library, LGPL FFmpeg sidecar | Accepted |
| [0011](0011-studio-editing.md) | Studio editing: whole-document undo, validated autosave, manifest versions, raster floor plans, suggested links | Accepted |
| [0012](0012-safety-layer.md) | Safety layer: confirmed content only, plan-drawn routes, local printing and exports | Accepted |
| [0013](0013-rich-features.md) | Rich features: one panorama shader, adaptive HDR map, local media, pdf.js without a worker | Accepted |
| [0014](0014-skins.md) | Skins: structured elements at anchors per breakpoint, kiosk as a deployment option, safe tokens only | Accepted |
| [0015](0015-training-and-scorm.md) | Training modules in the Viewer, certificates on the device, SCORM through a packaged player | Accepted |
| [0016](0016-prototype-hardening.md) | Hardening Object.prototype without breaking printing (replaces Tauri freezePrototype) | Accepted |
| [0017](0017-3d-vr.md) | 3D scenes, stereo and VR: own splat renderer, WebXR without dependencies | Accepted |
| [0018](0018-delivery-packages.md) | Delivery packages: one format, verified at launch, decrypted in memory | Accepted |
