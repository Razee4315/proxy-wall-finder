# Model Integration — DAP (Depth Any Panoramas)

> The depth engine behind Proxy Wall Finder. Companion:
> [TECHNICAL-DESIGN §3-4](TECHNICAL-DESIGN.md)

## 1. What DAP is

**DAP — "Depth Any Panoramas"** (Insta360 Research Team, CVPR 2026) is a
foundation model for **panoramic depth estimation**: equirectangular image in,
equirectangular depth map out. It matters to us for three reasons:

1. It is trained for **equirectangular** input — generic perspective depth
   models (Depth Anything family) distort on 360° imagery unless you tile the
   pano into perspective views first.
2. It produces **metric** depth (metres) — and our camera is an Insta360 X5,
   the model's home domain.
3. The repo ships the plumbing we need anyway: `erp2cubemap.py`
   (equirect→cubemap), `depth2point.py`, `depth2normal.py` (depth→3D points).

- Repo: <https://github.com/Insta360-Research-Team/DAP>
- Paper: arXiv [2512.16913](https://arxiv.org/abs/2512.16913)
- Weights: <https://huggingface.co/Insta360-Research/DAP-weights>
- Training data: <https://huggingface.co/Insta360-Research/DAP_data>

## 2. Installation (sidecar machine)

```bash
git clone https://github.com/Insta360-Research-Team/DAP
cd DAP
conda create -n dap python=3.12
conda activate dap
pip install torch==2.7.1 torchvision==0.22.1
pip install -r requirements.txt
# download weights from the HuggingFace repo (Insta360-Research/DAP-weights)
```

Tested upstream on torch 2.7.1 / torchvision 0.22.1. A CUDA GPU is implied by
the upstream setup; CPU inference speed is unverified upstream — assume GPU
or cloud for now (§6).

## 3. Inference (our wrapper)

Upstream runs `python test/infer.py` (single/edited inputs). Our sidecar
`scripts/generate-depth.py` wraps it to process a **folder**:

```
python scripts/generate-depth.py \
  --dap-root  C:/ml/DAP \            # cloned repo + weights
  --panos     C:/site/panoramas \    # equirect JPG/PNG/WEBP
  --out       C:/site/depth \        # <scene>.npz + <scene>.json per pano
  --device    cuda                   # or cpu
```

Output contract (consumed by the web app — see
[TECHNICAL-DESIGN §3](TECHNICAL-DESIGN.md)):

- `<scene>.npz` — float16 `depth[H, W]` in **metres**, aligned to the
  equirect grid (whatever internal resolution DAP uses; the JSON records it).
- `<scene>.json` — provenance: `{ model: "DAP", model_commit, weights_file,
  resolution, device, seconds, date, metric: true }`.

Implementation note: reuse DAP's own loader/preprocess and `depth2point.py`'s
direction convention inside the wrapper — the app's point-cloud code (§4.1 of
TECHNICAL-DESIGN) must match it exactly. **First task of M1 is diffing our
equirect direction formula against `depth2point.py` and writing a one-image
regression check.**

## 4. Hardware guidance

| Machine | How to run |
|---|---|
| CUDA GPU (≥8 GB) | local sidecar, seconds–minutes per pano |
| The maintainer's weak laptop | Colab / Kaggle / any GPU box: run the sidecar there, bring back the `.npz` files (a 9-scene site is a few MB of float16) |
| CPU-only | unverified upstream — try `--device cpu` once; if unusable, fall back to §5 models with known CPU paths, or batch overnight |

The web app is deliberately inference-free, so the sidecar can move to any
machine without touching the tool.

## 5. Fallback models (same sidecar contract)

If DAP is unavailable (weights gated, license issue, bad outputs on our
data), the sidecar's contract (`<scene>.npz` metric depth) stays fixed and
the backend swaps:

| Model | Repo | Notes |
|---|---|---|
| **Depth Anything 3** (ByteDance, 2025) | github.com/ByteDance-Seed/Depth-Anything-3 | strongest open generalist; perspective-native → run on cubemap tiles (DAP's `erp2cubemap.py` works) and merge back to equirect; metric variant needed |
| **Depth Pro** (Apple) | github.com/apple/ml-depth-pro | zero-shot metric mono depth; sharp boundaries; perspective-native, same tiling dance |
| **ZoeDepth** | github.com/isl-org/ZoeDepth | older but well-documented metric depth; simplest CPU-viable fallback |

Decision rule: DAP first (domain match); DA3 if DAP can't run; tiling
pipeline shared between fallbacks.

## 6. Open items to verify during M1 (blocking checks)

1. **License** — DAP ships a LICENSE file whose terms are not stated on the
   README. Read it before any client-facing/commercial use. (Our use is
   internal tooling; still, verify redistribution of outputs is permitted.)
2. **Weights availability** — confirm the HF repo downloads without gating
   (account/token requirements), and record the exact weights file + commit
   in the sidecar JSON provenance.
3. **Metric claim** — run DAP on one NEIC pano with a known real distance
   (laser measure) and check the returned metres. Then our floor-plane scale
   fit (TECHNICAL-DESIGN §4.2) should report correction factor `s ≈ 1`;
   anything outside `0.6–1.6` means "relative depth in disguise" and the
   floor-anchor calibration becomes load-bearing instead of a sanity check.
4. **Glass behavior** — shoot the Venture Corridor's dotted-glass suite
   front and inspect the depth: expect garbage/conflict; this validates the
   glass-suspect heuristic and the manual-fallback workflow.
