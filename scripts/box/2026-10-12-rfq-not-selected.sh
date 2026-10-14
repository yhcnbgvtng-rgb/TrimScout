#!/usr/bin/env bash
# Deals API: when the buyer accepts one dealer, the other invited dealers' quotes close, and the accepted dealer can still
# be asked for a trade-in value ("Add your trade-in" after acceptance).
#   rfq_invites.not_selected_at                 DATETIME  this desk's quote is closed (buyer chose another dealer)
#   rfq_invites.not_selected_notice_claimed_at  DATETIME  the one-time right to send the "not selected this time" note
#   rfq_invites.not_selected_notice_sent_at     DATETIME  the note went out; never claimable again (exactly once)
#   POST /api/rfqs/:id/invites/:inviteId/not-selected { step: close | claim | sent | release }   (src/rfqNotSelected.js)
#   publicRfqInvite gains notSelectedAt / notSelectedNoticeClaimedAt / notSelectedNoticeSentAt.
#   Refused with 409 for a closed (not selected) desk: new quotes, buyer counters, picks, stage moves other than walking away.
#   Trade-in after acceptance (needs 2026-10-08-rfq-trade-in.sh; skipped with a notice on a box without it):
#     POST /api/rfqs/:id/trade-in           also works on a request already "picked", while it has no trade-in yet
#     trade appraisal / photo request       also work on a "picked" request for the desk that owns the picked quote
#
# Also installs the updated dealStages.js (add_trade / skip_trade) and rfqStages.js (closed-quote refusal) next to the server.
# Order on the box: 2026-10-08-rfq-trade-in.sh, 2026-10-11-rfq-deal-stages.sh, then this one (each idempotent).
# DO NOT run during the nightly inventory sync (the restart drops in-flight sync requests): the guard below refuses.
# Run on the deals box (box2) as ubuntu, in an idle window, ON PAUL'S GO:
#   curl -fsSL -o 2026-10-12-rfq-not-selected.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-12-rfq-not-selected.sh && bash 2026-10-12-rfq-not-selected.sh
# Idempotent. Backup, copy modules, exact-replace with asserts, node --check, pm2 restart.
# Test against a copy of the repo mirror (no sudo, no pm2, no copying):
#   TEST_ONLY=1 FILE=/path/to/deals_api_server.js bash 2026-10-12-rfq-not-selected.sh
set -euo pipefail
FILE="${FILE:-/opt/trimscout-deals/src/deals_api_server.js}"
SRC_BASE="${SRC_BASE:-https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scrapers/lightsail-crawler/src}"
STAMP=$(date +%Y%m%d-%H%M%S)
SUDO="sudo"; [ "${TEST_ONLY:-0}" = "1" ] && SUDO=""
if [ "${TEST_ONLY:-0}" != "1" ]; then
  if pgrep -f inventory-sync.mjs >/dev/null && [ "${FORCE:-0}" != "1" ]; then
    echo "inventory-sync is running; wait for it to finish (or rerun with FORCE=1). Nothing changed."; exit 1
  fi
  DIR=$(dirname "$FILE")
  sudo cp "$FILE" "$FILE.bak.$STAMP"
  echo "backup: $FILE.bak.$STAMP"
  for m in rfqNotSelected.js dealStages.js rfqStages.js; do
    tmp=$(mktemp --suffix=.js); curl -fsSL -o "$tmp" "$SRC_BASE/$m"; node --check "$tmp"
    sudo install -m 0644 "$tmp" "$DIR/$m"; rm -f "$tmp"; echo "installed $DIR/$m"
  done
fi

$SUDO python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:160]}"
    s = s.replace(old, new); changed.append(label)

if "createRfqNotSelectedHandler" not in s:
    assert "createRfqStageHandler" in s, "apply 2026-10-11-rfq-deal-stages.sh first (its import line is this patch's anchor)"
    rep('''import { createRfqStageHandler } from "./rfqStages.js";''',
        '''import { createRfqStageHandler } from "./rfqStages.js";
import { createRfqNotSelectedHandler } from "./rfqNotSelected.js";''', "import")
    rep('''  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS stage_json TEXT NULL");''',
        '''  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS stage_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS not_selected_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS not_selected_notice_claimed_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS not_selected_notice_sent_at DATETIME NULL");''', "columns")
    rep('''    stage: parseJsonCol(row.stage_json) || null,''',
        '''    stage: parseJsonCol(row.stage_json) || null,
    // The buyer accepted a different dealer: this desk's quote is closed, and the one "not selected" note is tracked here.
    notSelectedAt: row.not_selected_at || null,
    notSelectedNoticeClaimedAt: row.not_selected_notice_claimed_at || null,
    notSelectedNoticeSentAt: row.not_selected_notice_sent_at || null,''', "invite mapper")
    rep('''// POST /api/rfqs/:id/invites/:inviteId/stage — one action on the staged Cash / Finance deal (rules: dealStages.js).''',
        '''// POST /api/rfqs/:id/invites/:inviteId/not-selected — close a desk's quote after the buyer accepted another dealer.
const handleRfqNotSelected = createRfqNotSelectedHandler({
  getPool, readBody, sendJson,
  ensureColumns: ensureQuotePackageColumns,
  logRfqEvent,
});

// POST /api/rfqs/:id/invites/:inviteId/stage — one action on the staged Cash / Finance deal (rules: dealStages.js).''', "handler")
    rep('''  const rfqInviteStageMatch = pathname.match(''',
        '''  const rfqInviteNotSelectedMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/invites\\/(\\d+)\\/not-selected$/);
  if (req.method === "POST" && rfqInviteNotSelectedMatch) {
    return run(handleRfqNotSelected, Number(rfqInviteNotSelectedMatch[1]), Number(rfqInviteNotSelectedMatch[2]));
  }
  const rfqInviteStageMatch = pathname.match(''', "route")
    # A closed desk can no longer counter, submit or revise a quote, or be picked.
    rep('''  if (inviteRows[0].status !== "quoted") return sendJson(res, 409, { error: "This desk has no current quote to counter" });''',
        '''  if (inviteRows[0].status !== "quoted") return sendJson(res, 409, { error: "This desk has no current quote to counter" });
  if (inviteRows[0].not_selected_at) return sendJson(res, 409, { error: "closed", code: "not_selected" });''', "counter refusal")
    rep('''  const mustHaves = typeof rfqRows[0].must_haves_json === "string" ? JSON.parse(rfqRows[0].must_haves_json) : rfqRows[0].must_haves_json;

  // Required fields (price, itemized fees, VIN/stock, expiry) are a hard''',
        '''  const mustHaves = typeof rfqRows[0].must_haves_json === "string" ? JSON.parse(rfqRows[0].must_haves_json) : rfqRows[0].must_haves_json;
  {
    const [closedRows] = await pool.query("SELECT not_selected_at FROM rfq_invites WHERE id = ? AND rfq_id = ?", [inviteId, rfqId]);
    if (closedRows[0] && closedRows[0].not_selected_at) return sendJson(res, 409, { error: "The buyer chose another dealer, so this quote is closed", code: "not_selected" });
  }

  // Required fields (price, itemized fees, VIN/stock, expiry) are a hard''', "quote refusal")
    rep('''  if (quoteRows.length === 0) return sendJson(res, 404, { error: "Quote not found on this RFQ" });''',
        '''  if (quoteRows.length === 0) return sendJson(res, 404, { error: "Quote not found on this RFQ" });
  {
    const [pickInvite] = await pool.query("SELECT i.not_selected_at FROM rfq_invites i JOIN rfq_quotes q ON q.invite_id = i.id WHERE q.id = ?", [quoteId]);
    if (pickInvite[0] && pickInvite[0].not_selected_at) return badRequest(res, "That dealer's quote is closed");
  }''', "pick refusal")

# Trade-in after acceptance: anchors live in the code the 2026-10-08 trade-in patch installed.
if "handleRfqTradeIn" in s and "TRADE_AFTER_ACCEPT" not in s:
    rep('''  if (rfq.status !== "collecting") return sendJson(res, 409, { error: "closed" });
  await pool.query("UPDATE rfq_requests SET trade_in_json = ?, trade_in_expected = 1 WHERE id = ?", [JSON.stringify(t), rfqId]);''',
        '''  // TRADE_AFTER_ACCEPT: a trade-in may also be added once, after the buyer accepted a dealer ("picked"), never after a walk-away.
  if (rfq.status !== "collecting" && !(rfq.status === "picked" && !parseJsonCol(rfq.trade_in_json))) return sendJson(res, 409, { error: "closed" });
  await pool.query("UPDATE rfq_requests SET trade_in_json = ?, trade_in_expected = 1 WHERE id = ?", [JSON.stringify(t), rfqId]);''', "trade attach after pick")
    rep('''  if (rfq.status !== "collecting") return { error: [409, "closed"] };
  if (rows[0].status === "declined") return { error: [409, "This desk declined"] };''',
        '''  if (rows[0].not_selected_at) return { error: [409, "The buyer chose another dealer"] };
  if (rfq.status !== "collecting") {
    // After acceptance only the desk that owns the picked quote may appraise.
    const [pq] = rfq.status === "picked" && rfq.picked_quote_id != null ? await pool.query("SELECT invite_id FROM rfq_quotes WHERE id = ?", [rfq.picked_quote_id]) : [[]];
    if (!(pq[0] && String(pq[0].invite_id) === String(rows[0].id))) return { error: [409, "closed"] };
  }
  if (rows[0].status === "declined") return { error: [409, "This desk declined"] };''', "trade appraisal after pick")
elif "handleRfqTradeIn" not in s:
    print("NOTE: the trade-in patch (2026-10-08-rfq-trade-in.sh) is not on this server: trade-in-after-acceptance is skipped.")
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
