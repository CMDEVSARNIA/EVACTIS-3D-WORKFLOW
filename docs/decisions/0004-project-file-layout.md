# 0004 — Project layout and the `.evxproj` file association

**Status.** Proposed — needs Evactis confirmation (hard to change once projects exist).

**Context.** The brief says projects are "a `.evxproj` directory with the environment
JSON and media" *and* that double-clicking `.evxproj` opens Studio. Windows Explorer
always opens a folder as a folder; file associations by extension apply to files only.

**Decision.** A project is an ordinary folder:

```
Riverside Hospital/
  Riverside Hospital.evxproj   ← environment JSON manifest (double-click opens Studio)
  media/                       ← panoramas, tiles, video, models, documents
  snapshots/                   ← local versions (Phase 4)
```

Studio opens the folder that contains the `.evxproj` (`evx_core::project::locate`),
and also accepts the folder itself. A folder literally named `X.evxproj` still works if
it contains a manifest, so either reading of the brief is supported.

**Consequences.** Projects are plain folders that copy, zip and back up normally; the
association, branded icon and "EVACTIS 3DWORKFLOW Project" type name work in Explorer.
