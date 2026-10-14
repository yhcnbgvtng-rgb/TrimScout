#!/usr/bin/env bash
# Deals API: the staged Cash / Finance deal (out-the-door price -> trade-in -> payment), one state machine per dealer.
#   rfq_invites.stage_json   TEXT   that desk's stage state (rules live in dealStages.js; never edited by hand)
#   POST /api/rfqs/:id/invites/:inviteId/stage   { action: { type, ... }, actor: "buyer"|"dealer", state? }
#   publicRfqInvite gains `stage`. Closing a deal (cash chosen / financing accepted) marks the request picked.
#   Scoped audit keys are pinned to their own side (buyer key -> actor "buyer", test-dealer key -> "dealer").
#
# Adds two files next to the server (dealStages.js, rfqStages.js) and four small anchored edits to deals_api_server.js.
# DO NOT run during the nightly inventory sync (the restart drops in-flight sync requests): the guard below refuses.
# Run on the deals box (box2) as ubuntu, in an idle window, ON PAUL'S GO:
#   curl -fsSL -o 2026-10-11-rfq-deal-stages.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-11-rfq-deal-stages.sh && bash 2026-10-11-rfq-deal-stages.sh
# Idempotent. Backup, copy modules, exact-replace with asserts, node --check, pm2 restart.
# Needs the 2026-10-08 trade-in patch's anchors only in the sense that it leaves them in place; this patch does not depend on its columns
# (an unpatched box simply never sees trade_in_json, so the trade stage reports "the buyer hasn't added the trade-in yet").
# Test against a copy of the repo mirror (no sudo, no pm2, no copying):
#   TEST_ONLY=1 FILE=/path/to/deals_api_server.js bash 2026-10-11-rfq-deal-stages.sh
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
  for m in dealStages.js rfqStages.js; do
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

if "createRfqStageHandler" not in s:
    rep('''import { createGate, SearchBusyError } from "./searchGate.js";''',
        '''import { createGate, SearchBusyError } from "./searchGate.js";
import { createRfqStageHandler } from "./rfqStages.js";''', "import")
    rep('''  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS buyer_counter_at DATETIME NULL");''',
        '''  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS buyer_counter_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS stage_json TEXT NULL");''', "column")
    rep('''    buyerCounterAt: row.buyer_counter_at || null,''',
        '''    buyerCounterAt: row.buyer_counter_at || null,
    // Staged Cash / Finance deal state for this desk (OTD -> trade-in -> payment); null until the first action.
    stage: parseJsonCol(row.stage_json) || null,''', "invite mapper")
    rep('''// POST /api/rfqs/:id/invites/:inviteId/buyer-counter — { counter }.''',
        '''// POST /api/rfqs/:id/invites/:inviteId/stage — one action on the staged Cash / Finance deal (rules: dealStages.js).
const handleRfqStage = createRfqStageHandler({
  getPool, readBody, sendJson,
  ensureColumns: ensureQuotePackageColumns,
  loadInvites: loadRfqInvitesWithQuotes,
  publicRfqRequest, logRfqEvent,
  auditKind: (req) => req.audit?.kind || null,
});

// POST /api/rfqs/:id/invites/:inviteId/buyer-counter — { counter }.''', "handler")
    rep('''  const rfqInviteCounterMatch = pathname.match(''',
        '''  const rfqInviteStageMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/invites\\/(\\d+)\\/stage$/);
  if (req.method === "POST" && rfqInviteStageMatch) {
    return run(handleRfqStage, Number(rfqInviteStageMatch[1]), Number(rfqInviteStageMatch[2]));
  }
  const rfqInviteCounterMatch = pathname.match(''', "route")
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
