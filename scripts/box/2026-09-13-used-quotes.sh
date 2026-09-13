#!/usr/bin/env bash
# Deals API: used-car Finance / Cash requests and quotes.
#   rfq_requests.quote_prefs_json — the buyer's ask when it isn't a lease
#     ({ quoteType: "finance" | "cash", finance?: {...}, cash?: {...} }).
#   rfq_quotes.used_json — the dealer's structured used Finance / Cash
#     sheet (validated by the Next.js route), stored whole like lease_json.
#
# Run on the box as ubuntu:
#   bash 2026-09-13-used-quotes.sh
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

if "quote_prefs_json" not in s:
    rep('''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS lease_prefs_json TEXT NULL");''',
        '''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS lease_prefs_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS quote_prefs_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS used_json TEXT NULL");''', "columns")
    rep('''    leasePrefs: parseJsonCol(row.lease_prefs_json) || null,''', '''    leasePrefs: parseJsonCol(row.lease_prefs_json) || null,
    // Finance / cash ask (used cars); null on lease requests.
    quotePrefs: parseJsonCol(row.quote_prefs_json) || null,''', "rfq mapper")
    rep('''    lease: typeof row.lease_json === "string" ? JSON.parse(row.lease_json) : row.lease_json || null,''',
        '''    lease: typeof row.lease_json === "string" ? JSON.parse(row.lease_json) : row.lease_json || null,
    used: typeof row.used_json === "string" ? JSON.parse(row.used_json) : row.used_json || null,''', "quote mapper")
    rep('''    `INSERT INTO rfq_requests (buyer_user_id, vin, stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, must_haves_json, status, package_kind, link_pastes_json, deal_reference, lease_prefs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collecting', ?, ?, ?, ?)`,
    [buyerUserId, vin, stockNumber, vehicleYear, vehicleMake, vehicleModel, vehicleTrim, JSON.stringify(mustHaves), packageKind, linkPastes.length ? JSON.stringify(linkPastes) : null, dealReference, body.leasePrefs && typeof body.leasePrefs === "object" ? JSON.stringify(body.leasePrefs) : null]''',
        '''    `INSERT INTO rfq_requests (buyer_user_id, vin, stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, must_haves_json, status, package_kind, link_pastes_json, deal_reference, lease_prefs_json, quote_prefs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collecting', ?, ?, ?, ?, ?)`,
    [buyerUserId, vin, stockNumber, vehicleYear, vehicleMake, vehicleModel, vehicleTrim, JSON.stringify(mustHaves), packageKind, linkPastes.length ? JSON.stringify(linkPastes) : null, dealReference, body.leasePrefs && typeof body.leasePrefs === "object" ? JSON.stringify(body.leasePrefs) : null, body.quotePrefs && typeof body.quotePrefs === "object" ? JSON.stringify(body.quotePrefs) : null]''', "rfq insert")
    rep('''  const leaseJson = body.lease && typeof body.lease === "object" ? JSON.stringify(body.lease) : null;''',
        '''  const leaseJson = body.lease && typeof body.lease === "object" ? JSON.stringify(body.lease) : null;
  const usedJson = body.used && typeof body.used === "object" ? JSON.stringify(body.used) : null;''', "quote body")
    rep('''      `INSERT INTO rfq_quotes (rfq_id, invite_id, dealer_name, price, fees_json, total_otd_price, vin, stock_number, expires_at, must_have_acknowledgement, notes, lease_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rfqId, inviteId, inviteRows[0].dealer_name, price, JSON.stringify(fees), totalOtdPrice, vin, stockNumber, new Date(expiresAt), mustHaveAcknowledgement, notes, leaseJson]''',
        '''      `INSERT INTO rfq_quotes (rfq_id, invite_id, dealer_name, price, fees_json, total_otd_price, vin, stock_number, expires_at, must_have_acknowledgement, notes, lease_json, used_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rfqId, inviteId, inviteRows[0].dealer_name, price, JSON.stringify(fees), totalOtdPrice, vin, stockNumber, new Date(expiresAt), mustHaveAcknowledgement, notes, leaseJson, usedJson]''', "quote insert")
open(p, "w").write(s)
print("patched:", p, "| applied:", ", ".join(changed) or "nothing (already present)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api
sleep 3
echo "--- process up? (401 = up, key required) ---"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3004/health
