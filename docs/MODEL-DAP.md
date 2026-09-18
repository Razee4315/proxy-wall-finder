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

Tested upstream on torch 2.7.1 / torchvision 0.22.1; the README says any
torch > 2 works. Do **not** `pip install -r requirements.txt` on Colab —
it would reinstall torch (risking the preinstalled CUDA build) and drag in
unneeded extras (gradio, open3d, mmengine). On Colab only `einops` is
missing; a local box needs torch + opencv-python + matplotlib + pyyaml +
einops + numpy. The sidecar itself avoids torchvision (plain compose).

## 3. Inference (our wrapper)

Upstream runs `python test/infer.py` (single/edited inputs). Our sidecar
`scripts/generate-depth.py` wraps it to process a **folder** — locally on a
GPU box, or on Colab via [`colab/generate-depth.ipynb`](../colab/generate-depth.ipynb)
(T4 GPU; our laptop GPU is 4 GB and too small — §4):

```
python scripts/generate-depth.py \
  --dap-root  C:/ml/DAP \            # cloned repo + weights/model.pth
  --panos     C:/site/panoramas \    # equirect JPG/PNG/WEBP
  --out       C:/site/depth \        # <scene>.npz + <scene>.json per pano
  --device    auto                   # auto | cuda | cpu
```

Output contract (consumed by the web app — see
[TECHNICAL-DESIGN §3](TECHNICAL-DESIGN.md)):

- `<scene>.npz` — `depth` float16 `[H, W]` in **metres** at the model's
  output resolution (the JSON records it), plus `valid` uint8 (1 = valid
  depth, 0 = model-flagged invalid — glass/mirrors/sky candidates).
- `<scene>.json` — provenance: model + commit + weights, resolution, device,
  seconds, date, `metric: true`, scale note, direction convention.

### Verified against the upstream repo (2026-09, M1 recon + mock run)

1. **Output scale — normalized, not metres.** The model emits `pred_depth`
   in `0..1` where `1.0 == 100 m` (`config/infer.yaml` `max_depth: 1.0`;
   every dataset trains on `gt_depth / 100`). **metres = pred × 100** — the
   sidecar does this before writing the npz. This is the "relative depth in
   disguise" case §6.3 warned about, caught by reading the code; the
   laser-measure check (§6.3) still validates it end-to-end.
2. **`pred_mask`** — the model also emits an invalid mask; upstream treats
   `(1 − pred_mask) > 0.5` as valid and rewrites invalid pixels to `1.0`
   (= 100 m). We keep that convention and store the mask (`valid` in the
   npz) — free input for the glass-suspect heuristic (TECHNICAL-DESIGN §4.5).
3. **Weights** — single `model.pth`, 1.46 GB, **CC BY-NC 4.0** (non-commercial;
   see §6.1), public HF repo, no gating.
4. **Preprocessing** — upstream's `image2tensor`: lower-bound resize
   (short side 518, multiples of DINOv3's patch 14 → ~1036×518 for 2:1
   panos), ImageNet mean/std. The sidecar replicates it exactly but binds
   the device itself (so `--device cpu` works on CUDA machines).
5. **Direction convention** — DAP's `depth2point.py` is z-up
   (`θ=(1−u)·2π, φ=v·π`); our pipeline formula (TECHNICAL-DESIGN §4.1) is
   the pixel-exact equivalent re-expressed in tour coordinates (Y-up,
   yaw 0 = −Z). Recorded in every provenance JSON; the one-image regression
   check (asymmetric room, M2) still validates it against real output.

## 4. Hardware guidance

| Machine | How to run |
|---|---|
| CUDA GPU (≥8 GB) | local sidecar, seconds–minutes per pano |
| The maintainer's weak laptop (4 GB Quadro) | **[`colab/generate-depth.ipynb`](../colab/generate-depth.ipynb)** (free T4): setup → weights → upload panos → generate → download zip, then unzip into `depth/` for the app. A 9-scene site is a few MB of float16. |
| CPU-only | try `--device cpu` once (a local 3.12 venv exists at `C:\ml\pwp-sidecar` with CPU torch); if unusable, batch overnight or fall back to §5 models |

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
