# Sidecar scripts (Python, offline)

`generate-depth.py` (M1) runs DAP folder inference and writes the app
contract per pano — `<scene>.npz` (float16 metres + valid mask) and
`<scene>.json` (provenance) — plus a colorized preview PNG. See
docs/MODEL-DAP.md for the verified model facts (×100 scale, pred_mask) and
docs/TECHNICAL-DESIGN.md §3 for the contract.

## Quick start (local GPU/CPU box)

```bash
git clone https://github.com/Insta360-Research-Team/DAP C:/ml/DAP
# download weights: https://huggingface.co/Insta360-Research/DAP-weights → model.pth
#   → save as C:/ml/DAP/weights/model.pth
python scripts/generate-depth.py \
  --dap-root C:/ml/DAP \
  --panos    C:/site/panoramas \
  --out      C:/site/depth
```

Deps: torch, opencv-python, matplotlib, pyyaml, numpy, einops.
(A ready Windows venv with CPU torch exists at `C:\ml\pwp-sidecar`.)

## No GPU? Colab

Open [`colab/generate-depth.ipynb`](../colab/generate-depth.ipynb) on Google
Colab (free T4), run top to bottom, upload panos in cell 4, download
`depth-output.zip` in cell 7, unzip into `depth/`. The notebook clones this
repo and runs this same script — one source of truth for inference.

## Flags

`--device auto|cuda|cpu` · `--input-size 518` · `--glob pattern` (subset) ·
`--force` (re-run finished scenes). Skipped scenes resume for free.
