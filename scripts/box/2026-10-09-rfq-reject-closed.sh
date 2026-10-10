#!/usr/bin/env bash
# Deals API: let an admin REJECT a quote request the buyer already closed (walked/picked).
# Before: POST /api/rfqs/:id/approval returned 409 "closed" for any non-collecting request, so a
# buyer who walked away left a card stuck in Pending approvals that could not be dismissed.
# After: "rejected" is accepted on closed requests (clears the queue); "approved"/"pending" stay 409.
#
# Run on the deals box (crawler-box-2, 52.202.234.65; pm2 process deals-api):
#   curl -fsSL -o 2026-10-09-rfq-reject-closed.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-09-rfq-reject-closed.sh && bash 2026-10-09-rfq-reject-closed.sh
# Idempotent. Backup, exact-replace with assert, node --check, pm2 restart.
set -euo pipefail
# Guard: the restart drops in-flight inventory-sync requests (sync talks to this API on :3004).
if pgrep -f inventory-sync.mjs >/dev/null && [ "${FORCE:-0}" != "1" ]; then
  echo "inventory-sync is running; wait for it to finish (or rerun with FORCE=1). Nothing changed."; exit 1
fi
FILE=/opt/trimscout-deals/src/deals_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = '''  if (rows[0].status !== "collecting") return sendJson(res, 409, { error: "closed" });
  await pool.query(
    "UPDATE rfq_requests SET approval_status = ?'''
new = '''  if (rows[0].status !== "collecting" && decision !== "rejected") return sendJson(res, 409, { error: "closed" });
  await pool.query(
    "UPDATE rfq_requests SET approval_status = ?'''
if new in s:
    print("already patched"); sys.exit(0)
n = s.count(old); assert n == 1, f"expected exactly 1 match, found {n}"
open(p, "w").write(s.replace(old, new)); print("patched")
PY

node --check "$FILE"
pm2 restart deals-api
sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3004/api/rfqs?all=1&approval=pending")
echo "GET /api/rfqs?all=1&approval=pending without key -> $code (401 = server up and guarding)"
