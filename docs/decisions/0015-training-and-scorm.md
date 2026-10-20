# 0015 — Training modules in the Viewer, certificates on the device, SCORM through a packaged player

**Context.** Phase 8: the start-module and checklist buttons drive guided modules ("find
your nearest exit", "locate the AED on floor 2", hazard hunts); quizzes, scoring, a
completion certificate (local PDF) and per-audience modules; SCORM 1.2/2004 export for
clients' own LMS. Done when a sample module runs end to end in the Viewer and in a
SCORM test harness. Zero cloud exposure still applies: no hosted LMS, no tracking.

**Decision.**
- **Modules are steps in order**, each a small rule the Viewer checks itself:
  *navigate* (arrive in a scene), *find-item* (activate an equipment sign or hotspot —
  by pointer or keyboard), *reach-exit* (arrive at the end of the nearest **confirmed**
  primary route from where the step starts; routes are never generated, and with none
  the step is skipped and says why), *hazard-hunt* (click within a radius of authored
  spots, or turn and press "Inspect" — the keyboard path), *question*.
- **Scoring**: each step has points; a hint halves them, a skip earns none. A module
  passes at its pass mark *and* with its checklist confirmed. Checklist items can be
  ticked by a step or confirmed by the learner.
- **Per-audience**: a module lists audiences; the picker shows the current audience's.
- **The step panel** sits under the top chrome; the route banner moves below it
  (`--evx-training-h`). Dialogs now queue, so a step's question waits for a sign's popup.
- **Certificates are made on the device** (pdf-lib, static Inter, lockup), bilingual
  like posted plans, with no links or scripts. They live in a lazy chunk with the fonts
  inlined, so the core bundle stays at ~199 KB gz (budget 300).
- **One packaged player** (`packages/viewer/player`): a flat folder with stable file
  names and the strict CSP, opening `environment.json` beside it. SCORM wraps it now;
  Phase 10's browser folder and intranet bundle reuse it.
- **SCORM**: one SCO per module (`index.html?module=<id>`), mastery score (1.2) or
  minimum normalized measure (2004) from the pass mark. The bridge only talks to the
  LMS API object (`API` / `API_1484_11`) found in a parent or opener; it reports score,
  completion, success (a pass is never downgraded) and session time, and offers the
  LMS learner name on the certificate. No interactions or suspend data yet.
- **Packages are built in TypeScript** (`packages/packaging`): stored ZIP, every file the
  environment uses (tiles expanded, originals behind tiles/previews left out), listed in
  the manifest. Studio bundles the player at `./player/` and reads project files
  through the media-scoped command.
- **Tested offline** against a strict local LMS (`e2e/scorm-harness`) implementing both
  APIs: wrong call order, unknown or read-only elements, bad vocabulary and time formats
  are recorded as errors and fail the test. Manifests are checked with xmllint.

**Consequences.** XSD files are not bundled (schemaLocation omitted); LMSs we know
accept this, strict validators warn. Plain ZIP limits (65,535 files, 4 GB) and building
in memory suit typical tours; Phase 10 moves large packages to the Rust packager.
SCORM namespace names are allowlisted in the URL guardrail as identifiers.
