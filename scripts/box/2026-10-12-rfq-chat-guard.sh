#!/usr/bin/env bash
# Deals API: the conversation guard, layered on top of the 2026-10-11 rfq-messages patch (#494).
#   src/identityFilter.js   REPLACED (hardened: normalization, cross-message, links, risk score)
#   src/rfqMessages.js      REPLACED (screening, strikes, held messages, buyer reports; new response shapes)
#   src/rfqChatGuard.js     NEW      strike policy + rfq_chat_attempts / rfq_chat_review / rfq_chat_pauses (created lazily, CREATE TABLE IF NOT EXISTS)
#   src/rfqChatAdmin.js     NEW      admin queue (Release / Block), paused-dealer list + lift, pause status for the dealer's panel
#   Routes added:  GET /api/admin/chat-review   POST /api/admin/chat-review/:id   GET /api/admin/chat-pauses
#                  POST /api/admin/chat-pauses/lift   GET /api/rfqs/:id/invites/:inviteId/chat-status
#
# REQUIRES the 2026-10-11 rfq-messages patch (2026-10-11-rfq-messages.sh) to be applied first (this patch anchors on the lines it adds);
# it asserts and changes nothing otherwise. NEW tables only; no existing column or row is touched.
# DEPLOY THE NEXT APP FIRST (this PR's merge, on Vercel): the box's message responses change shape ({status: "delivered" | ...}) and the
# older app code reads `message` only. Order: merge -> Vercel deploys -> run this on the box.
# DO NOT run during the nightly inventory sync (the restart drops in-flight sync requests): the guard below refuses.
# Run on the deals box (box2) as ubuntu, in an idle window, ON PAUL'S GO:
#   curl -fsSL -o 2026-10-12-rfq-chat-guard.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-12-rfq-chat-guard.sh && bash 2026-10-12-rfq-chat-guard.sh
# Idempotent. Backup, copy modules, exact-replace with asserts, node --check, pm2 restart.
# Test against a copy of the live file or the repo mirror (no sudo, no pm2, no copying):
#   TEST_ONLY=1 FILE=/path/to/deals_api_server.js bash 2026-10-12-rfq-chat-guard.sh
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
  [ -f "$DIR/rfqMessages.js" ] || { echo "rfqMessages.js is not installed: apply 2026-10-11-rfq-messages.sh first. Nothing changed."; exit 1; }
  sudo cp "$FILE" "$FILE.bak.$STAMP"
  for m in identityFilter.js rfqMessages.js; do sudo cp "$DIR/$m" "$DIR/$m.bak.$STAMP"; done
  echo "backup: $FILE.bak.$STAMP (and identityFilter.js / rfqMessages.js .bak.$STAMP)"
  for m in identityFilter.js rfqChatGuard.js rfqMessages.js rfqChatAdmin.js; do
    tmp=$(mktemp --suffix=.js); curl -fsSL -o "$tmp" "$SRC_BASE/$m"; node --check "$tmp"
    sudo install -m 0644 "$tmp" "$DIR/$m"; rm -f "$tmp"; echo "installed $DIR/$m"
  done
fi

$SUDO python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n} (is the rfq-messages patch applied?):\n{old[:160]}"
    s = s.replace(old, new); changed.append(label)

if "createChatAdminHandlers" not in s:
    rep('''import { createRfqMessagesHandler } from "./rfqMessages.js";''',
        '''import { createRfqMessagesHandler } from "./rfqMessages.js";
import { createChatAdminHandlers } from "./rfqChatAdmin.js";''', "import")
    rep('''// POST /api/rfqs/:id/invites/:inviteId/buyer-counter — { counter }.''',
        '''// Conversation guard: admin review queue (Release / Block), paused dealers, and the dealer panel's pause status (module: rfqChatAdmin.js).
const chatAdmin = createChatAdminHandlers({ getPool, readBody, sendJson, ensureColumns: ensureQuotePackageColumns });

// POST /api/rfqs/:id/invites/:inviteId/buyer-counter — { counter }.''', "handler")
    rep('''  const rfqInviteMessagesMatch = pathname.match(''',
        '''  const chatStatusMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/invites\\/(\\d+)\\/chat-status$/);
  if (req.method === "GET" && chatStatusMatch) return run(chatAdmin.status, Number(chatStatusMatch[1]), Number(chatStatusMatch[2]));
  if (req.method === "GET" && pathname === "/api/admin/chat-review") return run(chatAdmin.list);
  const chatDecideMatch = pathname.match(/^\\/api\\/admin\\/chat-review\\/(\\d+)$/);
  if (req.method === "POST" && chatDecideMatch) return run(chatAdmin.decide, Number(chatDecideMatch[1]));
  if (req.method === "GET" && pathname === "/api/admin/chat-pauses") return run(chatAdmin.pauses);
  if (req.method === "POST" && pathname === "/api/admin/chat-pauses/lift") return run(chatAdmin.lift);
  const rfqInviteMessagesMatch = pathname.match(''', "routes")
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
