// POST /api/rfqs/:id/invites/:inviteId/not-selected { step } — the buyer accepted a different dealer.
// Kept out of deals_api_server.js behind injected dependencies (like rfqStages.js) so it is unit-tested without a database.
//
//   close    mark this desk's quote closed (idempotent). The box then refuses new quotes, counters and stage moves for it
//            (a walk-away stays possible). Refused for the accepted dealer itself.
//   claim    take the one-time right to send the "not selected this time" note. Atomic: { claimed: true } for exactly one
//            caller; a claim older than the lease is considered abandoned (the sender died) and can be taken again.
//   sent     stamp the note as sent (it is never claimable again).
//   release  hand the claim back after a failed send so the next pass retries.
// The email itself is the Next app's job (lib/inviteOutbox.ts, SAFE MODE sender); this only keeps the books.

export const CLAIM_LEASE_MINUTES = 10;
const STEPS = ["close", "claim", "sent", "release"];

const parse = (v) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
};

export function createRfqNotSelectedHandler(deps) {
  const { getPool, readBody, sendJson, ensureColumns, logRfqEvent } = deps;

  return async function handleRfqNotSelected(req, res, rfqId, inviteId) {
    const body = await readBody(req);
    const step = body?.step;
    if (!STEPS.includes(step)) return sendJson(res, 400, { error: "step must be close, claim, sent or release" });
    const pool = getPool();
    await ensureColumns(pool);
    const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
    const rfq = rfqRows[0];
    if (!rfq || rfq.deleted_at) return sendJson(res, 404, { error: "RFQ not found" });
    const [inviteRows] = await pool.query("SELECT * FROM rfq_invites WHERE id = ? AND rfq_id = ?", [inviteId, rfqId]);
    const invite = inviteRows[0];
    if (!invite) return sendJson(res, 404, { error: "Invite not found" });

    if (step === "close") {
      if (await isAcceptedInvite(pool, rfq, invite)) return sendJson(res, 409, { error: "This is the accepted dealer: it can't be marked not selected.", code: "accepted" });
      const [upd] = await pool.query("UPDATE rfq_invites SET not_selected_at = NOW() WHERE id = ? AND rfq_id = ? AND not_selected_at IS NULL", [inviteId, rfqId]);
      if (upd.affectedRows > 0 && logRfqEvent) {
        await logRfqEvent(pool, rfqId, "deal_stage", { inviteId, dealerName: invite.dealer_name, actor: "buyer", action: "not_selected", stage: null, vin: null, stockNumber: null, mustHaves: [] });
      }
      return sendJson(res, 200, { ok: true, claimed: false, invite: null });
    }
    if (!invite.not_selected_at && step === "claim") return sendJson(res, 409, { error: "Close the quote before sending the note.", code: "not_closed" });

    if (step === "claim") {
      const [upd] = await pool.query(
        `UPDATE rfq_invites SET not_selected_notice_claimed_at = NOW()
         WHERE id = ? AND rfq_id = ? AND not_selected_at IS NOT NULL AND not_selected_notice_sent_at IS NULL
           AND (not_selected_notice_claimed_at IS NULL OR not_selected_notice_claimed_at < NOW() - INTERVAL ${CLAIM_LEASE_MINUTES} MINUTE)`,
        [inviteId, rfqId]
      );
      return sendJson(res, 200, { ok: true, claimed: upd.affectedRows === 1, invite: null });
    }
    if (step === "sent") {
      await pool.query("UPDATE rfq_invites SET not_selected_notice_sent_at = NOW() WHERE id = ? AND rfq_id = ? AND not_selected_notice_sent_at IS NULL", [inviteId, rfqId]);
      return sendJson(res, 200, { ok: true, claimed: false, invite: null });
    }
    await pool.query("UPDATE rfq_invites SET not_selected_notice_claimed_at = NULL WHERE id = ? AND rfq_id = ? AND not_selected_notice_sent_at IS NULL", [inviteId, rfqId]);
    return sendJson(res, 200, { ok: true, claimed: false, invite: null });
  };
}

/** The dealer the buyer accepted: the picked quote's invite, or (staged) the one whose out-the-door price is locked. */
async function isAcceptedInvite(pool, rfq, invite) {
  if (rfq.picked_quote_id != null) {
    const [q] = await pool.query("SELECT invite_id FROM rfq_quotes WHERE id = ? AND rfq_id = ?", [rfq.picked_quote_id, rfq.id]);
    if (q[0] && String(q[0].invite_id) === String(invite.id)) return true;
  }
  const stage = parse(invite.stage_json);
  return Boolean(stage && stage.otd && stage.otd.status === "locked" && stage.stage !== "walked");
}
