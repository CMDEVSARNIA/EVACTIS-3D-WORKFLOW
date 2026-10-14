# 0005 — Logo mark, wordmark and product lockup

**Status.** Logo construction (mark as the "E" + "VACTIS") confirmed by Evactis on
2026-10-14. Product lockup artwork still awaiting visual sign-off.

**Mark.** Traced by measuring edges on the alpha channel of
`brand/evactis-logo-mark.png` (sub-pixel crossings along scan lines), giving 4 paths:
the E with transom and upper door post, the sill with lower post, the knob, and the
arrow. Overlap with the source mask: IoU 0.994 (test threshold 0.99). Colours from the
same sources: navy `#0A2F5B`, arrow `#71B043`.

**Wordmark.** No vector wordmark was supplied. The website capture shows the mark
standing in for the "E", followed by "VACTIS" with a green-strong (`#5D9518`) "I".
Candidate OFL fonts were scored on letter-width ratios against the capture; Poppins
ExtraBold matched best (Montserrat, Inter, Archivo, Figtree and others were rejected).
Glyphs are converted to outlines and tracked so "VACTIS" spans exactly the measured
width, so no font is needed to render a logo.

**Product lockup.** Logo + "3DWORKFLOW" in the same outlines, navy, "3D" in
green-strong to echo the "I". Variants: horizontal (light backgrounds), horizontal on
a paper plate (dark backgrounds — the mark is never recoloured), stacked (installer
header/sidebar, tight spaces).

**Consequences.** If Evactis supplies the original vector logo, drop it into
`packages/brand/src/logo.ts` (mark) / `scripts/generate.ts` (wordmark) and regenerate;
everything downstream (icons, installers, sheet) follows.
