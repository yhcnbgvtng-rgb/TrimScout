#!/usr/bin/env bash
# Deals API: admin approval before any quote request reaches a dealer (2026-09-17).
#   rfq_requests.approval_status ('pending' on every new request; existing rows grandfathered 'approved'),
#   approval_decided_at/by, rejection_reason, admin_edits_json;
#   POST /api/rfqs/:id/approval { decision, by, reason } · PATCH /api/rfqs/:id (admin corrections) ·
#   DELETE /api/rfqs/:id/invites/:inviteId · GET /api/rfqs?all=1&approval=pending.
#
# Run on the deals box (ubuntu@3.208.49.1):
#   curl -fsSL -o 2026-09-17-rfq-approval.sh https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-17-rfq-approval.sh && bash 2026-09-17-rfq-approval.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart, health check.
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
    if new in s: return
    s = s.replace(old, new); changed.append(label)

# 1. Columns. Default 'approved' grandfathers every existing request; new ones insert 'pending' explicitly.
rep('''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS trade_in_expected TINYINT(1) NULL");''',
'''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS trade_in_expected TINYINT(1) NULL");
  // Admin approval before any dealer sees a request (2026-09-17). Existing rows were already released.
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS approval_status VARCHAR(16) NOT NULL DEFAULT 'approved'");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS approval_decided_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS approval_decided_by VARCHAR(191) NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(500) NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS admin_edits_json TEXT NULL");''', "approval columns")

# 2. Serializer.
rep('''    // Frozen the first time a dealer opens their quote link; null while the buyer may still edit.
    leaseSheetLockedAt: row.lease_sheet_locked_at || null,''',
'''    // Admin gate: 'pending' until an admin releases it, 'approved' (released), or 'rejected' (reason to the buyer).
    approvalStatus: row.approval_status || "approved",
    approvalDecidedAt: row.approval_decided_at || null,
    approvalDecidedBy: row.approval_decided_by || null,
    rejectionReason: row.rejection_reason || null,
    // Corrections an admin made before release: [{ at, by, summary }].
    adminEdits: parseJsonCol(row.admin_edits_json) || [],
    // Frozen the first time a dealer opens their quote link; null while the buyer may still edit.
    leaseSheetLockedAt: row.lease_sheet_locked_at || null,''', "serializer")

# 3. New requests start pending.
rep('''    `INSERT INTO rfq_requests (buyer_user_id, vin, stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, must_haves_json, status, package_kind, link_pastes_json, deal_reference, lease_prefs_json, quote_prefs_json, buyer_note, trade_in_expected)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collecting', ?, ?, ?, ?, ?, ?, ?)`,''',
'''    `INSERT INTO rfq_requests (buyer_user_id, vin, stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, must_haves_json, status, package_kind, link_pastes_json, deal_reference, lease_prefs_json, quote_prefs_json, buyer_note, trade_in_expected, approval_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collecting', ?, ?, ?, ?, ?, ?, ?, 'pending')`,''', "insert pending")

# 4. Handlers: approval decision, admin edit, invite delete.
rep('''// Events only — no dashboard, no aggregation endpoint. Every named event''',
'''// POST /api/rfqs/:id/approval — { decision: "approved" | "rejected" | "pending", by, reason }.
// The admin gate. Nothing about the request or its invites is sent until
// this says "approved"; the app's outbox checks approvalStatus before every
// send. "pending" is the buyer's resubmit after a rejection.
async function handleRfqApproval(req, res, rfqId) {
  const body = await readBody(req);
  const decision = String(body.decision || "").trim();
  if (!["approved", "rejected", "pending"].includes(decision)) return badRequest(res, "decision must be approved, rejected or pending");
  const by = body.by ? String(body.by).trim().slice(0, 191) : null;
  const reason = decision === "rejected" ? String(body.reason || "").trim().slice(0, 500) : null;
  if (decision === "rejected" && !reason) return badRequest(res, "A rejection needs a reason for the buyer");
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });
  if (rows[0].status !== "collecting") return sendJson(res, 409, { error: "closed" });
  await pool.query(
    "UPDATE rfq_requests SET approval_status = ?, approval_decided_at = ?, approval_decided_by = ?, rejection_reason = ? WHERE id = ?",
    [decision, decision === "pending" ? null : new Date(), decision === "pending" ? null : by, reason, rfqId]
  );
  await logRfqEvent(pool, rfqId, decision === "approved" ? "rfq_approved" : decision === "rejected" ? "rfq_rejected" : "rfq_resubmitted", { by, reason, vin: rows[0].vin });
  const [fresh] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  const invites = await loadRfqInvitesWithQuotes(pool, rfqId);
  sendJson(res, 200, { rfq: publicRfqRequest(fresh[0], invites) });
}

// PATCH /api/rfqs/:id — an admin correcting the quote sheet before release.
// Only while the request is still pending/rejected (never after dealers
// have it). Every call appends to admin_edits_json so the buyer can see
// what changed. Fields absent from the body are left alone.
async function handleAdminPatchRfq(req, res, rfqId) {
  const body = await readBody(req);
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });
  if (rows[0].status !== "collecting") return sendJson(res, 409, { error: "closed" });
  if ((rows[0].approval_status || "approved") === "approved") return sendJson(res, 409, { error: "released", message: "This request has already been released to dealers." });
  const sets = []; const vals = [];
  const str = (key, col, max) => { if (typeof body[key] === "string") { sets.push(`${col} = ?`); vals.push(body[key].trim().slice(0, max) || null); } };
  if (typeof body.vin === "string" && /^[A-HJ-NPR-Z0-9]{17}$/i.test(body.vin.trim())) { sets.push("vin = ?"); vals.push(body.vin.trim().toUpperCase()); }
  if (Number.isFinite(Number(body.vehicleYear)) && Number(body.vehicleYear) > 1980) { sets.push("vehicle_year = ?"); vals.push(Number(body.vehicleYear)); }
  str("vehicleMake", "vehicle_make", 64); str("vehicleModel", "vehicle_model", 64); str("vehicleTrim", "vehicle_trim", 128); str("stockNumber", "stock_number", 64);
  if (Array.isArray(body.mustHaves)) { sets.push("must_haves_json = ?"); vals.push(JSON.stringify(body.mustHaves.slice(0, 50))); }
  if (Array.isArray(body.linkPastes)) { sets.push("link_pastes_json = ?"); vals.push(body.linkPastes.length ? JSON.stringify(body.linkPastes.slice(0, 3)) : null); }
  if (body.leasePrefs === null || (body.leasePrefs && typeof body.leasePrefs === "object")) { sets.push("lease_prefs_json = ?"); vals.push(body.leasePrefs ? JSON.stringify(body.leasePrefs) : null); }
  if (body.quotePrefs === null || (body.quotePrefs && typeof body.quotePrefs === "object")) { sets.push("quote_prefs_json = ?"); vals.push(body.quotePrefs ? JSON.stringify(body.quotePrefs) : null); }
  if (body.buyerNote === null || typeof body.buyerNote === "string") { sets.push("buyer_note = ?"); vals.push(body.buyerNote ? String(body.buyerNote).trim().slice(0, 1000) || null : null); }
  if (typeof body.tradeInExpected === "boolean" || body.tradeInExpected === null) { sets.push("trade_in_expected = ?"); vals.push(body.tradeInExpected === null ? null : body.tradeInExpected ? 1 : 0); }
  const edit = body.adminEdit && typeof body.adminEdit === "object" ? { at: new Date().toISOString(), by: String(body.adminEdit.by || "").slice(0, 191) || null, summary: String(body.adminEdit.summary || "").trim().slice(0, 300) || "Corrected by TrimScout" } : null;
  if (sets.length === 0 && !edit) return badRequest(res, "Nothing to change");
  const edits = parseJsonCol(rows[0].admin_edits_json) || [];
  if (edit) edits.push(edit);
  sets.push("admin_edits_json = ?"); vals.push(JSON.stringify(edits.slice(-50)));
  vals.push(rfqId);
  await pool.query(`UPDATE rfq_requests SET ${sets.join(", ")} WHERE id = ?`, vals);
  if (edit) await logRfqEvent(pool, rfqId, "rfq_admin_edited", { by: edit.by, summary: edit.summary, fields: sets.map((x) => x.split(" ")[0]) });
  const [fresh] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  const invites = await loadRfqInvitesWithQuotes(pool, rfqId);
  sendJson(res, 200, { rfq: publicRfqRequest(fresh[0], invites) });
}

// DELETE /api/rfqs/:id/invites/:inviteId — an admin dropping a dealer
// before release. Only a still-queued invite on an unreleased request.
async function handleDeleteRfqInvite(req, res, rfqId, inviteId) {
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });
  if ((rows[0].approval_status || "approved") === "approved") return sendJson(res, 409, { error: "released" });
  const [inv] = await pool.query("SELECT * FROM rfq_invites WHERE id = ? AND rfq_id = ?", [inviteId, rfqId]);
  if (inv.length === 0) return sendJson(res, 404, { error: "Invite not found" });
  if ((inv[0].delivery_status || "queued") !== "queued") return sendJson(res, 409, { error: "already sent" });
  await pool.query("DELETE FROM rfq_quotes WHERE invite_id = ?", [inviteId]);
  await pool.query("DELETE FROM rfq_invites WHERE id = ?", [inviteId]);
  await logRfqEvent(pool, rfqId, "rfq_invite_removed", { inviteId, dealerName: inv[0].dealer_name });
  const invites = await loadRfqInvitesWithQuotes(pool, rfqId);
  sendJson(res, 200, { rfq: publicRfqRequest(rows[0], invites) });
}

// Events only — no dashboard, no aggregation endpoint. Every named event''', "handlers")

# 5. Routes.
rep('''  const rfqLeasePrefsMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/lease-prefs$/);''',
'''  if (req.method === "PATCH" && rfqIdMatch) {
    return run(handleAdminPatchRfq, Number(rfqIdMatch[1]));
  }
  const rfqApprovalMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/approval$/);
  if (req.method === "POST" && rfqApprovalMatch) {
    return run(handleRfqApproval, Number(rfqApprovalMatch[1]));
  }
  const rfqInviteIdMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/invites\\/(\\d+)$/);
  if (req.method === "DELETE" && rfqInviteIdMatch) {
    return run(handleDeleteRfqInvite, Number(rfqInviteIdMatch[1]), Number(rfqInviteIdMatch[2]));
  }
  const rfqLeasePrefsMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/lease-prefs$/);''', "routes")

# 6. Pending count for the admin badge, on the list endpoint: ?approval=pending
rep('''  const [rows] = all
    ? await pool.query("SELECT * FROM rfq_requests ORDER BY created_at DESC LIMIT ?", [limit])''',
'''  const approval = (query.get("approval") || "").trim();
  const [rows] = all
    ? approval
      ? await pool.query("SELECT * FROM rfq_requests WHERE approval_status = ? ORDER BY created_at ASC LIMIT ?", [approval, limit])
      : await pool.query("SELECT * FROM rfq_requests ORDER BY created_at DESC LIMIT ?", [limit])''', "list filter")

open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3004/api/rfqs?all=1&approval=pending")
echo "GET /api/rfqs?all=1&approval=pending without key -> $code (401 = server up and guarding)"
