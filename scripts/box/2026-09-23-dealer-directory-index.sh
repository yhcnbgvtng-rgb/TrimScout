#!/usr/bin/env bash
# Auth/directory API: add the missing index on dealership_contacts.dealer_name.
# GET /api/dealerships (the admin Web Crawl Sheet's one blocking fetch) runs
# SELECT * FROM dealership_contacts ORDER BY dealer_name ASC with no index to
# walk. dealer_inventory got composite sort/filter indexes on 2026-09-16
# (2026-09-16-inventory-speed.sh); this table never did, and has grown a lot
# since via nationwide brand dealer-contact crawls (BMW, Mercedes, Ford,
# Hyundai, etc.) — the unindexed full-table filesort now intermittently
# exceeds dealershipsApi.ts's 8s client abort, producing the admin sheet's
# "Request timed out" banner.
#
# Run on the deals box (ubuntu@3.208.49.1 — same box serves both APIs):
#   curl -fsSL -o 2026-09-23-dealer-directory-index.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-23-dealer-directory-index.sh && bash 2026-09-23-dealer-directory-index.sh
# Idempotent. The index builds on the first /api/dealerships request after
# restart.
set -euo pipefail
FILE=/opt/trimscout-auth/src/auth_api_server.js
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

if "ensureDealerNameIndex" not in s:
    rep('''  dealerDomainColumnsEnsured = true;
  console.log(`dealer domains: columns ensured, backfilled ${filled} of ${rows.length} rows`);
}''', '''  dealerDomainColumnsEnsured = true;
  console.log(`dealer domains: columns ensured, backfilled ${filled} of ${rows.length} rows`);
}
let dealerNameIndexEnsured = false;
async function ensureDealerNameIndex(pool) {
  if (dealerNameIndexEnsured) return;
  await pool.query("ALTER TABLE dealership_contacts ADD INDEX IF NOT EXISTS idx_dealer_name (dealer_name)");
  dealerNameIndexEnsured = true;
}''', "index helper")
    rep('''  const pool = getPool();
  await ensureDealerDomainColumns(pool);
  await ensureDealerOptOutColumn(pool);
  const [rows] = await pool.query("SELECT * FROM dealership_contacts ORDER BY dealer_name ASC");
  sendJson(res, 200, { dealerships: rows.map(publicDealership) });''', '''  const pool = getPool();
  await ensureDealerDomainColumns(pool);
  await ensureDealerOptOutColumn(pool);
  await ensureDealerNameIndex(pool);
  const [rows] = await pool.query("SELECT * FROM dealership_contacts ORDER BY dealer_name ASC");
  sendJson(res, 200, { dealerships: rows.map(publicDealership) });''', "call site")
open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-auth-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3003/api/dealerships)
echo "GET /api/dealerships without key -> $code (401 = server up and guarding)"
