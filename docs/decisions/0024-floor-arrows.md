# 0024 — Links as floor arrows, followed by a walk-through

**Context.** Links were kit buttons ("next") floating near a door, and the transition
between scenes scaled the old picture away. During release-candidate testing (2026-11)
Evactis asked for the way tour tools such as 3DVista move between scenes: arrows on the
floor with a highlight running along them, and a transition that feels like walking on.

**Decision.**
- **Floor arrow** is a hotspot appearance (`{ kind: 'floor-arrow' }`, additive to schema
  v1). The hotspot's direction names a spot on the floor (1.6 m below the eye, as for
  route chevrons); three chevrons are laid flat there, pointing away from the reader,
  and projected by the renderer in true perspective (an SVG over the panorama, one
  focusable, labelled button). A highlight runs from the nearest chevron to the farthest
  (CSS, still under reduced motion). Far arrows are drawn larger so they stay legible
  and easy to hit.
- **Colours:** white with a navy edge, never safety green: an arrow to the next room
  must not be mistaken for the way out (evacuation chevrons stay green, ISO 7010).
- **Walk-through** (`transition.kind: 'walk'`, now the default for links made in
  Studio): the view turns to the link (up to 450 ms, scaled to the turn), the old view
  pushes forward from the centre and fades, and the next scene opens at 72 % of its
  field of view, facing the way on, and widens to it. Reduced motion keeps a 200 ms fade.
- **Studio:** new links are floor arrows with the walk-through; any link can be an arrow
  button instead; one undoable action converts every older link (areas are left alone).
  The demo facility's door links are floor arrows aimed a metre in front of each door.
- **VR** shows a floor-arrow link as the kit's "next" button where it points.

**Consequences.** Authors place a link on the floor in front of the door rather than on
the door. Links in GLB/splat scenes and on video scenes stay buttons in the demo (their
floor is not the panorama's). Visual baselines of the demo were regenerated.
