#!/usr/bin/env bash
# Deals API: the trade-in on a quote request (fields + photo METADATA; photo bytes live in S3, never here).
#   rfq_requests.trade_in_json        MEDIUMTEXT  the buyer's trade-in record  (spec: trade_in + trade_photo[])
#   rfq_invites.trade_appraisal_json  TEXT        that desk's appraisal         (spec: dealer_trade_appraisal)
#   rfq_invites.trade_photo_request_json TEXT     that desk's ask for more photos (spec: trade_photo_request)
#   rfq_invites.trade_seen_at / trade_photos_notified_at   "one notice per change batch" bookkeeping
# The spec's four tables are modelled as JSON on the existing RFQ rows, like every other RFQ extension on this box;
# "dealer_quote_id" is the invite id (an appraisal must survive a re-quote after a counter).
#
#   POST /api/rfqs/:id/trade-in                         { tradeIn }  attach at send; refuses fewer than 6 required photos
#   PUT  /api/rfqs/:id/trade-in/photos                  { photos }   buyer replaced/added; refuses fewer than 6 required;
#                                                                    returns { rfq, notifyInviteIds } (one notice per batch)
#   POST /api/rfqs/:id/invites/:inviteId/trade-appraisal       { appraisal }
#   POST /api/rfqs/:id/invites/:inviteId/trade-photo-request   { photoRequest }  one open ask per desk
#   POST /api/rfqs/:id/trade-photo-requests/fulfil      { slots }    closes asks whose slots are now all present
#   POST /api/rfqs/:id/invites/:inviteId/trade-seen
#
# Run on the box as ubuntu:   bash 2026-10-08-rfq-trade-in.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart.
# Test against a copy of the repo mirror (no sudo, no pm2):  TEST_ONLY=1 FILE=/path/to/deals_api_server.js bash 2026-10-08-rfq-trade-in.sh
set -euo pipefail
FILE="${FILE:-/opt/trimscout-deals/src/deals_api_server.js}"
STAMP=$(date +%Y%m%d-%H%M%S)
SUDO="sudo"; [ "${TEST_ONLY:-0}" = "1" ] && SUDO=""
if [ "${TEST_ONLY:-0}" != "1" ]; then
  sudo cp "$FILE" "$FILE.bak.$STAMP"
  echo "backup: $FILE.bak.$STAMP"
fi

$SUDO python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:160]}"
    s = s.replace(old, new); changed.append(label)

if "trade_photo_request_json" not in s:
    rep('''  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS buyer_counter_at DATETIME NULL");''',
        '''  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS buyer_counter_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS trade_in_json MEDIUMTEXT NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS trade_appraisal_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS trade_photo_request_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS trade_seen_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS trade_photos_notified_at DATETIME NULL");''', "columns")
    rep('''    buyerCounterAt: row.buyer_counter_at || null,''',
        '''    buyerCounterAt: row.buyer_counter_at || null,
    // Trade-in: this desk's appraisal and its (single) ask for more photos.
    tradeAppraisal: parseJsonCol(row.trade_appraisal_json) || null,
    tradePhotoRequest: parseJsonCol(row.trade_photo_request_json) || null,
    tradeSeenAt: row.trade_seen_at || null,
    tradePhotosNotifiedAt: row.trade_photos_notified_at || null,''', "invite mapper")
    rep('''    tradeInExpected: row.trade_in_expected == null ? null : Boolean(row.trade_in_expected),''',
        '''    tradeInExpected: row.trade_in_expected == null ? null : Boolean(row.trade_in_expected),
    // The buyer's trade-in: fields + photo metadata (bytes are in S3, served only through signed URLs).
    tradeIn: parseJsonCol(row.trade_in_json) || null,''', "request mapper")
    rep('''// POST /api/rfqs/:id/invites/:inviteId/buyer-counter — { counter }.''',
        '''const TRADE_REQUIRED_SLOTS = ["front", "rear", "driver_side", "passenger_side", "odometer", "interior"];
const TRADE_OPTIONAL_SLOTS = ["rear_cargo", "tire_tread", "damage_1", "damage_2", "damage_3", "damage_4"];

// The same rule the Next.js route enforces, repeated here so no client can skip it: every required photo present,
// once each, every key under trade/{rfqId}/.
function tradePhotosProblem(rfqId, photos) {
  if (!Array.isArray(photos) || photos.length > TRADE_REQUIRED_SLOTS.length + TRADE_OPTIONAL_SLOTS.length) return "photos must be a list of at most 12";
  const seen = new Set();
  for (const p of photos) {
    if (!p || typeof p.slot !== "string") return "every photo needs a slot";
    if (!TRADE_REQUIRED_SLOTS.includes(p.slot) && !TRADE_OPTIONAL_SLOTS.includes(p.slot)) return "unknown photo slot " + p.slot;
    if (seen.has(p.slot)) return "duplicate photo slot " + p.slot;
    seen.add(p.slot);
    if (typeof p.storageKey !== "string" || !p.storageKey.startsWith("trade/" + rfqId + "/")) return "photo key is outside this request";
  }
  const missing = TRADE_REQUIRED_SLOTS.filter((s) => !seen.has(s));
  if (missing.length) return "all 6 required photos are needed — missing " + missing.join(", ");
  return null;
}

async function loadTradeRfq(pool, rfqId) {
  const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  return rfqRows[0] || null;
}

// POST /api/rfqs/:id/trade-in — { tradeIn }. Called right after the request is created.
async function handleRfqTradeIn(req, res, rfqId) {
  const body = await readBody(req, 2_000_000);
  const t = body.tradeIn && typeof body.tradeIn === "object" ? body.tradeIn : null;
  if (!t) return badRequest(res, "tradeIn is required");
  const problem = tradePhotosProblem(rfqId, t.photos);
  if (problem) return sendJson(res, 422, { error: problem });
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const rfq = await loadTradeRfq(pool, rfqId);
  if (!rfq) return sendJson(res, 404, { error: "RFQ not found" });
  if (rfq.status !== "collecting") return sendJson(res, 409, { error: "closed" });
  await pool.query("UPDATE rfq_requests SET trade_in_json = ?, trade_in_expected = 1 WHERE id = ?", [JSON.stringify(t), rfqId]);
  const fresh = await loadTradeRfq(pool, rfqId);
  const invites = await loadRfqInvitesWithQuotes(pool, rfqId);
  sendJson(res, 200, { rfq: publicRfqRequest(fresh, invites) });
}

// PUT /api/rfqs/:id/trade-in/photos — { photos }. Replace/add until the buyer picks. One notice per change batch:
// a desk is owed one if it was never told, or has looked at the trade since the last notice.
async function handleRfqTradePhotos(req, res, rfqId) {
  const body = await readBody(req, 1_000_000);
  const problem = tradePhotosProblem(rfqId, body.photos);
  if (problem) return sendJson(res, 422, { error: problem });
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const rfq = await loadTradeRfq(pool, rfqId);
  if (!rfq) return sendJson(res, 404, { error: "RFQ not found" });
  if (rfq.status !== "collecting") return sendJson(res, 409, { error: "closed" });
  const current = parseJsonCol(rfq.trade_in_json);
  if (!current) return sendJson(res, 409, { error: "This request has no trade-in" });
  const next = { ...current, photos: body.photos, updatedAt: new Date().toISOString(), photosChangedAt: new Date().toISOString() };
  await pool.query("UPDATE rfq_requests SET trade_in_json = ? WHERE id = ?", [JSON.stringify(next), rfqId]);
  const [inviteRows] = await pool.query("SELECT id, status, trade_seen_at, trade_photos_notified_at FROM rfq_invites WHERE rfq_id = ?", [rfqId]);
  const owed = inviteRows.filter((r) => r.status !== "declined" && (!r.trade_photos_notified_at || (r.trade_seen_at && new Date(r.trade_seen_at) >= new Date(r.trade_photos_notified_at))));
  for (const r of owed) await pool.query("UPDATE rfq_invites SET trade_photos_notified_at = NOW() WHERE id = ?", [r.id]);
  const fresh = await loadTradeRfq(pool, rfqId);
  const invites = await loadRfqInvitesWithQuotes(pool, rfqId);
  sendJson(res, 200, { rfq: publicRfqRequest(fresh, invites), notifyInviteIds: owed.map((r) => String(r.id)) });
}

async function loadTradeInvite(pool, rfqId, inviteId) {
  const rfq = await loadTradeRfq(pool, rfqId);
  if (!rfq) return { error: [404, "RFQ not found"] };
  const [rows] = await pool.query("SELECT * FROM rfq_invites WHERE id = ? AND rfq_id = ?", [inviteId, rfqId]);
  if (rows.length === 0) return { error: [404, "Invite not found"] };
  if (!parseJsonCol(rfq.trade_in_json)) return { error: [409, "This request has no trade-in"] };
  if (rfq.status !== "collecting") return { error: [409, "closed"] };
  if (rows[0].status === "declined") return { error: [409, "This desk declined"] };
  return { rfq, invite: rows[0] };
}

// POST /api/rfqs/:id/invites/:inviteId/trade-appraisal — { appraisal }. Works while the desk is invited or already quoted.
async function handleTradeAppraisal(req, res, rfqId, inviteId) {
  const body = await readBody(req);
  const a = body.appraisal && typeof body.appraisal === "object" ? body.appraisal : null;
  if (!a) return badRequest(res, "appraisal is required");
  const single = a.allowanceSingle == null ? null : Number(a.allowanceSingle);
  const low = a.allowanceLow == null ? null : Number(a.allowanceLow);
  const high = a.allowanceHigh == null ? null : Number(a.allowanceHigh);
  const okSingle = single !== null && Number.isFinite(single) && single > 0 && low === null && high === null;
  const okRange = single === null && low !== null && high !== null && low > 0 && high >= low;
  if (!okSingle && !okRange) return badRequest(res, "allowance must be greater than 0 (a single number or a low/high range)");
  if (!["preliminary", "firm"].includes(a.basis)) return badRequest(res, "basis must be preliminary or firm");
  if (!a.goodUntil || Number.isNaN(new Date(a.goodUntil).getTime())) return badRequest(res, "goodUntil is required");
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const loaded = await loadTradeInvite(pool, rfqId, inviteId);
  if (loaded.error) return sendJson(res, loaded.error[0], { error: loaded.error[1] });
  await pool.query("UPDATE rfq_invites SET trade_appraisal_json = ? WHERE id = ?", [JSON.stringify(a), inviteId]);
  sendJson(res, 200, { ok: true });
}

// POST /api/rfqs/:id/invites/:inviteId/trade-photo-request — { photoRequest }. One open ask per desk.
async function handleTradePhotoRequest(req, res, rfqId, inviteId) {
  const body = await readBody(req);
  const r = body.photoRequest && typeof body.photoRequest === "object" ? body.photoRequest : null;
  if (!r) return badRequest(res, "photoRequest is required");
  const slots = Array.isArray(r.slots) ? r.slots : [];
  if (!slots.every((x) => TRADE_OPTIONAL_SLOTS.includes(x))) return badRequest(res, "only optional photo slots can be requested");
  if (!slots.length && !(typeof r.note === "string" && r.note.trim())) return badRequest(res, "pick a slot or add a note");
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const loaded = await loadTradeInvite(pool, rfqId, inviteId);
  if (loaded.error) return sendJson(res, loaded.error[0], { error: loaded.error[1] });
  const existing = parseJsonCol(loaded.invite.trade_photo_request_json);
  if (existing && existing.status === "open") return sendJson(res, 409, { error: "This desk already has an open photo request" });
  await pool.query("UPDATE rfq_invites SET trade_photo_request_json = ? WHERE id = ?", [JSON.stringify({ ...r, slots, status: "open", fulfilledAt: null }), inviteId]);
  sendJson(res, 200, { ok: true });
}

// POST /api/rfqs/:id/trade-photo-requests/fulfil — { slots }. After the buyer changed these slots, close every open ask
// whose requested slots are now all present (a note-only ask closes on any photo change).
async function handleTradePhotoRequestsFulfil(req, res, rfqId) {
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const rfq = await loadTradeRfq(pool, rfqId);
  if (!rfq) return sendJson(res, 404, { error: "RFQ not found" });
  const trade = parseJsonCol(rfq.trade_in_json);
  if (!trade) return sendJson(res, 409, { error: "This request has no trade-in" });
  const have = new Set((trade.photos || []).map((p) => p.slot));
  const [rows] = await pool.query("SELECT id, trade_photo_request_json FROM rfq_invites WHERE rfq_id = ? AND trade_photo_request_json IS NOT NULL", [rfqId]);
  let closed = 0;
  for (const r of rows) {
    const pr = parseJsonCol(r.trade_photo_request_json);
    if (!pr || pr.status !== "open") continue;
    const slots = Array.isArray(pr.slots) ? pr.slots : [];
    if (slots.every((s) => have.has(s))) {
      await pool.query("UPDATE rfq_invites SET trade_photo_request_json = ? WHERE id = ?", [JSON.stringify({ ...pr, status: "fulfilled", fulfilledAt: new Date().toISOString() }), r.id]);
      closed++;
    }
  }
  sendJson(res, 200, { ok: true, closed });
}

// POST /api/rfqs/:id/invites/:inviteId/trade-seen — the desk opened the trade; the next photo change earns a fresh notice.
async function handleTradeSeen(req, res, rfqId, inviteId) {
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  await pool.query("UPDATE rfq_invites SET trade_seen_at = NOW() WHERE id = ? AND rfq_id = ?", [inviteId, rfqId]);
  sendJson(res, 200, { ok: true });
}

// POST /api/rfqs/:id/invites/:inviteId/buyer-counter — { counter }.''', "handlers")
    rep('''  const rfqInviteCounterMatch = pathname.match(''',
        '''  const rfqTradeInMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/trade-in$/);
  if (req.method === "POST" && rfqTradeInMatch) return run(handleRfqTradeIn, Number(rfqTradeInMatch[1]));
  const rfqTradePhotosMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/trade-in\\/photos$/);
  if (req.method === "PUT" && rfqTradePhotosMatch) return run(handleRfqTradePhotos, Number(rfqTradePhotosMatch[1]));
  const rfqTradeFulfilMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/trade-photo-requests\\/fulfil$/);
  if (req.method === "POST" && rfqTradeFulfilMatch) return run(handleTradePhotoRequestsFulfil, Number(rfqTradeFulfilMatch[1]));
  const rfqInviteTradeMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/invites\\/(\\d+)\\/(trade-appraisal|trade-photo-request|trade-seen)$/);
  if (req.method === "POST" && rfqInviteTradeMatch) {
    const fn = { "trade-appraisal": handleTradeAppraisal, "trade-photo-request": handleTradePhotoRequest, "trade-seen": handleTradeSeen }[rfqInviteTradeMatch[3]];
    return run(fn, Number(rfqInviteTradeMatch[1]), Number(rfqInviteTradeMatch[2]));
  }
  const rfqInviteCounterMatch = pathname.match(''', "routes")
open(p, "w").write(s)
print("patched:", p, "| applied:", ", ".join(changed) or "nothing (already present)")
PY

node --check "$FILE" && echo "syntax ok"
if [ "${TEST_ONLY:-0}" != "1" ]; then
  sudo pm2 restart trimscout-deals-api
  sleep 3
  echo "--- process up? (401 = up, key required) ---"
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3004/health
fi
