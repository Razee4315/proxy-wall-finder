# The Problem — and how Proxy Wall Finder solves it

> Companion docs: [PRD](PRD.md) · [TECHNICAL-DESIGN](TECHNICAL-DESIGN.md) ·
> [MODEL-DAP](MODEL-DAP.md) · [DATA-FORMAT](DATA-FORMAT.md)

## 1. Context: the tour and its wall-riding cursor

VIYLSA builds 360° virtual tours (current product: **NEIC-Tour**, a university
incubation-centre tour) from **Insta360 X5 equirectangular panoramas** — one
photo per scene position, no LiDAR, no depth hardware, no mesh.

The tour's signature navigation is a **Matterport-style pointer reticle**: a
small ring follows the mouse and lies flat on the floor; near a walk target it
snaps to a floor ring and a click walks there. Matterport's reticle does one
thing ours didn't: **it climbs walls**. When the pointer leaves the floor, the
ring rides up the wall surface, staying glued to the room.

A 360° photo contains **no geometry**. Raycast the panorama sphere and the
cursor follows the sphere, not the room. So the tour uses **proxy geometry**:
per scene, a handful of invisible wall quads declared as plain data. The
cursor raycasts against {floor plane, wall quads}, takes the nearest hit, and
orients the ring to the surface normal. Walls are cosmetic by design — clicks
on walls never navigate, so the "bright ring = walking is possible" affordance
stays honest. The full engine study lives in NEIC-Tour's
`docs/PROXY-GEOMETRY-RESEARCH.md`; the runtime shipped on the
`proxy-geometry` branch and is verified working (unit tests + live tour).

## 2. The actual problem: nobody can scale hand-authored geometry

The runtime cost of a wall quad is zero. The **authoring** cost is the
bottleneck:

- Today a wall is calibrated by hand: open the tour's `?dev=1` mode, aim a
  crosshair at the two visible ends of the wall's floor seam in the photo,
  copy `(yaw, pitch)`, paste into `src/data/tour.ts`, check the fit against a
  translucent quad overlay.
- **5–10 minutes per scene** for a practiced operator, and it is
  error-prone in a silent way — a mis-aimed seam produces a slightly crooked
  invisible wall, not an error message.
- Scale kills it: NEIC-Tour has 10 scenes (9 indoor) today, but the product
  is campus/office tours for clients. A 30-scene client site would be 3+ hours
  of mind-numbing aiming. And every **panorama retake** invalidates the
  calibration (the tour's own pipeline docs warn to recalibrate on replacement).

## 3. Why this is solvable from a single photo

The room shell is the most predictable thing in an indoor photo:

1. **Depth from a panorama is a solved problem.** Insta360's research team
   published **DAP — "Depth Any Panoramas"** (CVPR 2026), a foundation model
   trained for equirectangular metric depth — our exact input format, from our
   exact camera vendor. Generic monocular depth (Depth Anything 3, Depth Pro)
   is a fallback.
2. **Walls are the simplest structures in that depth.** A wall is a vertical
   plane at a constant distance from the camera. Sample the depth band just
   above the floor, read the "distance per direction" profile, and straight
   constant-distance runs **are** the walls — no general 3D understanding
   needed.
3. **Absolute scale comes free.** A single photo can't pin metric scale, but
   the tour already fixes it: the virtual floor sits exactly one eye height
   (1.55 m ⇒ 62 engine units, 40 units/m) below the camera. Fit the model's
   depth to the detected floor plane and every wall distance lands in real
   metres, calibrated with zero extra hardware.
4. **The output format already exists and is frozen.** The tour eats
   `seam: [{yaw, pitch}, {yaw, pitch}], heightM` blocks (validated by unit
   tests). The tool's job is to *emit that format* — the engine never changes.

## 4. The solution shape

A standalone calibration app — sibling to our Pitch & Yaw Finder — with a
**generate → review → export** loop:

```
drop panos ──▶ DAP depth (sidecar, offline) ──▶ wall extraction
                                                    │
                                    translucent wall quads
                                    over the live 360 view
                                                    ▼
                              review: accept / nudge / split / reject
                                                    ▼
                        export paste-ready `proxy` blocks for tour.ts
```

- **Generate**: a Python sidecar runs DAP over a folder of panoramas and
  writes depth files; the web tool reads them (decoupled — the browser never
  runs a model).
- **Review**: walls render as colored quads over the photo (green =
  auto-accepted, amber = check me, red = rejected/suspect). Confidence,
  width, distance per wall. The operator's job is *looking*, not aiming.
- **Adjust**: click a wall, nudge its seam ends with arrow keys or typed
  values, split at doorways, set height — the exact interact-the-viewer
  workflow Pitch & Yaw Finder proved.
- **Export**: paste-ready `proxy: { walls: [...] }` per scene, plus
  all-scenes JSON. Copy, paste into `tour.ts`, done.

## 5. What "done" means

- A new 10-scene client site calibrates in **under 30 minutes of human time**,
  most of it reviewing.
- **≥ 80% of walls auto-accepted without edits** (glass walls are the
  expected exception — they get a 2-minute hand fix).
- Exported blocks paste into the tour with **zero hand-editing**, validated
  by the tour's existing data-audit tests.

Known accepted limitation: depth models misread glass and mirrors. The review
step exists precisely for those walls; the manual workflow (crosshair aims)
remains the fallback for anything the model can't see.
