#!/usr/bin/env bash
# Deals API: expose rfq_invites.dealer_unsubscribed_at on the invite (set by the auth server's
# opt-out cascade), and ensure the column exists. Pairs with 2026-09-17-dealer-unsub-cascade-auth.sh.
#
# Run on the box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-17-dealer-unsub-cascade-deals.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-17-dealer-unsub-cascade-deals.sh && bash 2026-09-17-dealer-unsub-cascade-deals.sh
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
    n=s.count(old); assert n==1, f"{label}: {n}\n{old[:120]}"
    if new in s: return
    s=s.replace(old,new); changed.append(label)
rep('''  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS buyer_counter_at DATETIME NULL");''',
'''  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS buyer_counter_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS dealer_unsubscribed_at DATETIME NULL");''', "invite column")
rep('''    buyerCounterAt: row.buyer_counter_at || null,
    priorQuotes: Array.isArray(row.__priorQuotes) ? row.__priorQuotes : [],''',
'''    buyerCounterAt: row.buyer_counter_at || null,
    // Set when the dealership opted out while this invite was still open (see auth server's
    // opt-out cascade). The buyer app stops waiting on it and disables counters; a quote
    // submitted before it stays readable.
    dealerUnsubscribedAt: row.dealer_unsubscribed_at || null,
    priorQuotes: Array.isArray(row.__priorQuotes) ? row.__priorQuotes : [],''', "invite serializer")
open(p,"w").write(s)
print("patched:", ", ".join(changed) or "nothing")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3004/api/inventory/stats")
echo "GET /api/inventory/stats -> $code (401 = server up and guarding)"
