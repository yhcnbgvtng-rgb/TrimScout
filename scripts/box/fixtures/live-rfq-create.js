// Verbatim excerpts of the LIVE box2 deals_api_server.js (2026-10-11), pre-patch: the anchors scripts/box/2026-10-11-buyer-test-mode.sh edits.
// Not runnable; only the patcher's exact-match anchors matter.
  // Set when the scoped audit key created the row: the app layer must keep dealer mail on SAFE MODE for it.
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS audit_forced_safe TINYINT(1) NOT NULL DEFAULT 0");
    // Created by the scoped audit key: dealer email stays on SAFE MODE (pausmi@outlook.com) no matter what.
    auditForcedSafeMode: Boolean(row.audit_forced_safe),
  // The audit key can only create requests for its own test buyer; SAFE MODE is forced on
  // for everything it creates (audit_forced_safe), and approval stays 'pending' as for any RFQ.
  const auditForced = Boolean(req.audit);
  if (auditForced) {
    if (buyerUserId && buyerUserId !== req.audit.buyerUserId) return sendJson(res, 403, { error: "Forbidden: this key is limited to its own test buyer" });
    buyerUserId = req.audit.buyerUserId;
  }
  const vin = (body.vin || "").trim().toUpperCase();
  const stockNumber = body.stockNumber ? String(body.stockNumber).trim() : null;
  const vehicleYear = Number(body.vehicleYear);
  const [rows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [result.insertId]);
  sendJson(res, 201, { rfq: publicRfqRequest(rows[0], []) });
