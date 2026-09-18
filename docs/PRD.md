# PRD — Proxy Wall Finder

> Status: draft v1 (2026-09-18) · Owner: Razee4315 · Companion docs:
> [PROBLEM](PROBLEM.md) · [TECHNICAL-DESIGN](TECHNICAL-DESIGN.md) ·
> [DATA-FORMAT](DATA-FORMAT.md)

## 1. Product summary

A standalone desktop web app that turns Insta360 equirectangular panoramas
into **proxy wall data** for NEIC-Tour's wall-riding ground cursor: drop
panoramas, auto-detect walls via the DAP panoramic depth model, review them
as translucent quads over the live 360 view, adjust by hand where needed,
export paste-ready `tour.ts` blocks.

**One line**: *Pitch & Yaw Finder for walls — generate, review, export.*

## 2. Users

| User | Need | Frequency |
|---|---|---|
| Saqlain (builder/operator) | calibrate client tours fast, no per-wall aiming | every new/retaken site |
| Future operators | same, with zero knowledge of the tour's internals | onboarding |
| NEIC-Tour engine (consumer) | a frozen, valid `proxy` data format | every deploy |

There is no visitor-facing user; this is a producer tool. The tour's
visitors are affected only through better-corrected wall data.

## 3. Goals

| # | Goal | Metric |
|---|---|---|
| G1 | Human calibration time per scene **< 3 min** (review-dominant) | timed run on 9 NEIC indoor scenes |
| G2 | **≥ 80% of walls auto-accepted** without edits on typical indoor panos | share of walls untouched at export |
| G3 | Export pastes into `tour.ts` with **zero hand-editing** and passes the tour's data-audit tests | paste test per scene |
| G4 | Wrong walls are **never silent**: every wall shows state + confidence; suspicious surfaces (glass) are flagged | review pass finds 100% of intentionally-broken walls |
| G5 | Same look-and-feel and interaction grammar as Pitch & Yaw Finder / NEIC-Tour | token + component parity checklist |

## 4. Non-goals (v1)

- Furniture, ceilings, floors-as-geometry, sloped/curved walls — the tour
  only consumes vertical wall quads on the known floor plane.
- In-browser ML inference — depth is generated offline by a Python sidecar.
- Changing NEIC-Tour runtime code — the tour is a frozen consumer of the
  export format.
- Multi-floor / multi-building scene graphs — one folder of panos = one site.
- Mobile support — desktop-only tool (keyboard nudging required).

## 5. Feature requirements

### F1 — Scene intake
- Drag-and-drop / file picker for equirect JPG/PNG/WEBP; multi-file.
- Scene id = filename without extension (PYF convention:
  `neic-venture-corridor.jpg` → `neic-venture-corridor`).
- Scene tabs across the top; add/remove scenes; duplicates rejected by name.
- Panoramas stay in-session (ObjectURLs); nothing uploads anywhere.

### F2 — Depth generation (sidecar bridge)
- "Generate depth" flow: the app shows the exact sidecar command per OS
  (`scripts/generate-depth.py --panos <folder> --out <folder>`), or accepts a
  pre-generated `<scene>.npz` dropped alongside the pano.
- Depth file contract: `<scene>.npz` containing float16 `depth` (H×W,
  metres) + JSON meta (model, resolution, DAP commit); see
  [MODEL-DAP](MODEL-DAP.md).
- App validates depth resolution against the pano and shows generation meta
  (model, date) per scene. Missing depth = walls disabled, manual aims still
  available.

### F3 — Wall extraction (auto)
- From depth: floor-plane fit → eye-height scale calibration → near-floor
  wall-distance profile → straight-run segmentation → wall list. Full
  algorithm in [TECHNICAL-DESIGN §4](TECHNICAL-DESIGN.md).
- Each wall carries: `seam` ends, `heightM`, `confidence` (0–1),
  `state: auto | accepted | edited | rejected`, plus derived width/distance
  in metres.
- Glass/reflective suspects: walls whose extraction evidence is weak
  (low inlier support or depth variance) start as `rejected` + flagged,
  never silently accepted.

### F4 — 3D review viewer
- The tour's exact viewer conventions (same sphere mapping, drag/inertia,
  scroll zoom) so what you see is what the tour renders.
- Overlay layers, toggleable: wall quads (state-colored, translucent +
  wireframe edges), floor plane grid, seam endpoints, wall labels
  (#, width m, distance m), the aim crosshair at viewport center.
- Hover highlights the wall under the cursor and syncs the sidebar list;
  click selects.

### F5 — Manual adjustment
- Per wall: nudge each seam end with arrow keys (0.1°, Shift = 1°) or typed
  `yaw`/`pitch`; edit `heightM`; accept / reject; duplicate & split at a
  chosen yaw (doorway gaps); delete.
- Add wall manually (crosshair aims — the tour's existing `?dev=1` workflow
  as a fallback for anything the model missed).
- Live derived readouts: wall width (m), distance (m), height (m); sanity
  badges when values leave indoor ranges (the tour skips out-of-range walls).

### F6 — Export
- Per-scene **Copy `proxy` block**: paste-ready `proxy: { walls: [...] }`
  with 2-decimal rounding, only `accepted`/`edited` walls, tour-exact key
  order and comment header (like PYF's link-block export).
- **Copy all JSON** / download JSON (full interchange format incl. rejected
  walls + confidence, for re-editing later).
- **Import JSON** restores a session's data (depth files stay on disk).

### F7 — Persistence & privacy
- Session state (walls, states, notes) persists in `localStorage` keyed by
  scene id — deliberate deviation from PYF's session-only rule, because
  depth generation is expensive; documented in the README.
- Images never leave the machine; the only network call in the whole tool is
  *none* (depth runs in the sidecar).

## 6. UX flow (happy path)

1. Drop 10 panos → scene tabs appear.
2. Run sidecar command (copy from the app) → drop/refresh → depth loaded.
3. Walls appear pre-extracted, state-colored, sorted by confidence ascending
   ("worst first" review order).
4. Walk each scene: spin once, eyeball quads, fix the one glass wall, accept.
5. Per scene: **Copy proxy block** → paste into `tour.ts` → commit.

## 7. Success measurement

- Timed calibration of the 9 NEIC indoor scenes vs. the hand baseline
  (45 min → target < 25 min total).
- Auto-accept rate per scene; wall count vs. tour's hand-calibrated ground
  truth (Venture Corridor's 4 walls).
- Paste-test: exported blocks run through the tour's
  `proxy-surfaces.test.mjs` shipped-data audit with zero failures.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| DAP weights/license unavailable | fallback chain: Depth Anything 3 → Depth Pro (same sidecar contract, see MODEL-DAP §5) |
| Glass walls misread by depth | flagged-reject state + manual crosshair fallback (F5) |
| Weak local GPU | sidecar decouples inference; Colab/CI recipes documented; CPU batch viable overnight |
| Tour format drift | DATA-FORMAT is versioned; the tour's unit tests are the contract check |
| Scope creep into dollhouse/geometry mesh | Non-goals §4; the quad format is the frozen boundary |
