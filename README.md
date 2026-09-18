# Proxy Wall Finder

Producer tool for **NEIC-Tour**: drop equirectangular panoramas, run panoramic depth offline, review invisible wall proxies, export paste-ready `proxy` blocks for `tour.ts`.

Sibling to [Pitch & Yaw Finder](https://github.com/Razee4315/pitch-and-yaw-finder).

## Status (honest)

| Layer | State |
|-------|--------|
| Docs | Complete design set in `docs/` |
| Depth sidecar | `scripts/generate-depth.py` + Colab notebook |
| Web app | Working vertical slice: pano sphere, depth→walls, review/nudge, export |
| M1 verification | Checklist in `docs/MODEL-DAP.md` — still needs a real pano + laser on your GPU/Colab |

## DAP license (important)

This repo is **MIT**. **DAP weights are CC BY-NC 4.0** (non-commercial). Fine for demos/internal. For paid client tours: get a commercial license from Insta360, or use a commercially safer metric backend (Depth Anything 3 Apache metric + cubemap tiling; ZoeDepth as weak CPU fallback). Do **not** treat Apple Depth Pro weights as a commercial fallback.

## Quick start (app)

```bash
npm install
npm run dev
```

Drop `.jpg/.png/.webp` panos, then matching `.npz` (+ optional `.json`) from the sidecar.

```bash
npm test
npm run build
```

## Depth sidecar

Local GPU (≥8 GB) or Colab T4:

```bash
python scripts/generate-depth.py --dap-root /path/to/DAP --panos ./panos --out ./depth
```

Colab: open [`colab/generate-depth.ipynb`](colab/generate-depth.ipynb) (uploads leave your machine — use local GPU for sensitive client panos).

## Docs

| Doc | Purpose |
|-----|---------|
| [docs/PROBLEM.md](docs/PROBLEM.md) | Why this exists |
| [docs/PRD.md](docs/PRD.md) | Requirements |
| [docs/TECHNICAL-DESIGN.md](docs/TECHNICAL-DESIGN.md) | Pipeline & coordinates |
| [docs/MODEL-DAP.md](docs/MODEL-DAP.md) | DAP install, license, fallbacks, M1 checks |
| [docs/DATA-FORMAT.md](docs/DATA-FORMAT.md) | Export contract |
| [docs/DESIGN-TOKENS.md](docs/DESIGN-TOKENS.md) | VIYLSA tokens |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Milestones |
| [docs/COLAB-MCP.md](docs/COLAB-MCP.md) | Runbook: driving Colab from ZCode (colab-mcp + bridge) |

## Wall states

Unified enum: `auto | review | accepted | edited | rejected`. Export includes `auto`, `accepted`, and `edited` only.

## License

MIT for this repository — see [LICENSE](LICENSE). Third-party model weights keep their own terms.
