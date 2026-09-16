#!/usr/bin/env bash
# Deals API: POST /api/inventory/sweep accepts `sources` — sweep only the rows a given crawler wrote, so the
# nightly crawl-box sync and the Mac state crawl (which overlap on NJ/NY/FL/TX/GA/SC/VA stores) stop marking
# each other's vehicles removed.
#
# Run on the deals box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-16-inventory-sweep-sources.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-16-inventory-sweep-sources.sh && bash 2026-09-16-inventory-sweep-sources.sh
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

if "sources: [\"nightly\"]" not in s and "AND source IN (?)" not in s:
    rep("// POST /api/inventory/sweep { dealerId, seenAfter } \u2014 a store's VINs not seen since `seenAfter` are marked removed.\nasync function handleInventorySweep(req, res) {\n  const pool = getPool();\n  await ensureInventoryTable(pool);\n  const body = await readBody(req);\n  const dealerId = INV_INT(body.dealerId);\n  const seenAfter = typeof body.seenAfter === \"string\" ? new Date(body.seenAfter) : null;\n  if (!dealerId || !seenAfter || Number.isNaN(seenAfter.getTime())) return badRequest(res, \"dealerId and seenAfter (ISO) are required\");\n  const [result] = await pool.query(\"UPDATE dealer_inventory SET removed_at = CURRENT_TIMESTAMP WHERE dealer_id = ? AND removed_at IS NULL AND last_seen_at < ?\", [dealerId, seenAfter]);\n  sendJson(res, 200, { removed: result.affectedRows });\n}", "// POST /api/inventory/sweep { dealerId, seenAfter, sources? } \u2014 a store's VINs not seen since `seenAfter` are\n// marked removed. With `sources` (e.g. [\"nightly\"]) only rows that crawler wrote are swept, so two crawlers\n// covering the same store don't erase each other's finds.\nasync function handleInventorySweep(req, res) {\n  const pool = getPool();\n  await ensureInventoryTable(pool);\n  const body = await readBody(req);\n  const dealerId = INV_INT(body.dealerId);\n  const seenAfter = typeof body.seenAfter === \"string\" ? new Date(body.seenAfter) : null;\n  if (!dealerId || !seenAfter || Number.isNaN(seenAfter.getTime())) return badRequest(res, \"dealerId and seenAfter (ISO) are required\");\n  const sources = Array.isArray(body.sources) ? body.sources.map((x) => INV_STR(x, 16)).filter(Boolean) : [];\n  const args = [dealerId, seenAfter];\n  let sql = \"UPDATE dealer_inventory SET removed_at = CURRENT_TIMESTAMP WHERE dealer_id = ? AND removed_at IS NULL AND last_seen_at < ?\";\n  if (sources.length) { sql += \" AND source IN (?)\"; args.push(sources); }\n  const [result] = await pool.query(sql, args);\n  sendJson(res, 200, { removed: result.affectedRows });\n}", "sweep sources")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory/stats)
echo "GET /api/inventory/stats without key -> $code (401 = server up and guarding)"
