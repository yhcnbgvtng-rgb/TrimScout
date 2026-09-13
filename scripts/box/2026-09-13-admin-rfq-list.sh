#!/usr/bin/env bash
# Deals API: GET /api/rfqs?all=1[&limit=N] — every quote request across
# buyers, newest first, with invites + quotes. For the admin "all quote
# requests" desk (the Next.js route is admin-session-gated; this endpoint
# is API-key-only like the rest).
#
# Run on the box as ubuntu:
#   bash 2026-09-13-admin-rfq-list.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart.
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

if 'query.get("all")' not in s:
    rep('''async function handleListRfqs(req, res, query) {
  const buyerUserId = (query.get("buyerUserId") || "").trim();
  if (!buyerUserId) return badRequest(res, "buyerUserId is required");
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rows] = await pool.query(
    "SELECT * FROM rfq_requests WHERE buyer_user_id = ? ORDER BY created_at DESC",
    [buyerUserId]
  );''', '''async function handleListRfqs(req, res, query) {
  const buyerUserId = (query.get("buyerUserId") || "").trim();
  const all = query.get("all") === "1";
  if (!buyerUserId && !all) return badRequest(res, "buyerUserId is required");
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  // all=1: the admin desk — every buyer's requests, newest first, capped.
  const limit = Math.min(Math.max(Number(query.get("limit")) || 200, 1), 1000);
  const [rows] = all
    ? await pool.query("SELECT * FROM rfq_requests ORDER BY created_at DESC LIMIT ?", [limit])
    : await pool.query(
        "SELECT * FROM rfq_requests WHERE buyer_user_id = ? ORDER BY created_at DESC",
        [buyerUserId]
      );''', "list all")
open(p, "w").write(s)
print("patched:", p, "| applied:", ", ".join(changed) or "nothing (already present)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api
sleep 3
echo "--- process up? (401 = up, key required) ---"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3004/health
