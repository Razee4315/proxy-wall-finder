# How we drive Google Colab from ZCode (colab-mcp + local bridge)

> Written after the first successful end-to-end run (2026-09-19): ZCode →
> bridge → colab-mcp → browser → Colab T4 → DAP → `depth-output.zip` back on
> the laptop, no manual cell-running. This doc is the runbook for repeating it.

## 1. Architecture — who talks to whom

```
ZCode (this CLI)                      your browser (logged into Google)
  │  Bash/curl                           │
  ▼                                      ▼
colab/bridge/driver.py ────── spawned ──▶ colab-mcp server (via uvx)
  localhost:8765 HTTP                        │ stdio JSON-RPC (MCP)
  POST /call, GET /status                    ▼
        ▲                              local WebSocket (random port +
        │                              one-time token in the URL)
        │                                      │
        └────────── agent calls ──────▶ Colab notebook UI (scratch tab)
                                               │ runs cells
                                               ▼
                                        Colab GPU runtime (T4)
```

- **colab-mcp** (google/`colab-mcp`, Apache-2.0) is an MCP server that
  proxies to a Colab notebook open in *your* browser. It exposes
  `add_code_cell / update_cell / run_code_cell / get_cells / …`.
- **The bridge driver** exists because ZCode *connects* the MCP server but a
  resumed conversation's tool list may not include its tools (our case: the
  server takes ~44 s to boot, the session snapshot was built before that).
  The driver spawns its own colab-mcp instance and relays it over plain
  HTTP, so the agent drives Colab with `curl`/`cc.py` — no ZCode restarts
  needed per session.
- Pairing is per-driver-instance: each driver start generates a new token;
  the browser tab connects to *that* instance's websocket.

## 2. One-time setup (done 2026-09-19, verify if switching machines)

1. `uv`/`uvx` on PATH (installed at `C:\Users\Saqlain\AppData\Local\hermes\bin`).
2. ZCode user config `~/.zcode/cli/config.json`:

```json
"mcp": { "servers": { "colab-mcp": {
  "type": "stdio",
  "command": "C:\\Users\\Saqlain\\AppData\\Local\\hermes\\bin\\uvx.exe",
  "args": ["git+https://github.com/googlecolab/colab-mcp"],
  "timeoutMs": 60000
} } }
```

   ⚠️ Schema is strict — an unknown key silently drops the server. The
   blog's `"timeout": 30000` is wrong for ZCode; the field is `timeoutMs`.
   60 s because first launch re-resolves the git package (~44 s observed).
3. Chrome/Edge logged into `colab.research.google.com`.
4. First Colab-side connect: accept the agent-connection prompt in the tab
   the driver opens (see runbook step 3).

## 3. Session runbook

Agent side (from ZCode, repo root):

```bash
# 1 · start the bridge in the background (stays alive across turns)
python colab/bridge/driver.py            # listens on 127.0.0.1:8765

# 2 · wait for boot, then open the pairing tab in the user's browser
curl -s --max-time 130 -X POST http://127.0.0.1:8765/open
#    → {"structuredContent": {"result": true}} once the user connects
#    → false = 60 s timeout; re-run /open and tell the user to click Connect

# 3 · check tools
curl -s http://127.0.0.1:8765/status
python colab/bridge/cc.py get_cells '{}' 60

# 4 · write + run cells
python colab/bridge/cc.py update_cell '{"cellId":"<id>","content":"print(1)"}'
python colab/bridge/cc.py add_code_cell '{"cellIndex":1,"language":"python","code":"..."}'
python colab/bridge/cc.py run_code_cell '{"cellId":"<id>"}' 300   # ← tool timeout (s)
```

User side (only 3 human actions):

1. Click **Connect** in the Colab tab the driver opens (once per driver).
2. When a cell calls `files.upload()`: pick the files, watch 100 %.
3. When the last cell calls `files.download()`: allow the download (Chrome
   may show a "keep?" prompt for .zip).

## 4. Our depth-generation notebook (cells, in order)

The canonical notebook is `colab/generate-depth.ipynb` (also runnable by
hand). When driving via the bridge we paste the same cells into a scratch
notebook: GPU check → clone DAP + this repo + `pip install einops
torchmetrics` → weights `wget` (1.46 GB, ~14 s on Colab) → `files.upload()`
panos → `scripts/generate-depth.py --dap-root /content/DAP --panos
/content/panos --out /content/depth` → provenance summary + zip +
`files.download`. Bring the zip home into `depth/` (gitignored).

Runtime: **T4 GPU** (Runtime → Change runtime type). Free tier is enough —
3 panos ≈ 4 s of GPU time; a 10-scene site ≈ 10 s.

## 5. Troubleshooting — everything we actually hit

| Symptom | Cause | Fix |
|---|---|---|
| Server never starts, no process, log shows plugin MCPs only | config used `timeout` (unknown key → server dropped) | use `timeoutMs`, `type: "stdio"` (§2) |
| "Restarted" but nothing changed | ZCode setting `closeToTrayOnWindows: true` — X only hides the window | tray icon → Quit, or Task Manager → End task |
| `mcp.server.connected` in `~/.zcode/cli/log/zcode-*.jsonl` but agent has no tools | resumed-session tool snapshot predates the 44 s server boot | use the bridge driver (§1) — or start a fresh conversation |
| `ModuleNotFoundError: torchmetrics` during model build | DINOv3 `hubconf.py` imports eval segmentation code; dep missing on Colab | `pip install torchmetrics` (fixed in notebook cell 2, commit 5c39736) |
| Upload cell shows "Upload widget is only available when the cell has been executed in the current browser session" | cell ran before the runtime/browser pairing | re-run the upload cell after connecting |
| `/open` returns `false` | user didn't click Connect within 60 s | re-run; the token is stable per driver instance |
| Download doesn't appear | Chrome blocked the zip | allow/"keep" in the downloads bar |
| Bash args with single quotes (`meta['scene']`) lost quotes | bash single-quote concatenation ate them | write cell content with double quotes only |

## 6. Privacy & license reminders

- Uploading panos sends them to Google's cloud for that session — fine for
  internal/dev, use a local GPU box for sensitive client sites.
- DAP weights are **CC BY-NC 4.0** (non-commercial) — the open commercial
  question from docs/MODEL-DAP.md §6.1 still stands.
- The pairing token is localhost-only and single-session; closing the
  driver kills the bridge. Nothing is reachable from the network.
