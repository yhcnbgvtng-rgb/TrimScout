#!/usr/bin/env bash
# Deals API: forces idx_inv_stock_make when a make= filter is present in GET /api/inventory.
# LIVE OUTAGE FIX: a make-filtered request with the default sort (dealer_name) caused
# MariaDB to pick idx_inv_stock_dealer (an estimated 295,717-row scan) instead of the far
# more selective idx_inv_stock_make (removed_at, make, model) — confirmed live 2026-09-22 via
# a stuck production query (75+ seconds and still running, killed manually) and a direct
# EXPLAIN + timing test: 110.9s unforced vs 203ms with FORCE INDEX. Likely caused by the
# growing number of indexes added earlier today for the prefix/suffix search giving the
# optimizer more (worse) options to choose from. model= and state= filters were checked
# against the same live data at the same time and do NOT hit this — only make= needed a hint.
#
# Run on the box (ubuntu@3.208.49.1) — deploy ASAP, this is an active-outage-class fix:
#   cd ~ && curl -fsSL -o 2026-09-22-fix-make-filter-index.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-22-fix-make-filter-index.sh && sudo cp 2026-09-22-fix-make-filter-index.sh /opt/trimscout-deals/ && cd /opt/trimscout-deals && sudo bash 2026-09-22-fix-make-filter-index.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart, health check.
set -euo pipefail
FILE=/opt/trimscout-deals/src/deals_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read(); changed=[]
def rep(old,new,label):
    global s
    n=s.count(old); assert n==1, f"{label}: {n}\n{old[:160]}"
    if new in s: return
    s=s.replace(old,new); changed.append(label)
rep('''  const limit = Math.min(Math.max(Number(p("limit")) || 200, 1), 2000);
  const offset = Math.max(Number(p("offset")) || 0, 0);
  const sql = `FROM dealer_inventory i LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${where.length ? "WHERE " + where.join(" AND ") : ""}`;''',
'''  const limit = Math.min(Math.max(Number(p("limit")) || 200, 1), 2000);
  const offset = Math.max(Number(p("offset")) || 0, 0);
  // A make= filter combined with the default dealer_name sort made the optimizer pick
  // idx_inv_stock_dealer (295k-row estimate) over the far more selective idx_inv_stock_make
  // (removed_at, make, model) — confirmed live 2026-09-22: 110.9s vs 203ms forced. Likely
  // the growing number of indexes on this table (added for the prefix/suffix search) gave
  // the planner more bad options to pick from. model= and state= filters were checked at the
  // same time and don't hit this — only make= needed a hint.
  const indexHint = p("make") ? "FORCE INDEX (idx_inv_stock_make)" : "";
  const sql = `FROM dealer_inventory i ${indexHint} LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${where.length ? "WHERE " + where.join(" AND ") : ""}`;''', "force idx_inv_stock_make for make= filter")
open(p,"w").write(s)
print("patched:", ", ".join(changed) or "nothing")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3004/api/inventory?inStock=1&limit=1&make=Porsche")
echo "make-filter-check: $code"
