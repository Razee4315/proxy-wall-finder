"""Call a Colab MCP tool via the local bridge and print the result."""
import json
import sys
import urllib.request

name = sys.argv[1]
args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 300

req = urllib.request.Request(
    "http://127.0.0.1:8765/call",
    data=json.dumps({"name": name, "arguments": args, "timeout": timeout}).encode(),
    headers={"Content-Type": "application/json"},
)
r = json.load(urllib.request.urlopen(req, timeout=timeout + 15))
res = r.get("result", {})
for c in res.get("content", []):
    if c.get("type") == "text":
        print(c.get("text", ""))
sc = res.get("structuredContent")
if sc:
    print("STRUCTURED:", json.dumps(sc)[:3000])
if res.get("isError"):
    print("IS_ERROR")
