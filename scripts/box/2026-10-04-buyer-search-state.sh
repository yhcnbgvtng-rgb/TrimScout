#!/usr/bin/env bash
# Buyer search: saved picks + viewed marks for signed-in buyers (box side).
#
# Adds GET/PUT /api/buyer-search-state and its table (created on first use). One row per user; the Next route
# (app/api/buyer/search-state) only ever passes the SESSION's user id. Until this runs the box answers 404, the route
# answers 503, and the search page keeps picks/viewed in the browser (localStorage) — nothing breaks.
#
# NOT DEPLOYED by the PR. It restarts deals-api, so: only run it when no recovery crawl / bulk sync / sweep is mid-flight
# AND no long query holds a table metadata lock (a restart re-runs ensureInventoryTable's ALTERs, which then queue behind
# that query and hang every inventory endpoint). Check first:
#   sudo mysql -e "SELECT id,time,state,LEFT(info,90) FROM information_schema.processlist WHERE command<>'Sleep'"
#
# Anchored (each anchor must match exactly once), idempotent, backs up, node --check, pm2 restart.
# Run on the deals box (ubuntu@52.202.234.65), after merge:
#   cd ~ && B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main && curl -fsSL -o 2026-10-04-buyer-search-state.sh "$B/scripts/box/2026-10-04-buyer-search-state.sh?cb=$(date +%s)" && sudo cp 2026-10-04-buyer-search-state.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-10-04-buyer-search-state.sh
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

if "handleBuyerSearchState" in s:
    print("already patched"); sys.exit(0)

HANDLER = r'''// GET /api/buyer-search-state?userId= and PUT /api/buyer-search-state { userId, picks?, viewed? } — a signed-in
// buyer's search picks (<= 3) and viewed marks, one row per user. The Next route only ever passes the SESSION's id.
// PUT updates just the parts given. Table is created on first use; nothing here touches dealer_inventory.
let buyerSearchStateReady = false;
async function ensureBuyerSearchState(pool) {
  if (buyerSearchStateReady) return;
  await pool.query("CREATE TABLE IF NOT EXISTS buyer_search_state (user_id VARCHAR(64) NOT NULL PRIMARY KEY, picks_json TEXT NULL, viewed_json MEDIUMTEXT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)");
  buyerSearchStateReady = true;
}
const BSS_STR = (v, n) => (typeof v === "string" && v.length > 0 && v.length <= n ? v : null);
async function handleBuyerSearchState(req, res, params) {
  const pool = getPool();
  await ensureBuyerSearchState(pool);
  if (req.method === "GET") {
    const userId = BSS_STR((params.get("userId") || "").trim(), 64);
    if (!userId) return badRequest(res, "userId is required");
    const [[row]] = await pool.query("SELECT picks_json, viewed_json FROM buyer_search_state WHERE user_id = ?", [userId]);
    const parse = (s) => { try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
    return sendJson(res, 200, { picks: parse(row && row.picks_json), viewed: parse(row && row.viewed_json) });
  }
  const body = await readBody(req);
  const userId = BSS_STR(typeof body.userId === "string" ? body.userId.trim() : "", 64);
  if (!userId) return badRequest(res, "userId is required");
  const picks = Array.isArray(body.picks) ? body.picks.slice(0, 3) : null;
  const viewed = Array.isArray(body.viewed) ? body.viewed.filter((k) => BSS_STR(k, 300)).slice(-2000) : null;
  if (!picks && !viewed) return badRequest(res, "picks or viewed is required");
  const picksJson = picks ? JSON.stringify(picks) : null;
  const viewedJson = viewed ? JSON.stringify(viewed) : null;
  if (JSON.stringify(picks || []).length > 8000) return badRequest(res, "picks too large");
  await pool.query(
    "INSERT INTO buyer_search_state (user_id, picks_json, viewed_json) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE picks_json = COALESCE(VALUES(picks_json), picks_json), viewed_json = COALESCE(VALUES(viewed_json), viewed_json)",
    [userId, picksJson, viewedJson]
  );
  sendJson(res, 200, { ok: true });
}

'''
rep("// GET /api/inventory/by-dealer", HANDLER + "// GET /api/inventory/by-dealer", "handler")
rep(r'''  if (req.method === "GET" && pathname === "/api/inventory/by-dealer") return run(handleInventoryByDealer);''',
    r'''  if (req.method === "GET" && pathname === "/api/inventory/by-dealer") return run(handleInventoryByDealer);
  if ((req.method === "GET" || req.method === "PUT") && pathname === "/api/buyer-search-state") return run(handleBuyerSearchState, url.searchParams);''', "route")
open(p, "w").write(s)
print("patched")
PY

node --check "$FILE" && echo "syntax ok"
sudo -u ubuntu pm2 restart deals-api >/dev/null && sleep 3
echo "Rollback: sudo cp $FILE.bak.$STAMP $FILE && sudo -u ubuntu pm2 restart deals-api"
