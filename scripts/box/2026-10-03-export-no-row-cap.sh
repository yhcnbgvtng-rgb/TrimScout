#!/usr/bin/env bash
# Admin Vehicles CSV: remove the 50,000-row export cap (box side).
#
# handleExportInventory clamped `max` to 50,000 and ran `LIMIT max+1`. This streams every row matching the
# filter instead (no LIMIT, no max param). The NDJSON trailer keeps {"capped":false} for older callers.
# Search/sort/in-stock filtering (inventoryListQuery.js, handleListInventory) are NOT touched.
#
# Anchored (each snippet must match exactly once), idempotent, backs up, node --check, pm2 restart.
# DO NOT RUN while a long query holds a table metadata lock: a restart re-runs ensureInventoryTable's ALTERs,
# which then queue behind that query and hang every inventory endpoint. Check first:
#   sudo mysql -e "SELECT id,time,state,LEFT(info,90) FROM information_schema.processlist WHERE command<>'Sleep'"
#
# Run on the deals box (ubuntu@52.202.234.65), after the PR is merged to main:
#   cd ~ && B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main && curl -fsSL -o 2026-10-03-export-no-row-cap.sh "$B/scripts/box/2026-10-03-export-no-row-cap.sh?cb=$(date +%s)" && sudo cp 2026-10-03-export-no-row-cap.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-10-03-export-no-row-cap.sh
set -euo pipefail
FILE=/opt/trimscout-deals/src/deals_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"; echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}"
    s = s.replace(old, new)

if "const max = Math.min(Math.max(Number(params.get(\"max\")) || 50000, 1), 50000);" not in s:
    print("already patched"); sys.exit(0)

rep(r'''// GET /api/inventory/export?<same filters as /api/inventory>&max= — the admin sheet's CSV source.''',
    r'''// GET /api/inventory/export?<same filters as /api/inventory> — the admin sheet's CSV source. No row maximum:
// every row matching the filter is streamed (the trailer's `capped` is always false, kept for older callers).''', "header")
rep(r'''  const max = Math.min(Math.max(Number(params.get("max")) || 50000, 1), 50000);
  const conn = await pool.getConnection();''',
    r'''  const conn = await pool.getConnection();''', "max")
rep(r'''  let n = 0, capped = false;
  try {
    const rows = conn.connection.query(`SELECT i.*, d.city AS dealer_city, d.state AS dealer_state ${sql} ORDER BY ${orderBy} LIMIT ?`, [...args, max + 1]).stream({ highWaterMark: 500 });''',
    r'''  let n = 0;
  const capped = false;
  try {
    const rows = conn.connection.query(`SELECT i.*, d.city AS dealer_city, d.state AS dealer_state ${sql} ORDER BY ${orderBy}`, args).stream({ highWaterMark: 500 });''', "query")
rep(r'''      if (n === max) { capped = true; continue; }
      n++;''',
    r'''      n++;''', "loop")

open(p, "w").write(s)
print("patched")
PY

node --check "$FILE" && echo "syntax ok"
sudo -u ubuntu pm2 restart deals-api >/dev/null && sleep 3
echo "Rollback: sudo cp $FILE.bak.$STAMP $FILE && sudo -u ubuntu pm2 restart deals-api"
