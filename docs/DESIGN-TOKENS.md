# Design Tokens — Proxy Wall Finder

> Source of truth: NEIC-Tour `src/styles/tokens.css` (VIYLSA brand system,
> mirrors the landing page's `colors_and_type.css`). Pitch & Yaw Finder
> already consumes this same set — this tool is the third consumer, so the
> tokens below are **copied, never re-invented**. Sync by copy, one line per
> token, and note the source at the top of `styles.css`.

## 1. Brand

| Token | Value | Use |
|---|---|---|
| `--crimson` | `#7F141A` | primary actions, selected states |
| `--crimson-deep` | `#5E0D14` | pressed/hover depth |
| `--crimson-darker` | `#3F080E` | gradients |
| `--crimson-soft` | `#FAE6E8` | subtle crimson tint surfaces |
| `--crimson-bright` | `#DC143C` | high-emphasis accents (rejected walls) |
| `--crimson-glow` | `rgba(127,20,26,0.35)` | focus/glow rings |

## 2. Ink (neutral text ramp)

`--ink-1000 #0A0A0B` · `--ink-900 #141416` · `--ink-800 #1E1E22` ·
`--ink-700 #2A2A2F` · `--ink-500 #4B4B52` · `--ink-400 #6B6B73` ·
`--ink-300 #8C8C94`

## 3. Light canvas

`--canvas #FAFAF7` · `--canvas-paper #FFFFFF` · `--canvas-haze #F2F1ED` ·
`--canvas-mist #E6E5E0`

This tool runs on the **dark immersive surfaces** (like the tour and PYF):
`--bg: #0b0b0d`, panels on `--glass-strong`.

## 4. Dark immersive surfaces (on-photo chrome)

| Token | Value | Use |
|---|---|---|
| `--glass` | `rgba(12,12,14,0.58)` | floating chrome |
| `--glass-photo` | `rgba(12,12,14,0.72)` | on-photo panels (restores AA over bright panos) |
| `--glass-strong` | `rgba(10,10,12,0.78)` | modals, sidebars |
| `--glass-border` | `rgba(255,255,255,0.14)` | hairlines |
| `--glass-border-strong` | `rgba(255,255,255,0.22)` | hovered/active borders |
| `--on-dark` | `#F7F6F2` | primary text |
| `--on-dark-muted` | `rgba(247,246,242,0.64)` | secondary text |
| `--on-dark-subtle` | `rgba(247,246,242,0.58)` | captions (pair with text-shadow on-photo) |

PYF's app-level additions (also carried): `--bg #0b0b0d`,
`--panel rgba(16,16,19,0.86)`, `--panel-border rgba(255,255,255,0.09)`,
`--ink #e9e7e2`, `--ink-dim #9b988f`.

## 5. Type

| Token | Value |
|---|---|
| `--font-display` / `--font-body` | `'Geist Variable', ui-sans-serif, system-ui, sans-serif` |
| `--font-mono` | `'Geist Mono Variable', ui-monospace, Menlo, monospace` (all numeric readouts: yaw/pitch, metres, confidence) |
| `--font-logo` | `'Playfair Display', Georgia, serif` (wordmark only) |

## 6. Radii / shadows / motion / blur

- Radii: `--radius-xs 6px` · `--radius-sm 8px` · `--radius-md 12px` ·
  `--radius-lg 18px` · `--radius-xl 26px` · `--radius-2xl 22px` ·
  `--radius-pill 999px`
- Shadows: `--shadow-md 0 8px 24px rgba(0,0,0,.35)` ·
  `--shadow-lg 0 24px 64px -12px rgba(0,0,0,.55)` ·
  `--shadow-crimson 0 10px 32px -8px rgba(127,20,26,.6)`
- Motion: `--ease-out cubic-bezier(0.22,1,0.36,1)` · `--dur-fast 150ms` ·
  `--dur-base 240ms` · `--dur-slow 450ms`
- Blur: `--blur saturate(1.4) blur(18px)` · `--blur-sm blur(8px)`

## 7. Tool-specific semantic tokens (NEW — defined here first)

These exist only in this tool (wall states echo the tour's `?dev=1` preview
palette — `#3aa0ff` is literally the quad color the tour's dev preview uses):

| Token | Value | Use |
|---|---|---|
| `--wall-proposed` | `#3AA0FF` | auto-extracted wall quads + wireframe (matches tour `?dev=1` preview) |
| `--wall-accepted` | `#4ADE80` | accepted / auto walls (green) |
| `--wall-review` | `#F5A623` | needs-review walls (amber) |
| `--wall-rejected` | `#EF4444` | rejected walls (red, shown at low opacity) |
| `--wall-selected` | `#DC143C` (`--crimson-bright`) | selected wall outline |
| `--conf-high` | `#4ADE80` | confidence ≥ 0.75 |
| `--conf-mid` | `#F5A623` | 0.4–0.75 |
| `--conf-low` | `#EF4444` | < 0.4 |
| `--aim-cross` | `rgba(150,255,150,0.9)` | viewport-center aim crosshair (matches tour DevHud green) |
| `--floor-grid` | `rgba(150,255,150,0.18)` | floor plane grid lines |

## 8. Layout constants (tool-specific)

| Token | Value | Use |
|---|---|---|
| `--topbar-h` | `56px` | top bar height (PYF parity) |
| `--sidebar-w` | `320px` | right wall-list panel |
| `--exportbar-h` | `52px` | bottom export bar |

## 9. Accessibility notes carried from the tour

- Muted text on `--glass` surfaces fails AA over bright panoramas — on-photo
  chrome uses `--glass-photo` and pairs muted labels with the tour's
  text-shadow treatment.
- All state colors above are paired with **text labels + icons**, never
  color alone (color-blind safe: green/amber/red states also differ by chip
  label and shape).
- Numeric readouts always in `--font-mono` for column alignment.
