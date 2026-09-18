# Roadmap — Proxy Wall Finder

> Milestones map to the PRD features. Each milestone ends shippable.
> Effort estimates assume one developer; the weak local machine is why depth
> steps are sidecar/remote-friendly from day one.

## M0 — Scaffold (half day) ✅ app boots with sphere viewer + drop intake
- Vite + React 19 + r3f + zustand + TS scaffold; tokens.css copied from
  NEIC-Tour; dark shell (top bar / viewer / sidebar / export bar layout).
- Acceptance: app boots, panos render in the tour-convention sphere (port
  PYF's `Viewer.tsx`).

## M1 — DAP sidecar spike (1–1.5 days) ⚠️ blocking checks live here
- `scripts/generate-depth.py` wrapping DAP folder inference (MODEL-DAP §3).
- Verify the four MODEL-DAP §6 items: license, weights download, metric
  claim vs. a laser-measured distance, glass behavior on the Venture
  Corridor pano.
- Diff our equirect direction formula against DAP's `depth2point.py`; write
  the one-image regression check.
- Fallback decision point: if DAP is unusable, wire Depth Anything 3 tiling
  into the same contract.
- Acceptance: 9 NEIC panos → 9 `.npz` + provenance JSONs.

## M2 — Depth → walls pipeline (2 days) ✅ TS pipeline + synthetic tests (golden corridor still open)
- Point cloud, floor RANSAC, scale calibration, polar profile, segmentation,
  confidence + glass heuristic (TECHNICAL-DESIGN §4).
- Unit tests with synthetic box-room depth; golden test vs. the corridor's
  hand-calibrated 4 walls.
- Acceptance: corridor walls re-derived within ±20 cm / ±5°.

## M3 — Review viewer (2 days) ✅ quads + sidebar + state colors
- Wall quads overlay (state colors, wireframe), floor grid, crosshair, wall
  list synced with hover/selection, confidence chips, derived readouts.
- Acceptance: PRD G4 — no silent walls; every wall shows state + numbers.

## M4 — Manual adjustment (1.5 days) ✅ seam nudge + height + accept/reject
- Selection, seam-end nudging (keys + typed), height edit, accept/reject,
  manual add via crosshair aims, delete; invalid-wall live badges.
- Acceptance: a rejected glass wall can be hand-fixed in < 2 min.

## M5 — Export + persistence (1 day) ✅ clipboard + JSON + localStorage
- Copy proxy block per scene / copy all JSON / download / import
  (DATA-FORMAT); localStorage session; export-side validation badges.
- Acceptance: exported corridor block pastes into `tour.ts` and passes the
  tour's `proxy-surfaces.test.mjs` shipped-data audit unmodified.

## M6 — Calibration run + tuning (half day)
- Run the whole 9-scene NEIC site end-to-end, timed; tune thresholds
  (§4.5 mapping) against PRD G1/G2; record results in the README.

## Later (out of v1)
- Doorway auto-split (§4.4 v1.1), undo stack, batch export script writing a
  tour.ts PR directly, multi-site workspace, dollhouse seeding from the same
  depth (the natural v2 payoff).
