#!/usr/bin/env bash
# Fixes POST /api/rfqs/:id/invites → 500 "require is not defined" on the box.
# deals_api_server.js runs as an ES module there; newViewToken() (from the
# 2026-09-11 quote-package patch) used require("crypto"). Use the imported
# node:crypto instead. Idempotent.
set -euo pipefail
FILE=/opt/trimscout-deals/src/deals_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"
sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}"
    s = s.replace(old, new); changed.append(label)
if 'require("crypto")' in s:
    rep('  return require("crypto").randomBytes(24).toString("base64url");', '  return randomBytes(24).toString("base64url");', "newViewToken")
if 'from "node:crypto"' not in s:
    rep('import http from "node:http";', 'import http from "node:http";\nimport { randomBytes } from "node:crypto";', "import")
open(p, "w").write(s)
print("patched:", p, "| applied:", ", ".join(changed) or "nothing (already present)")
PY
node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api
sleep 3
echo "--- last error lines (expect none new) ---"
sudo pm2 logs trimscout-deals-api --err --lines 3 --nostream | tail -3
