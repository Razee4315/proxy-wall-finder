# Technical Design — Proxy Wall Finder

> Companion docs: [PRD](PRD.md) · [MODEL-DAP](MODEL-DAP.md) ·
> [DATA-FORMAT](DATA-FORMAT.md) · [DESIGN-TOKENS](DESIGN-TOKENS.md)

## 1. Stack & architecture

Deliberately the same as Pitch & Yaw Finder and NEIC-Tour, so engine code and
viewer conventions are copy-portable:

```
React 19 · react-three-fiber 9 · three.js · zustand · Vite · TypeScript
Python 3.12 sidecar (DAP) — offline, fully decoupled
```

```
┌───────────────────────────── browser (producer tool) ─────────────────────┐
│  Viewer (r3f)          Store (zustand)            UI                      │
│  - pano sphere         - scenes[id].walls[]       - scene tabs            │
│  - wall quads overlay  - selection, states        - wall list + editors   │
│  - floor grid, aim     - undo stack (v2)          - export bar            │
│    crosshair                                                              │
└──────────────▲──────────────────────────────────────────┬─────────────────┘
               │ .npz depth (file drop)                   │ export: clipboard
               │                                          │ / JSON download
┌──────────────┴──────────────────────────────────────────▼─────────────────┐
│  Python sidecar (offline, runs once per site)                             │
│  generate-depth.py:  panos/*.jpg ──DAP──▶ <scene>.npz (metric depth)      │
└───────────────────────────────────────────────────────────────────────────┘
```

The browser never runs a model. The sidecar never sees the tour. The only
contract between tool and tour is the export format
([DATA-FORMAT](DATA-FORMAT.md)).

## 2. Coordinate conventions (copied from NEIC-Tour `src/engine/math.ts`)

Everything below is the tour's actual convention — the tool must emit values
in exactly this system so exports paste without conversion:

```ts
// (pitch, yaw) degrees → world direction (unit vector)
phi = (90 - pitch)·π/180          theta = (180 - yaw)·π/180
dir = ( sin(phi)·sin(theta), cos(phi), sin(phi)·cos(theta) )

// inverse (world point → aims)
pitch = asin(y / |p|)·180/π
yaw   = 180 - atan2(x, z)·180/π
```

- Camera sits at the **origin**, pitch 0 = level, +yaw turns right (yaw 90 = +X).
- yaw 0 = the front of the equirect texture (−Z). The sphere renders with
  `scale[-1,1,1]` + `rotation-y = -π/2` (same as the tour) so image yaw
  calibration carries over 1:1.
- Virtual floor: `GROUND_Y = -62` units. `UNIT_PER_METER = 40` (eye height
  1.55 m = 62 units). Wall heights authored in metres, converted by ×40.
- Vertical wall quad = the vertical plane through two floor-seam points
  `B1, B2` (their rays ∩ the floor plane); normal points back at the camera.
  Sanity ranges the tour enforces: seam aims below the horizon, seam length
  ≥ 10 cm, ≤ ~20 m distance, `0 < heightM ≤ 6`.

The viewer reuses the tour's sphere orientation code verbatim (it is already
proven by Pitch & Yaw Finder).

## 3. Depth sidecar contract

`scripts/generate-depth.py` (wraps DAP's `test/infer.py`; see
[MODEL-DAP](MODEL-DAP.md)):

```
input : a folder of equirect JPG/PNG/WEBP (any resolution; DAP handles it)
output: <out>/<scene>.npz  — float16 array [H, W], metres, equirect-aligned
        <out>/<scene>.json — { model, model_commit, weights, resolution,
                               seconds, date, depth2point_convention }
```

- `H×W` may be the model's native output resolution (documented in the JSON);
  the app upsamples coordinates, never assumes image size == depth size.
- Depth is **metric** (metres) — DAP's metric head. If a fallback model gives
  relative/disparity output, the sidecar converts or flags it
  (MODEL-DAP §5); the app must not guess.

## 4. The depth → walls pipeline (core algorithm)

All steps operate per scene, in the app (TypeScript), on the loaded depth
array. Ordered by what makes the review states meaningful.

### 4.1 Depth → point cloud
For depth pixel `(u, v)` with depth `z` (metres), equirect size `W×H`:

```
lon = (u / W) * 2π - π          // -π..π, u=0 → -π
lat = π/2 - (v / H) * π         // +π/2 at row 0 (zenith), -π/2 at row H (nadir)
dir = ( cos(lat)·sin(lon), sin(lat), -cos(lat)·cos(lon) )   // metres
p   = dir · z
```

**Verify this against DAP's own `depth2point.py`** and adopt its exact
convention if it differs — using the model's native mapping removes one class
of sign/axis bugs. This is the first implementation task (M1).

Downsample for speed: extract the pipeline bands on a stride grid (~every 8px
of a 1024-wide depth map is plenty; walls are metres, not millimetres).

### 4.2 Floor plane detection + metric scale calibration
- RANSAC over the point cloud for planes; pick the plane with normal ≈ +Y
  (up) whose plane sits **below** the camera (camera = origin, so plane
  offset `d < 0`) and has the largest inlier support. That is the floor.
- **Scale calibration**: the tour fixes eye height at 1.55 m. Compute the
  raw plane offset `|d_model|` in model metres and rescale the whole cloud by
  `s = 1.55 / |d_model|`. If DAP is truly metric, `s ≈ 1`; treat `s` as both
  a correction and a **quality gate**: `0.6 < s < 1.6`, else flag the scene
  "depth scale unreliable" (walls still shown, everything amber).
- Transform the cloud into **tour units**: origin = camera, floor plane =
  `y = -62`, `×40 u/m`.

Failure mode: domed/open-air panos with no dominant floor → no floor plane →
scene flagged, manual-only mode (crosshair aims still work).

### 4.3 Near-floor wall band + polar profile
- Take points with height above floor in **[0.05 m, 0.60 m]** — below
  furniture lines, above skirting noise. Bin by azimuth (1° bins, 360 bins).
- Per bin: robust distance = median horizontal distance of the bin's points
  that belong to *vertical-ish* structures (normal within 25° of horizontal).
- Result: `d(θ)` — the "distance to wall per direction" radar profile.
- Empty/invalid bins (no points, or distance beyond 20 m) = gaps.

### 4.4 Segment the profile into walls
Two passes, best-of:
1. **Profile segmentation**: walk `d(θ)`; a wall = a maximal run where `d` is
   near-constant (robust MAD test, tolerance ~0.25 m) over ≥ 6° of arc.
2. **2D line RANSAC** on the band's `(x, z)` points: each line with ≥ 8°
   angular extent and ≥ 200 inlier points becomes a wall candidate. This
   catches walls crossing many azimuth bins cleanly (e.g. a wall seen at an
   angle is constant-line-distance, not constant-radial-distance).

Merge both candidate sets (dedupe by overlap). Each accepted line segment
becomes a wall:

- `seam` endpoints = the segment's extreme points projected to the floor
  plane → converted to `(yaw, pitch)` aims via §2 inverse.
- `heightM` = the vertical extent of the plane's points above the floor,
  clamped to [2.0, 3.5]; if the ceiling/wall-top evidence is weak, default
  `2.7` (the tour's default).
- Doorway gaps: a sustained dip/spike in `d(θ)` inside a run splits the wall
  (v1.1; v1 lets the operator split manually).

### 4.5 Confidence & states
Per wall score = weighted `min(inlier_density, length_score, planarity,
floor_support)`. Mapping:

| Score | State (color) | Meaning |
|---|---|---|
| ≥ 0.75 | `auto` (green) | auto-accepted at export unless edited |
| 0.4–0.75 | `review` (amber) | needs eyeballs; still exported if accepted |
| < 0.4 | `rejected` (red) | not exported; shown for awareness |

Plus a **glass heuristic**: surfaces with depth variance high + image edge
density high → force `rejected` + note "glass-suspect" (dot-glass suite
fronts are the known case). Never silently ship a guessed glass wall.

### 4.6 Review loop
Every wall is editable in place: drag seam ends (r3f raycast onto the floor
plane), arrow-key nudge (0.1°/1°), typed values, height field, split/merge
(v1.1), accept/reject. Edits set `state = edited` and pin the wall against
re-extraction.

## 5. Viewer implementation notes

- Reuse Pitch & Yaw Finder's `Viewer.tsx` sphere/camera code (it already
  matches the tour's drag-inertia + zoom feel) — swap the hotspot layer for
  the wall layer.
- Wall quads render as in the tour's `ProxyWallsDev.tsx`: `BufferGeometry`
  from the 4 corners, translucent fill + wireframe edges, `depthTest: false`,
  `renderOrder` above the sphere — copied from the tour so the preview is
  pixel-consistent with the `?dev=1` mode operators already know.
- The floor grid + seam markers make bad seams visible without toggles.
- Performance: quads are re-derived from store walls via `useMemo`; depth
  lives in a non-reactive ref (MultiRes sampled pyramid) — the store never
  holds megabyte arrays.

## 6. Persistence

`localStorage["pwp-session-v1"]`: scenes (ids, wall data incl. rejected),
per-scene depth meta, UI prefs. Images and depth arrays are NOT persisted
(re-load by drop, same as PYF) — the JSON export doubles as a session backup.
Deviation from PYF's session-only rule is documented in the PRD (generation
is expensive; walls are cheap to keep).

## 7. Testing strategy

- **Pipeline unit tests** (node --test + loadTs-style fixture, like the
  tour): synthetic depth arrays for a known box room → expect exact wall set
  (4 walls, correct widths/distance ±5 cm); floor-scale calibration with a
  synthetic `s`; segmenter on profiles with door gaps; confidence mapping;
  format export round-trip.
- **Golden scene**: the Venture Corridor pano + its hand-calibrated 4 walls
  (already shipped in the tour) serve as a regression target: the pipeline
  should re-derive them within tolerance.
- **Export contract tests**: every exported block re-parsed and validated
  against the tour's sanity rules (the DATA-FORMAT §4 checks, mirrored).
- **E2E** (Playwright, later milestones): drop → generate(mock) → review →
  export happy path.

## 8. Explicit non-designs

- No server, no uploads, no telemetry.
- No in-app retraining/fine-tuning of DAP.
- No attempt at furniture/ceiling geometry (the tour can't use it).
- No change to NEIC-Tour code in this repo — ever (the format is the border).
