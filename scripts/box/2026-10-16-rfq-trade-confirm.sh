#!/usr/bin/env bash
# Deals API: every invited dealer quotes the trade WITH the car, and the winner confirms or revises that number in one in-app step.
#   rfq_invites.trade_confirmation_json  TEXT   the spec's trade_confirmation (status pending|confirmed|revised|expired, prelim/final,
#                                               reason, flags, deadline). One per invite; rules are src/tradeConfirm.js.
#   rfq_trade_audit                      TABLE  append-only log of every allowance change: actor, action, before, after, time.
#   publicRfqInvite gains tradeConfirmation.
#
#   POST /api/rfqs/:id/invites/:inviteId/trade-appraisal      replaces the 2026-10-08 handler (this route is matched first): same body,
#                                                              plus conditionChips, "can't quote this trade" (declined), reconfirm, audit rows.
#   POST /api/rfqs/:id/invites/:inviteId/trade-confirmation   { action: { type }, actor, config }  open | confirm | revise | accept_revised |
#                                                              go_back | walk | expire | reopen
#   POST /api/rfqs/:id/trade-confirmations/sweep              persists deadlines that passed ("the original number stands")
#   GET  /api/rfqs/:id/trade-audit                            the allowance log (the Next app lets admins only reach it)
#   POST .../quotes  (existing)                               now refused with 422 when the request has a trade and the desk has neither a live
#                                                              allowance nor a "can't quote" on file: the lock the browser cannot skip.
#
# ORDER ON THE BOX (each script is idempotent; this one refuses to run unless the earlier ones are on the server):
#   1. 2026-10-08-rfq-trade-in.sh      [needs: trade_photo_request_json]
#   2. 2026-10-12-rfq-not-selected.sh  [needs: createRfqNotSelectedHandler]
#   3. THIS SCRIPT. It installs two modules next to the server (tradeConfirm.js, rfqTradeConfirm.js), so the deals-api restart is required:
#      do it in an IDLE window, outside the 22:00-23:30 ET crawl/sync window, with no inventory-sync running, ON PAUL'S GO. The guard refuses otherwise.
# Do NOT turn the app side on before this is applied: the Next app sends the allowance with every quote on a trade request and the box
# endpoints above must exist. (Without this patch the old trade-appraisal route still works but nothing enforces the allowance.)
#
# Run on the deals box (box2) as ubuntu:
#   curl -fsSL -o 2026-10-16-rfq-trade-confirm.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-16-rfq-trade-confirm.sh && bash 2026-10-16-rfq-trade-confirm.sh
# Test against a copy (no sudo, no pm2, modules copied from a local source dir instead of downloaded):
#   TEST_ONLY=1 FILE=/path/to/copy/deals_api_server.js SRC_LOCAL=/path/to/repo/scrapers/lightsail-crawler/src bash 2026-10-16-rfq-trade-confirm.sh
# Rollback: sudo cp /opt/trimscout-deals/src/deals_api_server.js.bak.<stamp> /opt/trimscout-deals/src/deals_api_server.js && sudo pm2 restart trimscout-deals-api
#           (the new column and table are harmless to leave).
set -euo pipefail
FILE="${FILE:-/opt/trimscout-deals/src/deals_api_server.js}"
SRC_BASE="${SRC_BASE:-https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scrapers/lightsail-crawler/src}"
SRC_LOCAL="${SRC_LOCAL:-}"
STAMP=$(date +%Y%m%d-%H%M%S)
DIR=$(dirname "$FILE")
TEST="${TEST_ONLY:-0}"
SUDO="sudo"; [ "$TEST" = "1" ] && SUDO=""

need() { grep -q "$1" "$FILE" || { echo "MISSING: $2 ($1 not found in $FILE). Apply it first. Nothing changed."; exit 1; }; }
need 'trade_photo_request_json' '2026-10-08-rfq-trade-in.sh'
need 'createRfqNotSelectedHandler' '2026-10-12-rfq-not-selected.sh'

if [ "$TEST" != "1" ]; then
  if pgrep -f inventory-sync.mjs >/dev/null && [ "${FORCE:-0}" != "1" ]; then
    echo "inventory-sync is running; wait for it to finish (or rerun with FORCE=1). Nothing changed."; exit 1
  fi
fi

# Fetch and syntax-check both modules BEFORE touching anything; they must load together.
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
for m in tradeConfirm.js rfqTradeConfirm.js; do
  if [ -n "$SRC_LOCAL" ]; then cp "$SRC_LOCAL/$m" "$TMP/$m"; else curl -fsSL -o "$TMP/$m" "$SRC_BASE/$m"; fi
  node --check "$TMP/$m"
done
( cd "$TMP" && node --input-type=module -e "import('./rfqTradeConfirm.js').then((m) => { if (typeof m.createRfqTradeConfirmHandlers !== 'function') process.exit(1); })" ) || { echo "module pair failed to load; aborting. Nothing changed."; exit 1; }

if [ "$TEST" != "1" ]; then
  $SUDO cp "$FILE" "$FILE.bak.$STAMP"; echo "backup: $FILE.bak.$STAMP"
  for m in tradeConfirm.js rfqTradeConfirm.js; do
    if [ -f "$DIR/$m" ]; then $SUDO cp "$DIR/$m" "$DIR/$m.bak.$STAMP"; fi
    $SUDO install -m 0644 "$TMP/$m" "$DIR/$m"; echo "installed $DIR/$m"
  done
fi

$SUDO python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:160]}"
    s = s.replace(old, new); changed.append(label)

if "createRfqTradeConfirmHandlers" not in s:
    rep('''import { createRfqNotSelectedHandler } from "./rfqNotSelected.js";''',
        '''import { createRfqNotSelectedHandler } from "./rfqNotSelected.js";
import { createRfqTradeConfirmHandlers } from "./rfqTradeConfirm.js";
import { tradeAnswerProblem } from "./tradeConfirm.js";''', "import")
    rep('''  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS trade_photos_notified_at DATETIME NULL");''',
        '''  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS trade_photos_notified_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS trade_confirmation_json TEXT NULL");
  await pool.query("CREATE TABLE IF NOT EXISTS rfq_trade_audit (id BIGINT AUTO_INCREMENT PRIMARY KEY, rfq_id BIGINT NOT NULL, invite_id BIGINT NOT NULL, actor VARCHAR(16) NOT NULL, action VARCHAR(48) NOT NULL, from_json TEXT NULL, to_json TEXT NULL, detail_json TEXT NULL, at DATETIME NOT NULL, KEY idx_trade_audit_rfq (rfq_id, id))");''', "columns")
    rep('''    tradePhotosNotifiedAt: row.trade_photos_notified_at || null,''',
        '''    tradePhotosNotifiedAt: row.trade_photos_notified_at || null,
    // The confirm-or-revise step after the buyer selected this desk (rules: tradeConfirm.js).
    tradeConfirmation: parseJsonCol(row.trade_confirmation_json) || null,''', "invite mapper")
    rep('''// POST /api/rfqs/:id/invites/:inviteId/not-selected — close a desk's quote after the buyer accepted another dealer.''',
        '''// Trade allowance with the quote + the winner's confirm-or-revise step (rules: tradeConfirm.js).
const tradeConfirm = createRfqTradeConfirmHandlers({
  getPool, readBody, sendJson,
  ensureColumns: ensureQuotePackageColumns,
  loadInvites: loadRfqInvitesWithQuotes,
  publicRfqRequest, logRfqEvent,
  auditKind: (req) => req.audit?.kind || null,
});

// POST /api/rfqs/:id/invites/:inviteId/not-selected — close a desk's quote after the buyer accepted another dealer.''', "handlers")
    # Matched BEFORE the 2026-10-08 trade-appraisal route, so the old handler is never reached.
    rep('''  const rfqTradeInMatch = pathname.match(''',
        '''  const rfqTradeAppraisalV2Match = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/invites\\/(\\d+)\\/(trade-appraisal|trade-confirmation)$/);
  if (req.method === "POST" && rfqTradeAppraisalV2Match) {
    const fn = rfqTradeAppraisalV2Match[3] === "trade-appraisal" ? tradeConfirm.handleTradeAppraisal : tradeConfirm.handleTradeConfirmation;
    return run(fn, Number(rfqTradeAppraisalV2Match[1]), Number(rfqTradeAppraisalV2Match[2]));
  }
  const rfqTradeSweepMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/trade-confirmations\\/sweep$/);
  if (req.method === "POST" && rfqTradeSweepMatch) return run(tradeConfirm.handleTradeConfirmSweep, Number(rfqTradeSweepMatch[1]));
  const rfqTradeAuditMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/trade-audit$/);
  if (req.method === "GET" && rfqTradeAuditMatch) return run(tradeConfirm.handleTradeAudit, Number(rfqTradeAuditMatch[1]));
  const rfqTradeInMatch = pathname.match(''', "routes")
    # The lock the browser cannot skip: a quote on a trade request needs an allowance (or a decline) on file.
    rep('''    if (closedRows[0] && closedRows[0].not_selected_at) return sendJson(res, 409, { error: "The buyer chose another dealer, so this quote is closed", code: "not_selected" });
  }
''',
        '''    if (closedRows[0] && closedRows[0].not_selected_at) return sendJson(res, 409, { error: "The buyer chose another dealer, so this quote is closed", code: "not_selected" });
  }
  if (rfqRows[0].trade_in_json) {
    const [tradeAnswerRows] = await pool.query("SELECT trade_appraisal_json FROM rfq_invites WHERE id = ? AND rfq_id = ?", [inviteId, rfqId]);
    const tradeProblem = tradeAnswerProblem({ hasTrade: true, appraisal: parseJsonCol(tradeAnswerRows[0] && tradeAnswerRows[0].trade_appraisal_json), quoteExpiresAt: body.expiresAt, now: new Date() });
    if (tradeProblem) return sendJson(res, 422, { error: tradeProblem, code: "trade_allowance_required" });
  }
''', "quote needs a trade answer")
open(p, "w").write(s)
print("patched:", p, "| applied:", ", ".join(changed) or "nothing (already present)")
PY

node --check "$FILE" && echo "syntax ok"
if [ "$TEST" != "1" ]; then
  sudo pm2 restart trimscout-deals-api
  sleep 3
  echo "--- process up? (401 = up, key required) ---"
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3004/health
fi
