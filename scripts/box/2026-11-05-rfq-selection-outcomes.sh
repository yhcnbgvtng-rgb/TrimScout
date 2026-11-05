#!/usr/bin/env bash
# Deals API: one stored outcome per vehicle a buyer selected (invited, or excluded with a reason code), and an idempotent
# invitation create. CODE ONLY until Paul says GO; nothing here has been run on any box.
#   rfq_requests.selection_outcomes_json   MEDIUMTEXT  [{ vin, dealerName, dealerState, status, code, inviteId, reused, recordedAt }]
#   PUT  /api/rfqs/:id/selection-outcomes  { outcomes: [...] }  replaces the stored list. Display data only: it never creates,
#        changes or sends an invitation. Every field is whitelisted (codes from a fixed set), so no free text, address or
#        token can be stored through it.
#   GET  /api/rfqs/:id                     (and the list) now carry selectionOutcomes ([] on older requests)
#   POST /api/rfqs/:id/invites             a dealership that already holds a live (not declined/expired) invite on this request
#        and the same vehicle gets that invite back (200, reused: true) instead of a second row, so a retry or double click cannot duplicate.
# The app works without this patch: it shows the reasons it just computed, says they were not stored, and an older
# request shows "Reason unavailable". With it, the reasons survive a reload.
# DO NOT run during the nightly inventory sync (the restart drops in-flight sync requests): the guard below refuses.
# Run on the deals box (box2) as ubuntu, in an idle window, ON PAUL'S GO. Idempotent. Backup, exact-replace with asserts,
# node --check, pm2 restart. Test against a copy of the repo mirror (no sudo, no pm2):
#   TEST_ONLY=1 FILE=/path/to/deals_api_server.js bash 2026-11-05-rfq-selection-outcomes.sh
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

if "selection_outcomes_json" not in s:
    rep('''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS link_pastes_json TEXT NULL");''',
        '''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS link_pastes_json TEXT NULL");
  // One stored outcome per selected vehicle (invited, or excluded with a reason code) — see lib/selectionOutcomes.ts.
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS selection_outcomes_json MEDIUMTEXT NULL");''', "column")
    rep('''    linkPastes: parseJsonCol(row.link_pastes_json) || [],''',
        '''    linkPastes: parseJsonCol(row.link_pastes_json) || [],
    // Per-vehicle invitation outcomes written by PUT /api/rfqs/:id/selection-outcomes; [] on older requests.
    selectionOutcomes: parseJsonCol(row.selection_outcomes_json) || [],''', "mapper")
    rep('''  const [activeRows] = await pool.query(
    "SELECT COUNT(*) AS n FROM rfq_invites WHERE rfq_id = ? AND status NOT IN ('declined', 'expired')",
    [rfqId]
  );''',
        '''  // Idempotent: a retry or double click for a dealership that already holds a live invitation on this request returns
  // that invitation (200, reused) instead of creating a second one. Checked before the cap so a repeat at the cap is
  // still a no-op, not an error.
  const [sameDealerRows] = await pool.query(
    "SELECT * FROM rfq_invites WHERE rfq_id = ? AND LOWER(dealer_name) = ? AND status NOT IN ('declined', 'expired') AND vehicle_json IS NOT NULL AND vehicle_json LIKE ? ORDER BY id ASC LIMIT 1",
    [rfqId, dealerName.toLowerCase(), vehicle && vehicle.vin ? `%"vin":${JSON.stringify(String(vehicle.vin))}%` : "%\u0000never%"]
  );
  if (sameDealerRows.length > 0) return sendJson(res, 200, { invite: publicRfqInvite(sameDealerRows[0], null), reused: true });

  const [activeRows] = await pool.query(
    "SELECT COUNT(*) AS n FROM rfq_invites WHERE rfq_id = ? AND status NOT IN ('declined', 'expired')",
    [rfqId]
  );''', "idempotent invite")
    rep('''// POST /api/rfqs/:id/invites/:inviteId/delivery — { status: "sent" | "viewed" }.''',
        '''// PUT /api/rfqs/:id/selection-outcomes — { outcomes: [{ vin, dealerName, dealerState, status, code, inviteId, recordedAt }] }.
// Replaces the stored per-vehicle outcomes. Display data only: never creates, changes or sends an invitation.
const SELECTION_CODES = new Set(["dealer_unchecked", "ineligible_vehicle", "dealer_opted_out", "sister_store", "desk_already_invited", "same_dealer_other_vehicle", "invite_limit_reached", "dealer_daily_cap", "invite_creation_failed", "not_attempted", "reason_unavailable"]);
async function handlePutSelectionOutcomes(req, res, rfqId) {
  const body = await readBody(req);
  const list = Array.isArray(body.outcomes) ? body.outcomes.slice(0, 3) : null;
  if (!list) return badRequest(res, "outcomes must be an array");
  const clean = [];
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    const vin = typeof o.vin === "string" ? o.vin.trim().toUpperCase().slice(0, 17) : "";
    const status = o.status === "invited" || o.status === "excluded" ? o.status : "";
    const code = typeof o.code === "string" && SELECTION_CODES.has(o.code) ? o.code : null;
    if (!vin || !status || (status === "excluded" && !code)) continue;
    clean.push({
      vin,
      dealerName: typeof o.dealerName === "string" ? o.dealerName.slice(0, 160) : null,
      dealerState: typeof o.dealerState === "string" ? o.dealerState.slice(0, 8) : null,
      status,
      code,
      inviteId: o.inviteId == null ? null : String(o.inviteId).slice(0, 20),
      reused: o.reused === true ? true : undefined,
      recordedAt: typeof o.recordedAt === "string" ? o.recordedAt.slice(0, 40) : new Date().toISOString(),
    });
  }
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rows] = await pool.query("SELECT id FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });
  await pool.query("UPDATE rfq_requests SET selection_outcomes_json = ? WHERE id = ?", [JSON.stringify(clean), rfqId]);
  sendJson(res, 200, { ok: true, stored: clean.length });
}

// POST /api/rfqs/:id/invites/:inviteId/delivery — { status: "sent" | "viewed" }.''', "handler")
    rep('''  const rfqLeasePrefsMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/lease-prefs$/);''',
        '''  const rfqSelectionOutcomesMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/selection-outcomes$/);
  if (req.method === "PUT" && rfqSelectionOutcomesMatch) {
    return run(handlePutSelectionOutcomes, Number(rfqSelectionOutcomesMatch[1]));
  }
  const rfqLeasePrefsMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/lease-prefs$/);''', "route")
open(p, "w").write(s)
print("patched:", p, "| applied:", ", ".join(changed) or "nothing (already present)")
PY

node --check "$FILE" && echo "syntax ok"
if [ "${TEST_ONLY:-0}" != "1" ]; then
  sudo pm2 restart deals-api
  sleep 3
  echo "--- process up? (401 = up, key required) ---"
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3004/health
fi
