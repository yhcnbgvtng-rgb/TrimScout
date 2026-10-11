#!/usr/bin/env bash
# Deals API: buyer test mode support (lets the app mark the owner's own test requests audit = 1).
#   rfq_requests.audit / audit_at   TINYINT / DATETIME   1 = left out of metrics (default 0)
#   POST /api/rfqs   { ..., buyerTestMode: true }   honoured for the FULL key only; sets audit = 1 (an UPDATE right after the insert). It does NOT set
#                    audit_forced_safe (that is the scoped audit key's flag), and a scoped key can never use it.
#   publicRfqRequest gains `audit` (the app refuses to send a test-mode request the box did not flag).
#
# Four small anchored edits to deals_api_server.js (anchored on the LIVE box text, which lags the repo mirror: the live
# server has no audit column on rfq_requests at all). Invites / quotes / events are not flagged on the live box; metric
# queries for rfq_* should join rfq_requests and filter audit = 0.
# DO NOT run during the nightly inventory sync (the restart drops in-flight sync requests): the guard below refuses.
# Run on the deals box (box2) as ubuntu, in an idle window, ON PAUL'S GO:
#   curl -fsSL -o 2026-10-11-buyer-test-mode.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-10-11-buyer-test-mode.sh && bash 2026-10-11-buyer-test-mode.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart deals-api.
# Test against a copy (no sudo, no pm2): TEST_ONLY=1 FILE=/path/to/deals_api_server.js bash 2026-10-11-buyer-test-mode.sh
set -euo pipefail
FILE="${FILE:-/opt/trimscout-deals/src/deals_api_server.js}"
STAMP=$(date +%Y%m%d-%H%M%S)
SUDO="sudo"; [ "${TEST_ONLY:-0}" = "1" ] && SUDO=""
if [ "${TEST_ONLY:-0}" != "1" ]; then
  if pgrep -f inventory-sync.mjs >/dev/null && [ "${FORCE:-0}" != "1" ]; then
    echo "inventory-sync is running; wait for it to finish (or rerun with FORCE=1). Nothing changed."; exit 1
  fi
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

if "buyerTestMode" not in s:
    rep('''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS audit_forced_safe TINYINT(1) NOT NULL DEFAULT 0");''',
        '''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS audit_forced_safe TINYINT(1) NOT NULL DEFAULT 0");
  // Buyer test mode (the owner's own account, via the app): 1 = left out of metrics. Separate from audit_forced_safe.
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS audit TINYINT(1) NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS audit_at DATETIME NULL");''', "columns")
    rep('''    auditForcedSafeMode: Boolean(row.audit_forced_safe),''',
        '''    auditForcedSafeMode: Boolean(row.audit_forced_safe),
    // 1 = buyer test mode or audit key: left out of metrics (the app also keeps its dealer email on SAFE MODE).
    audit: Boolean(row.audit),''', "mapper")
    rep('''    buyerUserId = req.audit.buyerUserId;
  }
  const vin = (body.vin || "").trim().toUpperCase();
  const stockNumber = body.stockNumber ? String(body.stockNumber).trim() : null;''',
        '''    buyerUserId = req.audit.buyerUserId;
  }
  // Buyer test mode: the app (full key only) asks for audit = 1 on the owner's own test requests. A scoped key can't use it.
  const buyerTestMode = !req.audit && body.buyerTestMode === true;
  const vin = (body.vin || "").trim().toUpperCase();
  const stockNumber = body.stockNumber ? String(body.stockNumber).trim() : null;''', "handler")
    rep('''  const [rows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [result.insertId]);
  sendJson(res, 201, { rfq: publicRfqRequest(rows[0], []) });''',
        '''  if (buyerTestMode) await pool.query("UPDATE rfq_requests SET audit = 1, audit_at = ? WHERE id = ?", [new Date(), result.insertId]);
  const [rows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [result.insertId]);
  sendJson(res, 201, { rfq: publicRfqRequest(rows[0], []) });''', "flag row")
    open(p, "w").write(s)
    print("patched:", ", ".join(changed))
else:
    print("already patched; nothing to do")
PY

if [ "${TEST_ONLY:-0}" = "1" ]; then exit 0; fi
node --check "$FILE"
sudo pm2 restart deals-api --update-env
sleep 3
sudo pm2 describe deals-api | grep -E "status|restarts" || true
echo "done. Rollback: sudo cp $FILE.bak.$STAMP $FILE && sudo pm2 restart deals-api"
