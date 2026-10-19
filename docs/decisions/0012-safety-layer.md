# 0012 — Safety layer: confirmed content only, plan-drawn routes, local printing

**Context.** Phase 5: equipment placed with the safety-sign hotspots and synced between
scene and floor plan; evacuation routes drawn on plans, animated in the panoramas, with
"You are here" and assembly points; the evac-route button picks the nearest primary
route, the secondary one tap away; audience layers and a package audience lock; printed
evacuation plans (letter and tabloid, bilingual, "You are here" per posting); an
equipment register (CSV, XLSX, PDF). CLAUDE.md: safety content is never generated
without a human placing or confirming it, and every printed plan carries a "verify on
site" note and a date.

**Decision.**
- **One position per item, two views.** An item has one plan position (floor + plan
  pixels) and a placement per scene that shows it (yaw/pitch). The Viewer synthesises
  its sign hotspots (`equipment:<id>`) from these, so scene, plan, print and register
  can never disagree. Studio selects the same item in the list, the preview and the
  plan; selecting it elsewhere brings its scene and floor into view.
- **Confirmation is a named, dated record** (`confirmed: {by, at}`). Moving an item,
  changing its type or redrawing a route clears it; text edits (labels, inspection
  dates) do not. Only confirmed items and routes print or show as routes in the
  delivered Viewer; the register lists every item, marking unconfirmed ones. Studio's preview
  (editing mode) shows drafts so authors can check them before confirming.
- **Routes are drawn on plans; scenes and directions are suggestions.** A route is one
  line per floor ending at an assembly point. Studio suggests the scenes within 3 m of
  the line (in walking order) and a walking direction per scene (the bearing along the
  line, through plan north and the scene's north offset); the author applies them with
  a click and can set any direction from the current view instead.
- **Nearest route**: routes that pass through the current scene come first; otherwise
  the distance from the scene's plan position to the route's line on that floor, ties
  going to the shorter route. The nearest primary route is shown; the nearest other
  route (secondary first) is offered on the same banner.
- **Audiences filter, never hide safety for everyone.** An item or route with no
  audience is for everyone; a listed audience adds layers (first responders: FACP,
  sprinkler riser, FDC, key box, electrical shut-off). `settings.lockAudience` fixes
  the delivered package to its default audience.
- **Postings are additive to schema v1.** `postings` (where a printed plan hangs, with
  the reader's facing) and `EquipmentType.symbol` default to empty, so v1 documents
  stay valid; v1 has not been released, so no migration is needed.
- **Printing is local and deterministic** (`packages/print`): pdf-lib with
  @pdf-lib/fontkit, the static Inter weights (latin, OFL) embedded as subsets, signs and
  the lockup from the brand package, plan images read from the project's `media/` by a
  scoped Rust command. Fixed PDF dates; the printed date is on the page. Legibility is
  enforced: nothing under 8 pt on letter, everything scaled up on tabloid (unit test
  on the layout report, e2e test on the extracted word boxes). The XLSX is written by
  hand (stored ZIP, one sheet), avoiding a spreadsheet dependency.
- **Exports go only where the author picks.** Studio's `export_file` command accepts a
  path only if it was returned by the save dialog in this session, or is a safe file
  name inside a folder picked in this session; writes are atomic.

**Consequences.**
- Unconfirmed content is invisible to clients by design; Studio warns before printing
  how many items or routes will be left out.
- Print fonts cover latin only (English and French). Other scripts would need another
  font subset.
- Register scene links are relative (`index.html?scene=<id>`), valid inside the
  delivered package (Phase 10); they do not point anywhere outside it.
- Signs follow ISO 7010 conventions but are not certified artwork; printed plans never
  claim compliance.
