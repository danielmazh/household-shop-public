# 005 - Design system (v2)

Source of truth: the "v2 - ..." frames in `design/household-shop.pen` and their exports in `design/screens-v2/`. CSS custom properties in `src/ui/styles.css` mirror the "v2 - Tokens" frame. No hard-coded value where a token exists. v1 frames stay in the file as history only.

## Tokens
- Color: canvas #F1F2EE, surface #FFF, tile #F1F2EE, ink #17201B, muted #5F6863, control #858E89 (borders and tick ring), line #E6E8E3 (decoration only), brand #0E4A33, brand-mid #1F7A4D, brand-soft #E3EFE6, on-brand #FFF, on-brand-muted #B9D3C4, lime #C5F06A (fill only, never text on white), on-lime #14301F, warn #8A4B00, warn-soft #FFF0D4, error #B3261E, error-soft #FDE8E6, ink-bar #2B2F2D.
- Type (Rubik, self-hosted woff2, `font-display: swap`, system fallback): caption 13/500, body 15/400, item 17/500, title 20/600, headline 30/600, stepper value 18/600. Line height 1.3 for titles, 1.5 for body.
- Radius: tile 14, card 24, sheet 32, pill 999. Spacing 4 px base: 4, 8, 12, 16, 20, 24, 32. Screen side padding 16, card padding 20.
- Shadow: only `float` (0 8 24 ink 12%) on the tab bar.
- Touch: min 44, primary 56. Tick circle 32 in a 44 hit area.

## Layout rules (every screen, every size)
- One centered content column, max width 480 px on phones and tablets; on 1024 px and up the catalog and stock grid may widen to 720 px, still centered. Header, content, sticky bar and tab bar share the same column edges.
- Equal side padding on both sides. Equal gaps inside a group; larger gap between groups (8 inside, 16 to 24 between).
- Control heights from one set only: 44 (chips, icon buttons, stepper buttons, small pills), 56 (primary and secondary buttons, inputs, search). All items in one row share a height and are vertically centered.
- Grids: equal columns, equal card heights per row, content centered in cards.
- Text: `text-wrap: balance` for headings and banners, `pretty` for body; no single orphan word on a last line in banners or buttons. Long names clamp to 2 lines with ellipsis; amounts never wrap.
- Numbers use tabular figures; prices and counts align on the end side.
- Must stay organized at 320, 360, 390, 430, 768, 1024 and 1280 px wide, in landscape, with 200% text zoom, with 0, 1 and 40 items, and with a 30-character name. No horizontal scroll, no overlap, no clipped text.
- WCAG AA contrast, visible `:focus-visible` ring, RTL logical properties only.
