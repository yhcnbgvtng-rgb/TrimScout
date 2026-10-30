// POST /api/rfqs/:id/invites/:inviteId/reveal-contact — the winning dealer pressed "Reveal buyer contact info".
// The Next app has already verified the signed, expiring, single-dealer token and rate-limited the caller; this is the box's own
// gate and the book-keeping: only the finally accepted dealer's invite (never a closed-out or unaccepted one) gets the buyer's
// details back, every reveal is stamped on that invite's release (count, first and last time: the buyer's page shows it) and
// logged to rfq_events (who, which request, when; never the details). Kept out of deals_api_server.js behind injected
// dependencies, like rfqStages.js, so it is unit-tested without a database.
import { revealContact } from "./dealStages.js";

const parse = (v) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
};

export function createRfqContactRevealHandler(deps) {
  const { getPool, sendJson, ensureColumns, logRfqEvent, auditKind, now = () => new Date() } = deps;

  return async function handleRfqContactReveal(req, res, rfqId, inviteId) {
    // The audit buyer key can never read the buyer's details back out as a dealer.
    if ((auditKind ? auditKind(req) : null) === "audit") return sendJson(res, 403, { error: "Forbidden: this key can only act as the buyer" });
    const pool = getPool();
    await ensureColumns(pool);
    const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
    const rfq = rfqRows[0];
    if (!rfq || rfq.deleted_at) return sendJson(res, 404, { error: "RFQ not found" });
    const [inviteRows] = await pool.query("SELECT * FROM rfq_invites WHERE id = ? AND rfq_id = ?", [inviteId, rfqId]);
    const invite = inviteRows[0];
    if (!invite) return sendJson(res, 404, { error: "Invite not found" });
    if (invite.not_selected_at) return sendJson(res, 409, { error: "The buyer chose another dealer.", code: "closed" });

    const rawBefore = invite.stage_json ?? null;
    const outcome = revealContact(parse(rawBefore), now());
    if (!outcome.ok) return sendJson(res, 409, { error: outcome.error, code: outcome.code });
    // Optimistic lock, so two simultaneous reveals each count.
    const [upd] = await pool.query("UPDATE rfq_invites SET stage_json = ? WHERE id = ? AND rfq_id = ? AND (stage_json <=> ?)", [JSON.stringify(outcome.state), inviteId, rfqId, rawBefore]);
    if (upd.affectedRows === 0) return sendJson(res, 409, { error: "Try again.", code: "stale" });
    await logRfqEvent(pool, rfqId, "buyer_contact_revealed", { inviteId, dealerName: invite.dealer_name, actor: "dealer", action: "reveal", stage: "closed", vin: null, stockNumber: null, mustHaves: [] });
    sendJson(res, 200, { contact: outcome.contact, reveals: outcome.state.release.reveals });
  };
}
