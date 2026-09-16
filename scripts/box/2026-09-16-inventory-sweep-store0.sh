#!/usr/bin/env bash
# Deals API: POST /api/inventory/sweep accepts dealerId 0 (the "no store matched" bucket), so the nightly sync
# can retire store-less rows once their VINs are re-filed under real stores.
#
# Run on the deals box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-16-inventory-sweep-store0.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-16-inventory-sweep-store0.sh && bash 2026-09-16-inventory-sweep-store0.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart, health check.
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
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:160]}"
    s = s.replace(old, new); changed.append(label)

if "dealerId == null || !seenAfter" not in s:
    rep("  const dealerId = INV_INT(body.dealerId);\n  const seenAfter = typeof body.seenAfter === \"string\" ? new Date(body.seenAfter) : null;\n  if (!dealerId || !seenAfter || Number.isNaN(seenAfter.getTime())) return badRequest(res, \"dealerId and seenAfter (ISO) are required\");\n  const sources = Array.isArray(body.sources)", "  const dealerId = INV_INT(body.dealerId);\n  const seenAfter = typeof body.seenAfter === \"string\" ? new Date(body.seenAfter) : null;\n  // dealerId 0 is the \"no store matched\" bucket \u2014 sweeping it retires rows that a later sync re-filed under a real store.\n  if (dealerId == null || !seenAfter || Number.isNaN(seenAfter.getTime())) return badRequest(res, \"dealerId and seenAfter (ISO) are required\");\n  const sources = Array.isArray(body.sources)", "sweep store 0")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory/stats)
echo "GET /api/inventory/stats without key -> $code (401 = server up and guarding)"
