# 0011 — Studio editing: document store, versions, floor plans, link suggestions

**Context.** Phase 4: an author builds a whole facility tour in Studio — scenes from the
media library, start view and north, hotspots placed by clicking the live preview, an
action editor, floor plans with a scale, suggested links between nearby scenes, undo and
redo, autosave and local versions. Done when a 10-scene, 2-floor tour with linked
hotspots can be built entirely in Studio.

**Decision.**
- **The preview is the real Viewer.** Studio embeds `@evactis-3dworkflow/viewer` in
  editing mode (Phase 4 API: `panoramaclick`, `hotspotclick` selects instead of running
  actions, draggable hotspots with `hotspotmove`, `setEnvironment`, `selectHotspot`).
  "Test the tour" rebuilds it in normal mode, so authors see exactly what clients see.
  Assets go through `resolveAsset` (the desktop asset protocol, scoped by Rust to the
  open project's `media/`); the Viewer refuses any URL that is not local.
- **One document store, whole-document undo.** `apps/studio/src/editor/store.ts` holds
  the environment. An edit is a function applied to a `structuredClone` of it; the
  previous document is the undo step (100 kept). Environments are small (tens of KB for
  a 10-scene tour), so copies are simpler and safer than patches, and no new dependency
  is needed (immer was considered and not added). Edits with the same key within 1 s
  merge (dragging, typing). An edit that throws leaves no trace.
- **Operations keep the document valid** (`editor/ops.ts`): IDs unique and readable
  (slugs of names), removals take their links with them, and a removal that would
  break safety content (equipment, routes) or training is refused, never silently
  rewritten. The full schema check runs before every save.
- **Autosave** 1.5 s after the last edit, only for documents that pass the full schema
  (shapes and references), so the file on disk always opens in the Viewer. The save
  state is always visible; closing a project waits for the save, and stays open if the
  document cannot be saved.
- **Versions are copies of the manifest** in `<project>/.evx-history/`
  (`crates/evx-core/src/history.rs`): one on open (skipped when unchanged), one every
  10 minutes while editing, 30 automatic versions kept; named versions are never
  pruned. Restoring first saves the current state as a "before restore" version.
  Media is content-addressed and never modified, so the manifest alone is a complete
  version; nothing leaves the project folder.
- **Floor plans are raster images** imported through the same pipeline
  (`Purpose::FloorPlan`): any aspect ratio, scaled to fit 4096 px (PNG kept lossless,
  JPEG for scans). Plan coordinates are pixels of that stored image. PDF/CAD plans get
  an "export to PNG first" message: rendering PDF would need a large dependency.
  Replacing a plan with a different size rescales placed scenes and the calibration.
- **Scale by two points and a distance**: `pixelsPerMetre = pixel distance ÷ metres`.
  Plan north is entered in degrees clockwise from the top of the plan.
- **Link suggestions, never automatic links** (`editor/autolink.ts`). Sources, best
  first: positions on the same floor plan (direction from the plan and its north,
  distance once calibrated), camera GPS (haversine distance and bearing), then capture
  order (previous and next shot, direction unknown). A bearing becomes a yaw through
  the scene's `northOffsetDeg`; the hotspot is aimed at the floor where the neighbour
  stands (camera height 1.6 m). Within 30 m, nearest four, plus capture-order
  neighbours. The author adds each one and sees where it lands.
- **Actions offered in Phase 4**: go to scene (with transition), show information
  (EN/FR text), turn the view, show floor plan, open a packaged file. Other action
  types are kept and listed; their editors come with their phases (safety, training,
  media).
- **Browser test build.** `vite build --mode e2e` swaps the Rust commands for an
  in-memory backend (`src/testing/memoryApi.ts`) over media imported by the real Rust
  pipeline (`e2e/fixtures/studio-project.mjs`), so Playwright drives the real UI. The
  mode is a compile-time constant: the desktop build does not contain the test backend
  (checked by grep of `dist/` during development; the size and URL guardrails scan it).

**Consequences.**
- Undo history is per session; versions are the long-term history.
- A version can reference media that was later removed from the library; restoring it
  reports the missing files through the normal reference checks.
- Plan placement is mouse-based; a keyboard alternative (coordinates) is planned with
  the Phase 12 accessibility pass.
