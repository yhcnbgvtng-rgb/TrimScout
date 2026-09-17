#!/usr/bin/env bash
# Deals API: quote intent lane (2026-09-17). rfq_requests.lane ('same_spec' | 'alternate') + alternate_ask_json;
# the alternate lane needs no VIN / year / make / link (vin defaults to ''). Invites on it carry no vehicle —
# the dealer names the VIN they propose when they quote.
#
# Run on the deals box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-17-rfq-lane.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-17-rfq-lane.sh && bash 2026-09-17-rfq-lane.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart, health check.
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
    if new in s: return
    s = s.replace(old, new); changed.append(label)

rep('''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS admin_edits_json TEXT NULL");''',
'''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS admin_edits_json TEXT NULL");
  // Quote intent (2026-09-17): same_spec = this VIN/build; alternate = open to other vehicles, no VIN required.
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS lane VARCHAR(16) NOT NULL DEFAULT 'same_spec'");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS alternate_ask_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_requests MODIFY vin VARCHAR(17) NOT NULL DEFAULT ''");''', "lane columns")

rep('''    // Admin gate: 'pending' until an admin releases it, 'approved' (released), or 'rejected' (reason to the buyer).
    approvalStatus: row.approval_status || "approved",''',
'''    // same_spec (this VIN/build) or alternate (open to other vehicles — no VIN; every quote is an alternate).
    lane: row.lane || "same_spec",
    alternateAsk: parseJsonCol(row.alternate_ask_json) || null,
    // Admin gate: 'pending' until an admin releases it, 'approved' (released), or 'rejected' (reason to the buyer).
    approvalStatus: row.approval_status || "approved",''', "serializer")

rep('''  if (!buyerUserId) return badRequest(res, "buyerUserId is required");
  if (!vin) return badRequest(res, "vin is required");
  if (!Number.isFinite(vehicleYear) || vehicleYear <= 0) return badRequest(res, "Invalid vehicleYear");
  if (!vehicleMake || !vehicleModel) return badRequest(res, "vehicleMake and vehicleModel are required");
  if (packageKind === "match") {''',
'''  const lane = body.lane === "alternate" ? "alternate" : "same_spec";
  const alternateAsk = lane === "alternate" && body.alternateAsk && typeof body.alternateAsk === "object" ? body.alternateAsk : null;

  if (!buyerUserId) return badRequest(res, "buyerUserId is required");
  // The alternate lane quotes an ask, not a VIN: no VIN, year, make/model or link required.
  if (lane === "same_spec") {
    if (!vin) return badRequest(res, "vin is required");
    if (!Number.isFinite(vehicleYear) || vehicleYear <= 0) return badRequest(res, "Invalid vehicleYear");
    if (!vehicleMake || !vehicleModel) return badRequest(res, "vehicleMake and vehicleModel are required");
  }
  if (lane === "alternate") {
    if (!alternateAsk) return badRequest(res, "alternateAsk is required on the alternate lane");
  } else if (packageKind === "match") {''', "create: lane validation")

rep('''    `INSERT INTO rfq_requests (buyer_user_id, vin, stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, must_haves_json, status, package_kind, link_pastes_json, deal_reference, lease_prefs_json, quote_prefs_json, buyer_note, trade_in_expected, approval_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collecting', ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [buyerUserId, vin, stockNumber, vehicleYear, vehicleMake, vehicleModel, vehicleTrim, JSON.stringify(mustHaves), packageKind, linkPastes.length ? JSON.stringify(linkPastes) : null, dealReference, body.leasePrefs && typeof body.leasePrefs === "object" ? JSON.stringify(body.leasePrefs) : null, body.quotePrefs && typeof body.quotePrefs === "object" ? JSON.stringify(body.quotePrefs) : null, buyerNote, tradeInExpected]''',
'''    `INSERT INTO rfq_requests (buyer_user_id, vin, stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, must_haves_json, status, package_kind, link_pastes_json, deal_reference, lease_prefs_json, quote_prefs_json, buyer_note, trade_in_expected, approval_status, lane, alternate_ask_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collecting', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [buyerUserId, vin || "", stockNumber, Number.isFinite(vehicleYear) && vehicleYear > 0 ? vehicleYear : 0, vehicleMake || (lane === "alternate" ? "Open" : ""), vehicleModel || (lane === "alternate" ? "to alternatives" : ""), vehicleTrim, JSON.stringify(mustHaves), packageKind, linkPastes.length ? JSON.stringify(linkPastes) : null, dealReference, body.leasePrefs && typeof body.leasePrefs === "object" ? JSON.stringify(body.leasePrefs) : null, body.quotePrefs && typeof body.quotePrefs === "object" ? JSON.stringify(body.quotePrefs) : null, buyerNote, tradeInExpected, lane, alternateAsk ? JSON.stringify(alternateAsk) : null]''', "create: insert lane")

# Invite creation: the alternate lane has no vehicle; the dealer proposes one in their quote.
rep('''  if (!dealerName) return badRequest(res, "dealerName is required");

  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rfqRows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });

  const [activeRows] = await pool.query(''',
'''  if (!dealerName) return badRequest(res, "dealerName is required");

  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rfqRows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });
  // Alternate lane: no car on the invite — the dealer names the VIN they propose when they quote.
  const inviteVehicle = (rfqRows[0].lane || "same_spec") === "alternate" && vehicle && !vehicle.vin ? null : vehicle;

  const [activeRows] = await pool.query(''', "invite: alternate vehicle")
rep('''    [rfqId, dealerName, dealerContactEmail, desk ? JSON.stringify(desk) : null, vehicle ? JSON.stringify(vehicle) : null, viewToken]''',
'''    [rfqId, dealerName, dealerContactEmail, desk ? JSON.stringify(desk) : null, inviteVehicle ? JSON.stringify(inviteVehicle) : null, viewToken]''', "invite: store vehicle")

open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3004/api/rfqs?all=1&approval=pending")
echo "GET /api/rfqs?all=1&approval=pending without key -> $code (401 = server up and guarding)"
