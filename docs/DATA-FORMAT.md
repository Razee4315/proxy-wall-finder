# Data Format — the contract between tool and tour

> The border is the data. The tour's engine is frozen; this document defines
> the only thing that crosses it. Version: 1.

## 1. Units & conventions (must-match, copied from NEIC-Tour)

| Thing | Value |
|---|---|
| Angles | degrees; `yaw` ∈ (-180, 180], `pitch` ∈ [-90, 90] |
| Direction mapping | `dir = (sinφ·sinθ, cosφ, sinφ·cosθ)`, `φ = 90−pitch`, `θ = 180−yaw` |
| Camera | origin (0,0,0); yaw 0 = equirect front (−Z); +yaw = right |
| Floor plane | `y = GROUND_Y = −62` units (camera 62 units above the floor) |
| Scale | `UNIT_PER_METER = 40` (eye height 1.55 m = 62 units) |
| Wall heights | authored in **metres**; tour converts ×40 |
| Vertical walls | only kind the tour supports; normal faces the camera |

## 2. Interchange JSON (the tool's session/save format)

Versioned, complete (includes rejected walls + provenance), machine-written,
machine-read. This is what "Copy all JSON"/"Download" produces and what
Import accepts.

```jsonc
{
  "version": 1,
  "savedAt": "2026-09-18T14:30:00Z",
  "scenes": {
    "neic-venture-corridor": {
      "image": "neic-venture-corridor.jpg",
      "depth": {                       // provenance from the sidecar
        "model": "DAP",
        "modelCommit": "a1b2c3d",
        "weights": "model.pth",
        "resolution": [1024, 512],
        "metric": true,
        "scaleCorrection": 0.98,       // floor-anchor fit, 1.0 = perfect
        "date": "2026-09-18T14:02:11Z"
      },
      "walls": [
        {
          "id": "w1",
          "seam": [
            { "yaw": 42.8,  "pitch": -31.2 },
            { "yaw": 89.6,  "pitch": -49.8 }
          ],
          "heightM": 2.7,
          "state": "accepted",          // auto | review | accepted | edited | rejected
          "confidence": 0.86,
          "source": "depth",            // depth | manual
          "notes": ""                   // e.g. "glass-suspect"
        }
      ]
    }
  }
}
```

Rules:
- `state: "rejected"` walls are kept in JSON but never exported to the tour.
- Rounding: 2 decimals on export paths (angles, metres); JSON keeps full
  precision internally.
- Scene keys = filenames without extension (PYF convention).

## 3. Tour export (the paste-ready format)

Per scene, the tool emits exactly this shape (matches `src/data/tour.ts`'s
`ProxyRoom` on the `proxy-geometry` branch):

```ts
// Proxy Wall Finder — neic-venture-corridor (4 walls, DAP 2026-09-18)
proxy: {
  walls: [
    { seam: [{ yaw: 42.8, pitch: -31.2 }, { yaw: 89.6, pitch: -49.8 }] },
    { seam: [{ yaw: 140.6, pitch: -21.4 }, { yaw: 157.3, pitch: -22.4 }], heightM: 2.7 },
    // ...
  ],
},
```

- Only `accepted` / `edited` walls, in wall order.
- `heightM` omitted when it equals the tour default (2.7).
- Header comment names the scene, wall count and generation date.
- "Copy all" emits one block per scene separated by scene-id comments, same
  grammar as Pitch & Yaw Finder's links-block export.

## 4. Validation rules (mirror of the tour's sanity rails)

A wall must satisfy all of these to be exportable; the tool enforces them
live so an invalid wall can never be copied:

1. Both seam aims have `pitch < 0` (the floor seam is below the horizon).
2. Recomputed seam points (ray ∩ floor plane) are each ≤ 20 m (800 u) from
   the camera.
3. Seam length ≥ 10 cm (4 u).
4. `0 < heightM ≤ 6`.
5. Wall plane normal faces the camera (derived; always true by construction).

The tour additionally skips any block failing these — the tool showing them
as invalid is a courtesy, not a safety net for the tour.

## 5. Versioning

- `version` bumps on any breaking shape change; the tool imports v1 forever,
  and migrates or refuses older files with a clear message.
- The tour side is pinned by its unit tests
  (`proxy-surfaces.test.mjs` shipped-data audit): any format drift fails
  there first.
