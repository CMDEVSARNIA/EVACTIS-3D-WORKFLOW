# 0020 — Hardening: accessibility, keyboard authoring, budgets, unattended Site Server

**Context.** Phase 12 hardens the products for handover: accessibility (automated checks,
target sizes, keyboard use), English/French completeness, performance budgets, a
security review with an SBOM, and the Site Server items left from Phase 11.

**Decision.**
- **Accessibility is tested, not reviewed once.** `e2e/a11y.spec.ts` runs axe-core
  (WCAG 2.1 A/AA rules) on Studio (both themes and languages, every editor tab), the
  Viewer with its panels, the packaged player and every Site Server page; contrast keeps
  its own stricter check (`e2e/contrast.ts`). axe is a test-only dependency.
- **Target size: 24 px everywhere (WCAG 2.2 AA), 44 px on the Viewer toolbar** (what people
  tap on tablets and kiosks). Radar dots stay 24 px: they sit close together on a small
  map, and hotspots and the floor plan reach the same places. Sizes are measured at the
  element's own layout size; a checkbox counts with its label.
- **Keyboard authoring without new modes.** Plans get a focusable crosshair (arrow keys,
  Shift faster, Alt finer, Enter acts as a click), shared by every plan action (placing
  scenes and equipment, setting the scale, drawing routes). In the 360° preview the
  author turns the view with the Viewer's own arrow keys and uses "Place at / Move to the
  centre of the view" (`Viewer.centrePlacement()`, which also finds the model surface in
  3D scenes).
- **EN/FR completeness by guardrail**: every exported `{ en, fr }` table is compared key
  by key, and a French entry equal to the English one fails unless the word is the same
  in both languages (listed in the guardrail).
- **Budgets as CI ceilings**: gzipped sizes of every shipped bundle about 10–20 % over
  today's, and waiting times (first scene, scene change, package open) generous enough
  for CI's software renderer. Frame rate is checked by hand on reference PCs
  (`docs/performance.md`).
- **SBOM from the lockfiles** (CycloneDX 1.5, checksums, reproducible), made offline;
  vulnerability checks happen on a connected machine with the SBOM only.
- **Site Server unattended on Windows: a scheduled task, not a service wrapper.** A Node
  program cannot answer the Service Control Manager; a boot task as LOCAL SERVICE with
  restart on failure needs nothing else installed, and `install-task` also scopes the
  data-folder rights and firewall rules. A wrapper (WinSW) remains possible for sites that
  want a true service.
- **Security fixes from the review**: `worker-src 'none'` on every page; plain `ldap://`
  without StartTLS refused unless explicitly allowed; in-page dialogs instead of browser
  prompts (`docs/security-review.md`).

**Consequences.** Regressions in accessibility, translations, size and load time fail CI
like any test. Some checks stay manual by nature: screen-reader walk-throughs, reference
PC frame rates, real headsets, and the Windows Sandbox air-gap check.
