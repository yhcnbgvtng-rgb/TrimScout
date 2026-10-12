#!/usr/bin/env bash
# Deals API: the buyer <-> dealer chat on one desk's quote, and the "fee_override" deal event.
#   rfq_invites.messages_json   TEXT   that desk's thread, oldest first, capped at 200 (never edited by hand)
#   POST /api/rfqs/:id/invites/:inviteId/messages
#        { kind: "message", from: "buyer"|"dealer", text }   append to THIS invite's thread only; contact info is refused
#        { kind: "event", type: "fee_override", overrides }   log the dealer's fee override to rfq_events
#   publicRfqInvite gains `messages`. Scoped audit keys are pinned to their own side.
#
# Adds one file next to the server (rfqMessages.js) and four small anchored edits to deals_api_server.js.
# REQUIRES the 2026-10-11 deal-stages patch to be applied first (this patch anchors on the lines it adds); it asserts and
# changes nothing otherwise. Until this is applied the app degrades: the chat panel shows the existing notes and system
# events read-only and says sending isn't available yet; fee overrides still save and still email the buyer.
# DO NOT run during the nightly inventory sync (the restart drops in-flight sync requests): the guard below refuses.
# Run on the deals box (box2) as ubuntu, in an idle window, ON PAUL'S GO:
#   curl -fsSL -o 2026-10-11-rfq-messages.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-11-rfq-messages.sh && bash 2026-10-11-rfq-messages.sh
# Idempotent. Backup, copy module, exact-replace with asserts, node --check, pm2 restart.
# Test against a copy of the live file or the repo mirror (no sudo, no pm2, no copying):
#   TEST_ONLY=1 FILE=/path/to/deals_api_server.js bash 2026-10-11-rfq-messages.sh
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
  for m in rfqMessages.js; do
    tmp=$(mktemp); curl -fsSL -o "$tmp" "$SRC_BASE/$m"; node --check "$tmp"
    sudo install -m 0644 "$tmp" "$DIR/$m"; rm -f "$tmp"; echo "installed $DIR/$m"
  done
fi

$SUDO python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n} (is the deal-stages patch applied?):\n{old[:160]}"
    s = s.replace(old, new); changed.append(label)

if "createRfqMessagesHandler" not in s:
    rep('''import { createRfqStageHandler } from "./rfqStages.js";''',
        '''import { createRfqStageHandler } from "./rfqStages.js";
import { createRfqMessagesHandler } from "./rfqMessages.js";''', "import")
    rep('''  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS stage_json TEXT NULL");''',
        '''  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS stage_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS messages_json TEXT NULL");''', "column")
    rep('''    stage: parseJsonCol(row.stage_json) || null,''',
        '''    stage: parseJsonCol(row.stage_json) || null,
    // This desk's buyer <-> dealer chat, oldest first. Belongs to this invite only.
    messages: parseJsonCol(row.messages_json) || [],''', "invite mapper")
    rep('''// POST /api/rfqs/:id/invites/:inviteId/buyer-counter — { counter }.''',
        '''// POST /api/rfqs/:id/invites/:inviteId/messages — chat message or fee_override event (module: rfqMessages.js).
const handleRfqMessages = createRfqMessagesHandler({
  getPool, readBody, sendJson,
  ensureColumns: ensureQuotePackageColumns,
  loadInvites: loadRfqInvitesWithQuotes,
  publicRfqRequest, logRfqEvent, findContactInfo,
  auditKind: (req) => req.audit?.kind || null,
});

// POST /api/rfqs/:id/invites/:inviteId/buyer-counter — { counter }.''', "handler")
    rep('''  const rfqInviteStageMatch = pathname.match(''',
        '''  const rfqInviteMessagesMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/invites\\/(\\d+)\\/messages$/);
  if (req.method === "POST" && rfqInviteMessagesMatch) {
    return run(handleRfqMessages, Number(rfqInviteMessagesMatch[1]), Number(rfqInviteMessagesMatch[2]));
  }
  const rfqInviteStageMatch = pathname.match(''', "route")
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
