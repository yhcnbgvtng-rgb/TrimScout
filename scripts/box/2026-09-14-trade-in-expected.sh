#!/usr/bin/env bash
# Deals API: rfq_requests.trade_in_expected — whether the buyer said a
# trade-in is coming (handled after the OTD price is agreed; never part of
# the quote). Accepted on POST /api/rfqs, returned as rfq.tradeInExpected.
#
# Run on the deals box (ubuntu@3.208.49.1):
#   bash 2026-09-14-trade-in-expected.sh
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

if "trade_in_expected" not in s:
    rep('''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS buyer_note VARCHAR(1000) NULL");''',
        '''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS buyer_note VARCHAR(1000) NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS trade_in_expected TINYINT(1) NULL");''', "column")
    rep('''    buyerNote: row.buyer_note || null,''',
        '''    buyerNote: row.buyer_note || null,
    // Buyer said a trade-in is coming — handled after the OTD price, never in the quote.
    tradeInExpected: row.trade_in_expected == null ? null : Boolean(row.trade_in_expected),''', "rfq mapper")
    rep('''  const buyerNote = typeof body.buyerNote === "string" && body.buyerNote.trim() ? body.buyerNote.trim().slice(0, 1000) : null;''',
        '''  const buyerNote = typeof body.buyerNote === "string" && body.buyerNote.trim() ? body.buyerNote.trim().slice(0, 1000) : null;
  const tradeInExpected = typeof body.tradeInExpected === "boolean" ? (body.tradeInExpected ? 1 : 0) : null;''', "rfq body")
    rep('''    `INSERT INTO rfq_requests (buyer_user_id, vin, stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, must_haves_json, status, package_kind, link_pastes_json, deal_reference, lease_prefs_json, quote_prefs_json, buyer_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collecting', ?, ?, ?, ?, ?, ?)`,
    [buyerUserId, vin, stockNumber, vehicleYear, vehicleMake, vehicleModel, vehicleTrim, JSON.stringify(mustHaves), packageKind, linkPastes.length ? JSON.stringify(linkPastes) : null, dealReference, body.leasePrefs && typeof body.leasePrefs === "object" ? JSON.stringify(body.leasePrefs) : null, body.quotePrefs && typeof body.quotePrefs === "object" ? JSON.stringify(body.quotePrefs) : null, buyerNote]''',
        '''    `INSERT INTO rfq_requests (buyer_user_id, vin, stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, must_haves_json, status, package_kind, link_pastes_json, deal_reference, lease_prefs_json, quote_prefs_json, buyer_note, trade_in_expected)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collecting', ?, ?, ?, ?, ?, ?, ?)`,
    [buyerUserId, vin, stockNumber, vehicleYear, vehicleMake, vehicleModel, vehicleTrim, JSON.stringify(mustHaves), packageKind, linkPastes.length ? JSON.stringify(linkPastes) : null, dealReference, body.leasePrefs && typeof body.leasePrefs === "object" ? JSON.stringify(body.leasePrefs) : null, body.quotePrefs && typeof body.quotePrefs === "object" ? JSON.stringify(body.quotePrefs) : null, buyerNote, tradeInExpected]''', "rfq insert")
open(p, "w").write(s)
print("patched:", p, "| applied:", ", ".join(changed) or "nothing (already present)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api
sleep 3
echo "--- process up? (401 = up, key required) ---"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3004/health
