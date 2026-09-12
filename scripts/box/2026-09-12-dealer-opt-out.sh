#!/usr/bin/env bash
# Deploys the dealer email opt-out to the auth API on the box. The Next.js
# unsubscribe link (app/api/dealer-unsubscribe) verifies its own HMAC token
# and then calls POST /api/dealerships/:id/opt-out here — which the box
# never received, so the click fell through to the generic 404.
#
# Run on the box as ubuntu:
#   bash 2026-09-12-dealer-opt-out.sh
#
# In order (each step idempotent — safe to re-run):
#   1. timestamped backup of auth_api_server.js
#   2. patches, each only if not already present:
#        - ensureDealerOptOutColumn(): ALTER TABLE dealership_contacts
#          ADD COLUMN IF NOT EXISTS email_opt_out TINYINT(1) NOT NULL DEFAULT 0
#        - publicDealership returns emailOptOut
#        - handleSetDealershipOptOut + the POST /api/dealerships/:id/opt-out route
#   3. node --check
#   4. sudo pm2 restart trimscout-auth-api
#   5. curl: the route must answer "Dealership not found" for id 0 (not the
#      generic "Not found"), and a listed row must carry emailOptOut: false
set -euo pipefail

FILE=/opt/trimscout-auth/src/auth_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
changed = []

def rep(old, new, label):
    global s
    n = s.count(old)
    assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:160]}"
    s = s.replace(old, new)
    changed.append(label)

# 1. column ensure — placed with the domains helpers (this box has them)
if "function ensureDealerOptOutColumn" not in s:
    rep('''let dealerDomainColumnsEnsured = false;''',
'''// Set only via the public unsubscribe link — never by an import or an edit.
let dealerOptOutColumnEnsured = false;
async function ensureDealerOptOutColumn(pool) {
  if (dealerOptOutColumnEnsured) return;
  await pool.query("ALTER TABLE dealership_contacts ADD COLUMN IF NOT EXISTS email_opt_out TINYINT(1) NOT NULL DEFAULT 0");
  dealerOptOutColumnEnsured = true;
}
let dealerDomainColumnsEnsured = false;''', "ensure column")

# 2. public shape
if "emailOptOut: Boolean(row.email_opt_out)" not in s:
    rep('''    domains: parseDomains(row.domains_json),
    createdAt: row.created_at,''',
'''    domains: parseDomains(row.domains_json),
    emailOptOut: Boolean(row.email_opt_out),
    createdAt: row.created_at,''', "mapper")

# 3. handler
if "async function handleSetDealershipOptOut" not in s:
    rep('''// GET /api/dealerships — full directory listing.
async function handleListDealerships(req, res) {''',
'''// POST /api/dealerships/:id/opt-out — a dealer clicked the unsubscribe link
// in an offer-notification email. Server-to-server only (the public
// unsubscribe link hits a Next.js route, which verifies the link's HMAC
// token itself before ever calling this) — deliberately one-directional,
// no "opt back in" here, since re-subscribing isn't something a stray
// forwarded link should be able to do.
async function handleSetDealershipOptOut(req, res, id) {
  const pool = getPool();
  await ensureDealerOptOutColumn(pool);
  const [result] = await pool.query("UPDATE dealership_contacts SET email_opt_out = 1 WHERE id = ?", [id]);
  if (result.affectedRows === 0) return sendJson(res, 404, { error: "Dealership not found" });
  const [rows] = await pool.query("SELECT * FROM dealership_contacts WHERE id = ?", [id]);
  sendJson(res, 200, { dealership: publicDealership(rows[0]) });
}

// GET /api/dealerships — full directory listing.
async function handleListDealerships(req, res) {''', "handler")

# 4. ensure the column before listing too, so every row carries the field
if "await ensureDealerOptOutColumn(pool);\n  const [rows] = await pool.query(\"SELECT * FROM dealership_contacts ORDER BY" not in s:
    rep('''  await ensureDealerDomainColumns(pool);
  const [rows] = await pool.query("SELECT * FROM dealership_contacts ORDER BY dealer_name ASC");''',
'''  await ensureDealerDomainColumns(pool);
  await ensureDealerOptOutColumn(pool);
  const [rows] = await pool.query("SELECT * FROM dealership_contacts ORDER BY dealer_name ASC");''', "list ensure")

# 5. route
if "/opt-out$/" not in s:
    rep('''
  sendJson(res, 404, { error: "Not found" });
});''',
'''  const optOutMatch = pathname.match(/^\\/api\\/dealerships\\/(\\d+)\\/opt-out$/);
  if (optOutMatch && req.method === "POST") {
    return run((request, response) => handleSetDealershipOptOut(request, response, optOutMatch[1]));
  }

  sendJson(res, 404, { error: "Not found" });
});''', "route")

open(p, "w").write(s)
print("patched:", p, "| applied:", ", ".join(changed) or "nothing (already present)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-auth-api
sleep 3
K=$(sudo grep -h '^TRIMSCOUT_API_KEY=' /opt/trimscout-auth/.env.trimscout-db /opt/trimscout-auth/src/.env.trimscout-db 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
echo "--- route check (expect: Dealership not found) ---"
curl -s -m 20 -X POST -H "X-Trimscout-Api-Key: $K" http://127.0.0.1:3003/api/dealerships/0/opt-out; echo
echo "--- field check (expect: emailOptOut false on a row, opted-out count 0) ---"
curl -s -m 120 -H "X-Trimscout-Api-Key: $K" http://127.0.0.1:3003/api/dealerships | python3 -c "
import json,sys; rows=json.load(sys.stdin)['dealerships']
print('rows', len(rows), '| have emailOptOut field:', sum(1 for r in rows if 'emailOptOut' in r), '| opted out:', sum(1 for r in rows if r.get('emailOptOut')))"
