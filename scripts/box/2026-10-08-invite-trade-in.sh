#!/usr/bin/env bash
# Deals API: a trade-in attached to ONE dealer's invite.
#   rfq_invites.trade_in_json (MEDIUMTEXT — up to 6 compressed photos ride in it)
#   POST /api/rfqs/:id/invites/:inviteId/trade-in         { tradeIn }    buyer attaches / replaces it (allowance reset)
#   GET  /api/rfqs/:id/invites/:inviteId/trade-in                        full copy WITH photos (server-to-server)
#   POST /api/rfqs/:id/invites/:inviteId/trade-allowance  { allowance }  dealer's estimate; null clears it
# The invite JSON the buyer's browser eventually sees carries the trade-in WITHOUT photos
# (photoCount only), so the RFQ list payloads stay small.
#
# Anchored on the text 2026-09-13-buyer-counter.sh leaves behind. Box files drift from the repo
# mirrors, so the exact-replace asserts will refuse (and change nothing) if an anchor is missing.
#
# Run on the box as ubuntu:   bash 2026-10-08-invite-trade-in.sh
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

if "trade_in_json" not in s:
    rep('''  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS buyer_counter_at DATETIME NULL");''',
        '''  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS buyer_counter_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS trade_in_json MEDIUMTEXT NULL");''', "column")
    rep('''    buyerCounterAt: row.buyer_counter_at || null,''',
        '''    buyerCounterAt: row.buyer_counter_at || null,
    // The buyer's trade-in for this desk, photos stripped to a count (GET .../trade-in has them).
    tradeIn: publicTradeIn(parseJsonCol(row.trade_in_json)),''', "invite mapper")
    rep('''// POST /api/rfqs/:id/invites/:inviteId/buyer-counter — { counter }.''',
        '''function publicTradeIn(t) {
  if (!t || typeof t !== "object") return null;
  const { photos, ...rest } = t;
  return { ...rest, photoCount: Array.isArray(photos) ? photos.length : Number(t.photoCount) || 0 };
}

async function loadTradeInvite(pool, rfqId, inviteId) {
  const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rfqRows.length === 0) return { error: [404, "RFQ not found"] };
  const [inviteRows] = await pool.query("SELECT * FROM rfq_invites WHERE id = ? AND rfq_id = ?", [inviteId, rfqId]);
  if (inviteRows.length === 0) return { error: [404, "Invite not found"] };
  return { rfq: rfqRows[0], invite: inviteRows[0] };
}

// POST /api/rfqs/:id/invites/:inviteId/trade-in — { tradeIn }. Attaches (or replaces) this desk's trade-in;
// any earlier allowance is cleared because the car changed. Nothing about the quote itself moves.
async function handleInviteTradeIn(req, res, rfqId, inviteId) {
  const body = await readBody(req);
  const t = body.tradeIn && typeof body.tradeIn === "object" ? body.tradeIn : null;
  if (!t) return badRequest(res, "tradeIn is required");
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const loaded = await loadTradeInvite(pool, rfqId, inviteId);
  if (loaded.error) return sendJson(res, loaded.error[0], { error: loaded.error[1] });
  if (loaded.rfq.status !== "collecting") return sendJson(res, 409, { error: "closed" });
  if (loaded.invite.status === "declined") return sendJson(res, 409, { error: "This desk declined" });
  const stored = { ...t, allowance: null, allowanceAt: null, photoCount: Array.isArray(t.photos) ? t.photos.length : 0 };
  await pool.query("UPDATE rfq_invites SET trade_in_json = ? WHERE id = ?", [JSON.stringify(stored), inviteId]);
  const invites = await loadRfqInvitesWithQuotes(pool, rfqId);
  sendJson(res, 200, { rfq: publicRfqRequest(loaded.rfq, invites) });
}

// GET /api/rfqs/:id/invites/:inviteId/trade-in — the full trade-in, photos included.
async function handleInviteTradeInGet(req, res, rfqId, inviteId) {
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const loaded = await loadTradeInvite(pool, rfqId, inviteId);
  if (loaded.error) return sendJson(res, loaded.error[0], { error: loaded.error[1] });
  const t = parseJsonCol(loaded.invite.trade_in_json);
  if (!t) return sendJson(res, 404, { error: "No trade-in on this invite" });
  sendJson(res, 200, { tradeIn: { ...t, photoCount: Array.isArray(t.photos) ? t.photos.length : 0 } });
}

// POST /api/rfqs/:id/invites/:inviteId/trade-allowance — { allowance }. The dealer's estimate (null clears it).
// Works whether the desk is still invited or already quoted: it is a separate line, not a re-quote.
async function handleInviteTradeAllowance(req, res, rfqId, inviteId) {
  const body = await readBody(req);
  const a = body.allowance === null || body.allowance === undefined ? null : Number(body.allowance);
  if (a !== null && !(Number.isFinite(a) && a >= 0 && a <= 1000000)) return badRequest(res, "allowance must be 0 or more");
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const loaded = await loadTradeInvite(pool, rfqId, inviteId);
  if (loaded.error) return sendJson(res, loaded.error[0], { error: loaded.error[1] });
  if (loaded.rfq.status !== "collecting") return sendJson(res, 409, { error: "closed" });
  const t = parseJsonCol(loaded.invite.trade_in_json);
  if (!t) return sendJson(res, 409, { error: "No trade-in on this invite" });
  const next = { ...t, allowance: a, allowanceAt: a === null ? null : new Date().toISOString() };
  await pool.query("UPDATE rfq_invites SET trade_in_json = ? WHERE id = ?", [JSON.stringify(next), inviteId]);
  sendJson(res, 200, { ok: true, allowance: a });
}

// POST /api/rfqs/:id/invites/:inviteId/buyer-counter — { counter }.''', "handlers")
    rep('''  const rfqInviteCounterMatch = pathname.match(''',
        '''  const rfqInviteTradeInMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/invites\\/(\\d+)\\/trade-in$/);
  if (rfqInviteTradeInMatch && req.method === "POST") return run(handleInviteTradeIn, Number(rfqInviteTradeInMatch[1]), Number(rfqInviteTradeInMatch[2]));
  if (rfqInviteTradeInMatch && req.method === "GET") return run(handleInviteTradeInGet, Number(rfqInviteTradeInMatch[1]), Number(rfqInviteTradeInMatch[2]));
  const rfqInviteTradeAllowanceMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/invites\\/(\\d+)\\/trade-allowance$/);
  if (rfqInviteTradeAllowanceMatch && req.method === "POST") return run(handleInviteTradeAllowance, Number(rfqInviteTradeAllowanceMatch[1]), Number(rfqInviteTradeAllowanceMatch[2]));
  const rfqInviteCounterMatch = pathname.match(''', "routes")
open(p, "w").write(s)
print("patched:", p, "| applied:", ", ".join(changed) or "nothing (already present)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api
sleep 3
echo "--- process up? (401 = up, key required) ---"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3004/health
