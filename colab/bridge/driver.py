"""Colab MCP bridge — drives googlecolab/colab-mcp over stdio JSON-RPC and
exposes it on localhost HTTP so the agent can call tools via curl.

Endpoints (127.0.0.1:8765):
  GET  /status -> {alive, tools[], recent notifications}
  POST /open   -> calls open_colab_browser_connection (opens browser, waits
                  up to 120s for the user to click Connect in Colab)
  POST /call   -> {"name": "...", "arguments": {...}, "timeout": 300}
"""
import http.server
import itertools
import json
import subprocess
import threading
import time

UVX = r"C:\Users\Saqlain\AppData\Local\hermes\bin\uvx.exe"
PORT = 8765

state = {
    "proc": None,
    "tools": [],
    "notifies": [],
    "server_requests": [],
    "connected": False,
}
wlock = threading.Lock()
resp_cv = threading.Condition()
responses = {}
ids = itertools.count(100)


def log(*a):
    print(time.strftime("[%H:%M:%S]"), *a, flush=True)


def spawn():
    state["proc"] = subprocess.Popen(
        [UVX, "git+https://github.com/googlecolab/colab-mcp"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, text=True, encoding="utf-8", bufsize=1,
    )
    threading.Thread(target=reader, daemon=True).start()


def send(obj):
    with wlock:
        try:
            state["proc"].stdin.write(json.dumps(obj) + "\n")
            state["proc"].stdin.flush()
        except Exception as e:
            log("send failed:", e)


def reader():
    for line in state["proc"].stdout:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            log("unparseable:", line[:200])
            continue
        if "id" in msg and ("result" in msg or "error" in msg):
            with resp_cv:
                responses[msg["id"]] = msg
                resp_cv.notify_all()
        elif str(msg.get("method", "")).startswith("notifications/"):
            state["notifies"].append(msg)
            state["notifies"] = state["notifies"][-30:]
            m = msg.get("method")
            if m and "progress" in m:
                log("progress:", json.dumps(msg.get("params", {}))[:200])
            elif m and m != "notifications/initialized":
                log("notify:", m)
        elif msg.get("method") == "ping":
            send({"jsonrpc": "2.0", "id": msg["id"], "result": {}})
        else:
            state["server_requests"].append(msg)
            state["server_requests"] = state["server_requests"][-10:]
            log("server request (ignored):", msg.get("method"))


def request(method, params, timeout=90):
    i = next(ids)
    with resp_cv:
        responses.pop(i, None)
    send({"jsonrpc": "2.0", "id": i, "method": method, "params": params})
    end = time.time() + timeout
    with resp_cv:
        while i not in responses:
            left = end - time.time()
            if left <= 0:
                return {"error": {"code": -32000, "message": f"timeout on {method}"}}
            resp_cv.wait(left)
        return responses[i]


def initialize():
    r = request("initialize", {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "pwp-colab-bridge", "version": "0.1"},
    }, timeout=180)
    log("initialize:", json.dumps(r)[:300])
    if "error" in r:
        raise SystemExit(f"initialize failed: {r}")
    send({"jsonrpc": "2.0", "method": "notifications/initialized"})
    refresh_tools()


def refresh_tools():
    r = request("tools/list", {}, timeout=30)
    tools = r.get("result", {}).get("tools", [])
    state["tools"] = [{"name": t.get("name"),
                       "description": (t.get("description") or "")[:300]}
                      for t in tools]
    log("tools:", [t["name"] for t in state["tools"]])


def call_tool(name, arguments, timeout=300):
    r = request("tools/call", {"name": name, "arguments": arguments}, timeout)
    if name == "open_colab_browser_connection":
        txt = json.dumps(r)
        state["connected"] = '"result": true' in txt or '"result":true' in txt or \
            (r.get("result", {}).get("structuredContent", {}).get("result") is True)
    return r


class Handler(http.server.BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/status":
            return self._json(200, {
                "serverAlive": state["proc"] and state["proc"].poll() is None,
                "connected": state["connected"],
                "tools": state["tools"],
                "notifies": state["notifies"][-10:],
                "serverRequests": state["server_requests"][-3:],
            })
        self._json(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/open":
            return self._json(200, call_tool("open_colab_browser_connection", {}, 120))
        if self.path == "/call":
            return self._json(200, call_tool(
                req.get("name"), req.get("arguments", {}),
                int(req.get("timeout", 300))))
        if self.path == "/tools":
            refresh_tools()
            return self._json(200, {"tools": state["tools"]})
        self._json(404, {"error": "not found"})


if __name__ == "__main__":
    spawn()
    time.sleep(2)
    initialize()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log(f"bridge ready on http://127.0.0.1:{PORT}")
    srv.serve_forever()
