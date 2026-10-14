# Brand usage — EVACTIS 3DWORKFLOW

Source of truth: the images in `/brand`. Everything in `packages/brand` is derived from
them; regenerate with `pnpm brand:generate`. Visual reference: the brand sheet
(`pnpm --filter @evactis-3dworkflow/brand sheet:dev`), which recreates
`brand/evactis-button-kit.png` from the real components.

## Logo and lockups

| File | Use |
| --- | --- |
| `logo-mark.svg` | App icons, favicons, small spaces |
| `logo-lockup.svg` | EVACTIS logo (mark as the "E" + "VACTIS"), light backgrounds |
| `logo-lockup-plate.svg` | Same on a paper plate, for dark backgrounds |
| `product-lockup.svg` | EVACTIS 3DWORKFLOW, light backgrounds (Studio header, About) |
| `product-lockup-plate.svg` | Dark backgrounds (Viewer top-left, splash, dark About) |
| `product-lockup-stacked.svg` | Tight spaces (installer header and sidebar) |

Never recolour, stretch, rotate, outline or redraw the mark; never place the navy mark
directly on a dark or busy background — use a plate variant. Clear space: at least the
height of the arrow head on every side.

## Colours (sampled from the reference images)

| Token | Hex | Sampled from |
| --- | --- | --- |
| `--evx-navy` | `#0A2F5B` | Logo E, wordmark, button fill (all three sources agree) |
| `--evx-green` | `#71B043` | Logo arrow; kit hover outline/bar `#71B143` |
| `--evx-green-strong` | `#5D9518` | Kit active fill + default bar, website CTA, wordmark "I", top rule |
| `--evx-ink` | `#0A0A0A` | Website dark background |
| `--evx-surface-dark` | `#101809` | Website green radial glow |
| `--evx-paper` | `#FAFAFA` | Website header bar |
| `--evx-text-muted` | `#CCCCCC` | Website lead paragraph |
| `--evx-text-subtle` | `#A3A3A3` | Website bullet copy |
| `--evx-safe-green` | `#00843D` | Kit safe-condition signs |
| `--evx-fire-red` | `#C8102E` | Kit fire-equipment signs |
| `--evx-warning-yellow` / `-border` | `#F2C230` / `#1A1A1A` | Kit warning triangle |
| `--evx-frame-grey` | `#C8C7C4` | Marker ring, style-B frame |

The brief's starting values (`#0E2D5B`, `#72B043`, `#5E991F`, `#F4F4F4`, `#111A10`,
`#F2C12E`) were close; the sampled values above replace them.

## Typography

Inter (variable, bundled — `packages/brand/fonts`, OFL). Headings: weight 800, tight
tracking, all caps. Eyebrows: 13 px, weight 600, 0.16em tracking, green, preceded by a
short green-strong rule. Body: weight 400, muted grey on dark. The wordmark and
"3DWORKFLOW" are outlines (Poppins ExtraBold), never live text.

## Button kit

80 px at 1x, 18 % radius, icon ≈ 55 % of the face, soft drop shadow, indicator bar.
States: default (navy, short green-strong bar) · hover/focus (navy, green outline,
long green bar) · active (green-strong, short navy bar, white accent). Minimum size
44 px. Components: `createButton`, `createMarker`, `createSign` (framework-free).
