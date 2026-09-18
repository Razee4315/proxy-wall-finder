#!/usr/bin/env python3
"""compare-golden.py — M1 metric-claim check (docs/MODEL-DAP.md §6.3).

Compares DAP depth against the venture-corridor walls hand-calibrated in
NEIC-Tour's src/data/tour.ts (proxy v1). The hand seams' pitches encode the
true floor-seam distance: d_hand = EYE_HEIGHT / tan(|pitch|).

For each hand wall we take the yaw range's middle half (avoiding the ends,
where neighbouring structures bleed in), sample the depth's near-floor rows,
and compare the median horizontal distance to d_hand.

Usage: python scripts/compare-golden.py --npz depth/neic-venture-corridor.npz
"""
import argparse
import json

import numpy as np

EYE_HEIGHT_M = 1.55

# From NEIC-Tour/src/data/tour.ts — neic-venture-corridor proxy v1 (4 walls).
HAND_WALLS = [
    {"name": "suite glass front", "yaw0": 42.8, "yaw1": 89.6, "pitch0": -31.2, "pitch1": -49.8},
    {"name": "dark-doors wall", "yaw0": 140.6, "yaw1": 157.3, "pitch0": -21.4, "pitch1": -22.4},
    {"name": "end wall (double doors)", "yaw0": 161.1, "yaw1": 181.2, "pitch0": -22.5, "pitch1": -20.1},
    {"name": "space-mural wall", "yaw0": 203.9, "yaw1": 255.0, "pitch0": -27.0, "pitch1": -19.8},
]


def hand_distance(wall: dict) -> float:
    p = (abs(wall["pitch0"]) + abs(wall["pitch1"])) / 2
    return EYE_HEIGHT_M / np.tan(np.radians(p))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--npz", default="depth/neic-venture-corridor.npz")
    args = ap.parse_args()

    npz = np.load(args.npz)
    depth = npz["depth"].astype(np.float32).reshape(-1)
    valid = npz["valid"].reshape(-1) if "valid" in npz else None
    h, w = npz["depth"].shape

    # near-floor rows: pitch in [-50°, -15°]; v = (0.5 - pitch/180) * H
    # (pitch -15° is higher in the image → smaller row; -50° → larger row)
    v_lo = int((0.5 - (-15) / 180) * h)
    v_hi = int((0.5 - (-50) / 180) * h)

    print(f"depth: {w}x{h}, rows {v_lo}..{v_hi} (near-floor band)\n")
    print(f"{'wall':<24} {'hand d':>7} {'dap d':>7} {'diff':>7}  verdict (±20 cm)")
    ok_all = True
    for wall in HAND_WALLS:
        d_hand = hand_distance(wall)
        # middle half of the yaw range, sampled on 1° grid
        span = wall["yaw1"] - wall["yaw0"]
        yaws = np.linspace(wall["yaw0"] + span * 0.25, wall["yaw1"] - span * 0.25, 12)
        samples = []
        for yaw in yaws:
            u = int(((yaw + 180) % 360) / 360 * w) % w
            for v in range(v_lo, v_hi):
                i = v * w + u
                if valid is not None and valid[i] == 0:
                    continue
                z = depth[i]
                if not (0.2 < z < 30):
                    continue
                pitch = -((v + 0.5) / h * 180 - 90)
                horiz = z * np.cos(np.radians(pitch)) if pitch < 0 else None
                if horiz is None or not (0.2 < horiz < 30):
                    continue
                # keep only rows plausibly near the wall seam (within 40% of d_hand)
                if abs(horiz - d_hand) <= 0.4 * d_hand:
                    samples.append(horiz)
        if not samples:
            print(f"{wall['name']:<24} {d_hand:7.2f}    —      —      NO DEPTH SAMPLES")
            ok_all = False
            continue
        d_dap = float(np.median(samples))
        diff = d_dap - d_hand
        ok = abs(diff) <= 0.20
        ok_all &= ok
        print(f"{wall['name']:<24} {d_hand:7.2f} {d_dap:7.2f} {diff:+7.2f}  {'OK' if ok else 'OUT OF TOL'} ({len(samples)} px)")

    # global scale: median of dap/hand across walls
    ratios = []
    for wall in HAND_WALLS:
        d_hand = hand_distance(wall)
        span = wall["yaw1"] - wall["yaw0"]
        yaws = np.linspace(wall["yaw0"] + span * 0.25, wall["yaw1"] - span * 0.25, 12)
        samples = []
        for yaw in yaws:
            u = int(((yaw + 180) % 360) / 360 * w) % w
            for v in range(v_lo, v_hi):
                i = v * w + u
                if valid is not None and valid[i] == 0:
                    continue
                z = depth[i]
                if not (0.2 < z < 30):
                    continue
                pitch = -((v + 0.5) / h * 180 - 90)
                horiz = z * np.cos(np.radians(pitch)) if pitch < 0 else None
                if horiz is None or not (0.2 < horiz < 30):
                    continue
                if abs(horiz - d_hand) <= 0.4 * d_hand:
                    samples.append(horiz)
        if samples:
            ratios.append(float(np.median(samples)) / d_hand)
    if ratios:
        s = float(np.median(ratios))
        print(f"\nscale ratio dap/hand = {s:.3f} (1.0 = DAP metres are truth; "
              f"gate 0.6-1.6 per TECHNICAL-DESIGN 4.2)")
    print("\nVERDICT:", "metric claim HOLDS" if ok_all else "needs investigation")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
