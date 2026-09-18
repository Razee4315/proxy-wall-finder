# Depth sidecar

`generate-depth.py` wraps DAP and writes `<scene>.npz` + `<scene>.json` (+ preview PNGs).

## Local

```bash
pip install -r scripts/requirements.txt
# plus torch — see docs/MODEL-DAP.md
python scripts/generate-depth.py --dap-root /path/to/DAP --panos ./panos --out ./depth
```

## Colab

Open `colab/generate-depth.ipynb`. Cell 2 clones DAP + this repo and installs minimal deps, then downloads weights once. Do not re-run a second weights cell.

**Privacy:** Colab uploads panoramas to Google. Use a local GPU for sensitive client sites.
