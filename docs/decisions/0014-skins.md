# 0014 — Skins: structured elements at anchors per breakpoint, safe tokens only

**Context.** Phase 7: a visual skin editor with breakpoints (phone, tablet, desktop,
kiosk), anchors and theme tokens; the Evactis default skin (button-kit toolbar, logo
lockup top-left, website-style eyebrow scene titles, client co-branding). Done when the
default skin lays out correctly at 375, 768, 1440 px and on a 1080p kiosk, and passes
the gradient legibility test.

**Decision.**
- **A skin is data, not markup.** It lists elements of five types (toolbar, logo, title,
  radar, language switch); each has a placement per breakpoint: one of nine anchors,
  insets from the anchor's edges, a size factor, hidden, and for toolbars a direction and
  an ordered button list. Free HTML/CSS skins were rejected: they could fetch (CSP aside,
  `url()`), break the accessibility the e2e tests enforce, and could not be laid out
  reliably by non-developers.
- **Placements cascade**: desktop is the base; tablet and kiosk override desktop; phone
  overrides tablet. An author changes one screen at a time and sees what it inherits.
- **Breakpoint from the Viewer's own width** (phone ≤ 600, tablet ≤ 1100 by default,
  editable), not the window's, so an embedded Viewer behaves the same as a full-screen
  one. **Kiosk is a deployment option**, not a width: a 1080p kiosk in portrait is
  1080 px wide, which would otherwise read as a desktop.
- **Anchors become three flex rows** (top, middle, bottom; each left/centre/right).
  Elements sharing an anchor stack instead of overlapping; the left slot shrinks first,
  the right never. The Viewer publishes `--evx-inset-*` from the laid-out chrome so the
  route banner, video bar and captions keep clear of it.
- **Buttons without room go into the menu** ("More"), so every command stays reachable
  on a phone. Menu and evacuation route cannot be removed from any toolbar. Full screen
  is never shown on a kiosk; VR appears only where it works (Phase 9).
- **Theme tokens are limited** to `--evx-*` names with hex-colour or length values
  (schema), and in Studio to five brand tokens (button face, accent, pressed button,
  icon/text, corner radius). Safety colours (ISO 7010 families) and the published
  insets are not themeable; the Viewer ignores them even if a file sets them. Studio
  refuses a colour that would drop icons/text on buttons below 4.5:1, a pressed-button
  icon below 3:1, or eyebrow labels below 4.5:1, and says why.
- **Co-branding** uses the environment's branding settings: the client's logo (or name)
  then a divider then the Evactis lockup, on the paper plate. Logos import through the
  photo pipeline; the original PNG/WebP is shown so transparency survives (the album copy
  is flattened).
- **The designer previews the real Viewer at exact device sizes** (375×667, 768×1024,
  1440×900, 1920×1080, 1080×1920), scaled to fit; outlines over the chrome select and
  drag elements (arrow keys nudge), and "Try it" passes clicks to the Viewer.
- **Legibility is measured from rendered pixels**: icons against their own face (3:1)
  and text against the worst corner of its backing (4.5:1, or 3:1 for large text) over
  the gradient and three synthetic panoramas, at 1440 and 375 px.

**Consequences.** A skin cannot add arbitrary widgets; new element types (e.g. training
progress in Phase 8) are added to the schema and renderer together. Skins remain plain
JSON in the environment and validate like everything else. Without a skin the Viewer
shows no chrome (Studio's editing previews rely on that); the delivered Viewer uses the
environment's skin or the Evactis default.
