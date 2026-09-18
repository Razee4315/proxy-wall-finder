#!/usr/bin/env python3
"""
generate-depth.py — Proxy Wall Finder depth sidecar (M1, docs/ROADMAP.md).

Runs DAP ("Depth Any Panoramas", Insta360-Research-Team) over a folder of
equirectangular panoramas and writes the app-facing contract of
docs/TECHNICAL-DESIGN.md §3:

    <out>/<scene>.npz    {"depth": float16 metres [H, W], "valid": uint8 [H, W]}
    <out>/<scene>.json   provenance (model, scale, resolution, device, ...)
    <out>/preview/<scene>.png   colorized depth for eyeballing (0-10 m window,
                         invalid pixels grayed)

Runs anywhere DAP runs (local CUDA box, Colab T4, CPU) — the web app never
runs a model, it only reads the .npz files.

Verified against the upstream repo (see docs/MODEL-DAP.md §3):
  - DAP emits NORMALIZED depth in 0..1 where 1.0 == 100 m
    (config max_depth: 1.0; datasets train on gt_depth / 100). This script
    multiplies by 100 before writing metres. Do not "fix" this away.
  - The model also emits pred_mask; upstream treats (1 - pred_mask) > 0.5 as
    valid and rewrites invalid pixels to 1.0 (= 100 m). We keep that
    convention and additionally store the validity mask.

Usage:
  python scripts/generate-depth.py \
    --dap-root C:/ml/DAP \
    --weights  C:/ml/DAP/weights/model.pth   (default: <dap-root>/weights/model.pth)
    --panos    C:/site/panoramas \
    --out      C:/site/depth \
    [--device auto|cuda|cpu] [--input-size 518] [--glob pat] [--force]
"""
from __future__ import annotations

import argparse
import datetime as dt
import fnmatch
import json
import os
import subprocess
import sys
import time

PANOS_EXTS = (".jpg", ".jpeg", ".png", ".webp")
# Upstream fact (see header): raw model output is 0..1 normalized, 1.0 = 100 m.
DEPTH_SCALE_METERS = 100.0
INVALID_DEPTH_METERS = 100.0
PREVIEW_MAX_METERS = 10.0  # upstream's "10m" visualization window

DAP_MODEL_SPEC_FALLBACK = {
    "name": "dap",
    "args": {
        "midas_model_type": "vitl",
        "fine_tune_type": "hypersim",
        "min_depth": 0.01,
        "max_depth": 1.0,
        "train_decoder": True,
    },
}


def log(msg: str) -> None:
    print(msg, flush=True)


def find_panos(folder: str, pattern: str | None) -> list[str]:
    names = sorted(
        n
        for n in os.listdir(folder)
        if n.lower().endswith(PANOS_EXTS) and not n.startswith(".")
    )
    if pattern:
        names = [n for n in names if fnmatch.fnmatch(n.lower(), pattern.lower())]
    return [os.path.join(folder, n) for n in names]


def dap_commit(dap_root: str) -> str:
    try:
        return (
            subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=dap_root, stderr=subprocess.DEVNULL
            )
            .decode()
            .strip()
        )
    except Exception:
        return "unknown"


def load_dap_model(dap_root: str, weights: str, device: str):
    """Boot DAP exactly like upstream test/infer.py, minus its hardcoded paths."""
    import torch
    import torch.nn as nn
    import yaml

    # DAP builds its DINOv3 adapter from a repo-relative path, and its modules
    # assume dap_root is importable — mirror upstream's environment precisely.
    os.chdir(dap_root)
    sys.path.insert(0, dap_root)
    from networks.models import make

    config_path = os.path.join(dap_root, "config", "infer.yaml")
    if os.path.isfile(config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.load(f, Loader=yaml.FullLoader)
        config["load_weights_dir"] = os.path.dirname(os.path.abspath(weights))
    else:
        config = {"model": DAP_MODEL_SPEC_FALLBACK}

    model = make(config["model"])
    model = model.to(device)

    state = torch.load(weights, map_location="cpu", weights_only=True)
    # Tolerate DataParallel-saved checkpoints ("module." prefixes) without
    # wrapping the model — strip and verify instead.
    state = {k.removeprefix("module."): v for k, v in state.items()}
    model_state = model.state_dict()
    matched = {k: v for k, v in state.items() if k in model_state}
    if not matched:
        raise RuntimeError(
            f"No keys from {weights} match the model — wrong weights file? "
            f"(model expects {len(model_state)} keys, checkpoint has {len(state)})"
        )
    missing = len(model_state) - len(matched)
    log(f"  weights: {os.path.basename(weights)} — {len(matched)} tensors loaded "
        f"({missing} model keys left at init, upstream loads strict=False too)")
    model.load_state_dict(matched, strict=False)
    model.eval()
    return model, config


def make_preprocess(input_size: int):
    """The model's own image2tensor pipeline, bound to OUR device instead of
    its auto-detect (so --device cpu works on CUDA machines)."""
    import cv2
    import numpy as np
    import torch

    # dap_root is already on sys.path (load_dap_model ran first)
    from depth_anything_utils import NormalizeImage, PrepareForNet, Resize

    def compose(fns):
        def run(sample):
            for fn in fns:
                sample = fn(sample)
            return sample
        return run

    transform = compose(
        [
            Resize(
                width=input_size * 2,
                height=input_size,
                resize_target=False,
                keep_aspect_ratio=True,
                ensure_multiple_of=14,  # DINOv3 patch size
                resize_method="lower_bound",
                image_interpolation_method=cv2.INTER_CUBIC,
            ),
            NormalizeImage(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            PrepareForNet(),
        ]
    )

    def run(img_rgb_u8: np.ndarray) -> torch.Tensor:
        image = transform({"image": img_rgb_u8.astype(np.float32) / 255.0})["image"]
        return torch.from_numpy(image).unsqueeze(0)

    return run


def infer_one(model, preprocess, img_rgb_u8, device):
    """Returns (depth_m float32 [H, W] metres, valid uint8 [H, W])."""
    import numpy as np
    import torch

    tensor = preprocess(img_rgb_u8).to(device)
    with torch.inference_mode():
        outputs = model(tensor)
    pred = outputs["pred_depth"][0, 0].detach().float().cpu().numpy()
    raw_mask = outputs["pred_mask"][0, 0].detach().float().cpu().numpy()

    valid = ((1.0 - raw_mask) > 0.5).astype(np.uint8)  # upstream semantics
    depth_m = pred.astype(np.float32) * DEPTH_SCALE_METERS
    depth_m[valid == 0] = INVALID_DEPTH_METERS  # upstream rewrites invalid → far
    return depth_m, valid


def write_preview(depth_m, valid, path):
    """Colorized depth for humans: 0-10 m window, Spectral (upstream's cmap),
    invalid pixels grayed out."""
    import cv2
    import matplotlib
    import numpy as np

    clipped = np.clip(depth_m, 0.0, PREVIEW_MAX_METERS) / PREVIEW_MAX_METERS
    u8 = (clipped * 255).astype(np.uint8)
    rgb = (matplotlib.colormaps["Spectral"](u8)[..., :3] * 255).astype(np.uint8)
    gray = np.full_like(rgb, 128)
    m = valid[..., None] == 0
    rgb = np.where(m, gray, rgb)
    cv2.imwrite(path, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--dap-root", required=True, help="cloned DAP repo")
    ap.add_argument("--weights", default=None,
                    help="model.pth (default <dap-root>/weights/model.pth)")
    ap.add_argument("--panos", required=True, help="folder of equirect JPG/PNG/WEBP")
    ap.add_argument("--out", required=True, help="output folder for .npz/.json/preview")
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    ap.add_argument("--input-size", type=int, default=518,
                    help="short-side lower bound for the model input (upstream default)")
    ap.add_argument("--glob", default=None, help="only panos matching this fnmatch pattern")
    ap.add_argument("--force", action="store_true", help="re-run scenes that already have outputs")
    args = ap.parse_args()

    import numpy as np

    try:
        import torch
    except ImportError:
        log("ERROR: PyTorch is not installed in this environment.")
        return 2

    if args.device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    else:
        device = args.device
        if device == "cuda" and not torch.cuda.is_available():
            log("ERROR: --device cuda but CUDA is not available.")
            return 2
    gpu = (torch.cuda.get_device_name(0) if device == "cuda" else "CPU")

    weights = args.weights or os.path.join(args.dap_root, "weights", "model.pth")
    if not os.path.isfile(weights):
        log(f"ERROR: weights not found at {weights}\n"
            "       download from https://huggingface.co/Insta360-Research/DAP-weights (model.pth)")
        return 2
    if not os.path.isdir(args.panos):
        log(f"ERROR: --panos folder not found: {args.panos}")
        return 2

    panos = find_panos(args.panos, args.glob)
    if not panos:
        log(f"ERROR: no JPG/PNG/WEBP panos in {args.panos}"
            + (f" matching {args.glob}" if args.glob else ""))
        return 2

    os.makedirs(args.out, exist_ok=True)
    os.makedirs(os.path.join(args.out, "preview"), exist_ok=True)

    log(f"DAP sidecar — {len(panos)} pano(s), device: {gpu}")
    log(f"  dap-root: {args.dap_root}")
    log(f"  out:      {args.out}\n")

    model, config = load_dap_model(args.dap_root, weights, device)
    preprocess = make_preprocess(args.input_size)
    commit = dap_commit(args.dap_root)

    done = skipped = failed = 0
    t_all = time.perf_counter()

    for path in panos:
        scene = os.path.splitext(os.path.basename(path))[0]
        npz_path = os.path.join(args.out, f"{scene}.npz")
        json_path = os.path.join(args.out, f"{scene}.json")
        preview_path = os.path.join(args.out, "preview", f"{scene}.png")

        if not args.force and os.path.isfile(npz_path) and os.path.isfile(json_path):
            log(f"  {scene}: already done, skipping (--force to re-run)")
            skipped += 1
            continue

        import cv2
        img_bgr = cv2.imread(path)
        if img_bgr is None:
            log(f"  {scene}: FAILED — unreadable image")
            failed += 1
            continue

        t0 = time.perf_counter()
        try:
            depth_m, valid = infer_one(model, preprocess, cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB), device)
        except Exception as e:
            log(f"  {scene}: FAILED — {type(e).__name__}: {e}")
            failed += 1
            continue
        seconds = time.perf_counter() - t0

        np.savez_compressed(npz_path, depth=depth_m.astype(np.float16), valid=valid)
        write_preview(depth_m, valid, preview_path)

        provenance = {
            "scene": scene,
            "source": os.path.basename(path),
            "source_resolution": [int(img_bgr.shape[0]), int(img_bgr.shape[1])],
            "model": "DAP",
            "model_repo": "https://github.com/Insta360-Research-Team/DAP",
            "model_commit": commit,
            "weights_file": os.path.basename(weights),
            "weights_bytes": os.path.getsize(weights),
            "depth_resolution": [int(depth_m.shape[0]), int(depth_m.shape[1])],
            "metric": True,
            "depth_units": "metres",
            "scale_note": (
                "model emits 0..1 normalized depth (1.0 == 100 m, upstream "
                "max_depth_meters=100); metres = pred * 100"
            ),
            "valid_mask": {
                "semantics": "1 = valid depth, 0 = invalid (model pred_mask >= 0.5)",
                "invalid_depth_value_m": INVALID_DEPTH_METERS,
            },
            "input_size": args.input_size,
            "device": device,
            "seconds": round(seconds, 2),
            "date": dt.datetime.now().isoformat(timespec="seconds"),
            "direction_convention": {
                "code": "pwp-v1",
                "formula": (
                    "lon=(u/W)*2*pi - pi; lat=(v/H)*pi - pi/2; "
                    "dir=(cos(lat)*sin(lon), sin(lat), -cos(lat)*cos(lon))"
                ),
                "note": (
                    "pixel-exact equivalent of DAP depth2point.py "
                    "(z-up, theta=(1-u)*2*pi, phi=v*pi) re-expressed in tour "
                    "coordinates (Y-up, yaw 0 = -Z); see docs/TECHNICAL-DESIGN.md 4.1"
                ),
            },
        }
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(provenance, f, indent=2, ensure_ascii=False)

        near = float(np.median(depth_m[valid == 1])) if valid.any() else float("nan")
        log(f"  {scene}: {depth_m.shape[1]}x{depth_m.shape[0]} "
            f"{seconds:.1f}s — median depth {near:.1f} m, "
            f"valid {100.0 * valid.mean():.0f}%")
        done += 1

    log(f"\nDone: {done} generated, {skipped} skipped, {failed} failed "
        f"in {time.perf_counter() - t_all:.1f}s")
    log(f"Hand the {args.out} folder (npz + json + preview/) to the web app.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
