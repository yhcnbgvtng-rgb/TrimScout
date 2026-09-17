#!/usr/bin/env bash
# Auth API: when a dealership unsubscribes (POST /api/dealerships/:id/opt-out), cascade to open quote
# requests — flag every still-open (invited) or already-quoted invite for that rooftop with
# dealer_unsubscribed_at so the buyer app stops waiting and disables counters, and write one
# rfq_events row per affected request (the buyer-notify signal, deduped by the flag). A quote
# submitted before the opt-out stays readable/choosable; status is untouched.
#
# Run on the box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-17-dealer-unsub-cascade-auth.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-17-dealer-unsub-cascade-auth.sh && bash 2026-09-17-dealer-unsub-cascade-auth.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart, health check.
set -euo pipefail
FILE=/opt/trimscout-auth/src/auth_api_server.js
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
rep('''async function handleSetDealershipOptOut(req, res, id) {
  const pool = getPool();
  const [result] = await pool.query("UPDATE dealership_contacts SET email_opt_out = 1 WHERE id = ?", [id]);
  if (result.affectedRows === 0) return sendJson(res, 404, { error: "Dealership not found" });
  const [rows] = await pool.query("SELECT * FROM dealership_contacts WHERE id = ?", [id]);
  sendJson(res, 200, { dealership: publicDealership(rows[0]) });
}''',
'''async function handleSetDealershipOptOut(req, res, id) {
  const pool = getPool();
  const [result] = await pool.query("UPDATE dealership_contacts SET email_opt_out = 1 WHERE id = ?", [id]);
  if (result.affectedRows === 0) return sendJson(res, 404, { error: "Dealership not found" });
  const [rows] = await pool.query("SELECT * FROM dealership_contacts WHERE id = ?", [id]);
  const dealer = rows[0];
  // Cascade to open quote requests pointing at this rooftop: flag every still-open
  // (invited) or already-quoted invite so the buyer's app stops waiting on it and
  // disables counters — WITHOUT touching status, so a quote submitted before the
  // opt-out stays readable and choosable. Idempotent: only rows not already flagged.
  let affectedRfqs = [];
  try {
    await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS dealer_unsubscribed_at DATETIME NULL");
    const [open] = await pool.query(
      `SELECT DISTINCT i.rfq_id FROM rfq_invites i JOIN rfq_requests r ON r.id = i.rfq_id
       WHERE i.dealer_name = ? AND i.status IN ('invited','quoted') AND i.dealer_unsubscribed_at IS NULL AND r.status = 'collecting'`,
      [dealer.dealer_name]
    );
    affectedRfqs = open.map((x) => String(x.rfq_id));
    if (affectedRfqs.length) {
      await pool.query(
        `UPDATE rfq_invites i JOIN rfq_requests r ON r.id = i.rfq_id
         SET i.dealer_unsubscribed_at = NOW()
         WHERE i.dealer_name = ? AND i.status IN ('invited','quoted') AND i.dealer_unsubscribed_at IS NULL AND r.status = 'collecting'`,
        [dealer.dealer_name]
      );
      // One event per affected request — the buyer-notify signal, deduped by the flag above.
      const values = affectedRfqs.map((rfqId) => [rfqId, "dealer_unsubscribed", JSON.stringify({ dealerId: String(id), dealerName: dealer.dealer_name })]);
      await pool.query("INSERT INTO rfq_events (rfq_id, event_type, payload_json) VALUES ?", [values]);
    }
  } catch (err) {
    // A directory-only dealer with no RFQ tables yet, or an older schema: the opt-out
    // itself still stands; the cascade is best-effort.
    console.error("opt-out cascade:", err && err.message);
  }
  sendJson(res, 200, { dealership: publicDealership(dealer), affectedRfqs });
}''', "opt-out cascade")
open(p,"w").write(s)
print("patched:", ", ".join(changed) or "nothing")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-auth-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:3003/api/dealerships/0/opt-out")
echo "POST /api/dealerships/0/opt-out -> $code (404 = server up; id 0 not found)"
