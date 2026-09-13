#!/usr/bin/env bash
# Lease quote sheet lock on the deals API:
#   rfq_requests.lease_sheet_locked_at / lease_sheet_locked_by_invite_id —
#   set the first time any invited dealer views their quote link (the
#   delivery "viewed" leg). After that the buyer's lease prefs are frozen.
#   PATCH /api/rfqs/:id/lease-prefs { leasePrefs } — 409 once locked.
#
# Run on the box as ubuntu:
#   bash 2026-09-13-lease-sheet-lock.sh
# Idempotent: every piece applies only if absent. Backup, exact-replace with
# asserts, node --check, pm2 restart, health check.
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

if "lease_sheet_locked_at" not in s:
    rep('''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS lease_prefs_json TEXT NULL");''',
        '''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS lease_prefs_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS lease_sheet_locked_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS lease_sheet_locked_by_invite_id BIGINT NULL");''', "columns")
    rep('''    leasePrefs: parseJsonCol(row.lease_prefs_json) || null,
  };
}''', '''    leasePrefs: parseJsonCol(row.lease_prefs_json) || null,
    // Frozen the first time a dealer opens their quote link; null while the buyer may still edit.
    leaseSheetLockedAt: row.lease_sheet_locked_at || null,
    leaseSheetLockedByInviteId: row.lease_sheet_locked_by_invite_id ? String(row.lease_sheet_locked_by_invite_id) : null,
  };
}''', "rfq mapper")
    rep('''    await logRfqEvent(pool, rfqId, status === "sent" ? "invite_sent" : "invite_viewed", {
      dealerName: rows[0].dealer_name, inviteId, vin: null, stockNumber: null, mustHaves: [],
    });
  }''', '''    await logRfqEvent(pool, rfqId, status === "sent" ? "invite_sent" : "invite_viewed", {
      dealerName: rows[0].dealer_name, inviteId, vin: null, stockNumber: null, mustHaves: [],
    });
  }
  if (status === "viewed") {
    // First dealer view freezes the buyer's lease quote sheet — the ask a
    // dealer is looking at must not change under them. Only ever set once.
    await pool.query(
      "UPDATE rfq_requests SET lease_sheet_locked_at = NOW(), lease_sheet_locked_by_invite_id = ? WHERE id = ? AND lease_sheet_locked_at IS NULL",
      [inviteId, rfqId]
    );
  }''', "lock on view")
    rep('''// GET /api/rfq-invites/by-token/:token — resolves a tracked-link token.''',
        '''// PATCH /api/rfqs/:id/lease-prefs — { leasePrefs }. The buyer adjusting the
// ask before any dealer has looked at it. 409 once the sheet is locked.
async function handlePatchRfqLeasePrefs(req, res, rfqId) {
  const body = await readBody(req);
  const prefs = body.leasePrefs && typeof body.leasePrefs === "object" ? body.leasePrefs : null;
  if (!prefs) return badRequest(res, "leasePrefs is required");
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });
  if (rows[0].lease_sheet_locked_at) {
    return sendJson(res, 409, { error: "locked", lockedAt: rows[0].lease_sheet_locked_at, lockedByInviteId: rows[0].lease_sheet_locked_by_invite_id ? String(rows[0].lease_sheet_locked_by_invite_id) : null });
  }
  if (rows[0].status !== "collecting") return sendJson(res, 409, { error: "closed" });
  await pool.query("UPDATE rfq_requests SET lease_prefs_json = ? WHERE id = ?", [JSON.stringify(prefs), rfqId]);
  const [fresh] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  const invites = await loadRfqInvitesWithQuotes(pool, rfqId);
  sendJson(res, 200, { rfq: publicRfqRequest(fresh[0], invites) });
}

// GET /api/rfq-invites/by-token/:token — resolves a tracked-link token.''', "patch handler")
    rep('''  const rfqInviteTokenMatch = pathname.match(/^\\/api\\/rfq-invites\\/by-token\\/([A-Za-z0-9_-]{8,80})$/);''',
        '''  const rfqLeasePrefsMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/lease-prefs$/);
  if (req.method === "PATCH" && rfqLeasePrefsMatch) {
    return run(handlePatchRfqLeasePrefs, Number(rfqLeasePrefsMatch[1]));
  }
  const rfqInviteTokenMatch = pathname.match(/^\\/api\\/rfq-invites\\/by-token\\/([A-Za-z0-9_-]{8,80})$/);''', "route")
open(p, "w").write(s)
print("patched:", p, "| applied:", ", ".join(changed) or "nothing (already present)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api
sleep 3
echo "--- health (expect 200) ---"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3004/health
sudo pm2 logs trimscout-deals-api --lines 5 --nostream | tail -5
