# Proxy Wall Finder — 360 Wall Calibrator

The companion to [Pitch & Yaw Finder](../pitch-and-yaw-finder): that tool
calibrates **hotspots** (yaw/pitch), this one calibrates **walls** — the
invisible proxy geometry the NEIC-Tour ground cursor rides
(Matterport-style wall-riding reticle).

Drop in your equirectangular panoramas, run **DAP** (Insta360's panoramic
depth foundation model) to auto-detect the walls, review them as translucent
quads over the live 360 view, nudge anything the model got wrong, and copy
paste-ready `proxy: { walls: [...] }` blocks in the tour's exact format.

**Model**: [Insta360-Research-Team/DAP](https://github.com/Insta360-Research-Team/DAP)
(CVPR 2026, "Depth Any Panoramas") · weights:
[huggingface.co/Insta360-Research/DAP-weights](https://huggingface.co/Insta360-Research/DAP-weights)

## The one-paragraph pitch

A 360° photo has no geometry, so the tour's ground cursor can't climb walls
until each scene declares invisible wall quads. Hand-calibrating them is
5–10 minutes per scene and doesn't scale to more clients. This tool makes it:
**drop panos → auto-generate walls from depth → review → export.** Human
time target: under 3 minutes per scene, mostly looking.

## Status

📋 **Design phase** — full documentation set in [`docs/`](docs/):

| Doc | What's in it |
|---|---|
| [`docs/PROBLEM.md`](docs/PROBLEM.md) | The problem we're solving and the solution shape |
| [`docs/PRD.md`](docs/PRD.md) | Product requirements, features, goals, non-goals |
| [`docs/TECHNICAL-DESIGN.md`](docs/TECHNICAL-DESIGN.md) | Architecture, depth→walls pipeline, coordinate conventions |
| [`docs/MODEL-DAP.md`](docs/MODEL-DAP.md) | DAP integration: install, weights, inference, fallbacks |
| [`docs/DATA-FORMAT.md`](docs/DATA-FORMAT.md) | The interchange JSON + tour.ts export contracts |
| [`docs/DESIGN-TOKENS.md`](docs/DESIGN-TOKENS.md) | VIYLSA design tokens (mirrors NEIC-Tour `tokens.css`) |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Milestones M0–M6 |

## Workflow (designed, being built)

1. **Drop panoramas** (JPG/PNG/WEBP equirect) — scenes keyed by filename,
   `neic-venture-corridor.jpg` → scene id `neic-venture-corridor`, exactly
   like Pitch & Yaw Finder.
2. **Generate depth** — run **[`colab/generate-depth.ipynb`](colab/generate-depth.ipynb)**
   on free Colab (or `scripts/generate-depth.py` on any GPU/CPU box); the app
   loads the resulting `.npz` depth files.
3. **Review** — walls render as translucent quads over the live 360 view:
   green = auto-accepted, amber = needs a look, red = rejected/glass-suspect.
   The wall list shows per-wall confidence, width, distance.
4. **Adjust** — click a wall, nudge its seam ends with arrow keys (0.1°,
   Shift = 1°) or type values; split a wall at a doorway; set height.
5. **Export** — copy a scene's `proxy: { walls: [...] }` block or all-scenes
   JSON; paste into `src/data/tour.ts`. Nothing else in the tour changes.

## Why a separate app (not a NEIC-Tour feature)

Same reason Pitch & Yaw Finder exists: calibration is a producer tool, the
tour is a consumer product. Keeping them separate keeps the tour's bundle
lean and lets the tool move fast (break its UI freely) while the tour stays
stable. The contract between them is one thing: the exported data format.

## Tech

React 19 · react-three-fiber 9 · three.js · zustand · Vite — deliberately
the same stack, coordinate conventions and design tokens as NEIC-Tour and
Pitch & Yaw Finder. Depth inference is a Python sidecar (DAP), fully
decoupled from the web app.

## License

MIT — see [LICENSE](LICENSE).

## Contact

- **GitHub**: [Razee4315](https://github.com/Razee4315)
- **LinkedIn**: [saqlainrazee](https://www.linkedin.com/in/saqlainrazee)
- **Email**: [saqlainrazee@gmail.com](mailto:saqlainrazee@gmail.com)
