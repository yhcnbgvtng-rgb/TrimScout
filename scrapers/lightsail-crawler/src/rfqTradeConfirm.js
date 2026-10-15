// Deals-box handlers for the trade allowance that rides with every quote and the winner's confirm-or-revise step.
// Kept out of deals_api_server.js behind injected dependencies (like rfqStages.js) so it is unit-tested without a database
// and wired into the live server by a small anchored patch (scripts/box/2026-10-16-rfq-trade-confirm.sh).
// The rules are tradeConfirm.js (shared with the Next.js app); this file is the bookkeeping around them.
//
//   POST /api/rfqs/:id/invites/:inviteId/trade-appraisal       { appraisal, reconfirm? }   a desk's allowance (or "can't quote")
//   POST /api/rfqs/:id/invites/:inviteId/trade-confirmation    { action, actor, config }  open | confirm | revise | accept_revised | go_back | walk | expire | reopen
//   POST /api/rfqs/:id/trade-confirmations/sweep               { config }                  persist deadlines that have passed
//   GET  /api/rfqs/:id/trade-audit                                                         the allowance log (admin only: the Next app guards it)
//
// Every allowance change writes an audit row (actor, action, before, after, time). Nothing here touches a vehicle quote or any
// other pricing. Scoped audit keys are pinned to their own side, as on the stage endpoint.
import { appraisalProblem, applyConfirmAction, auditEntry, DEFAULT_DEADLINE_HOURS, DEFAULT_THRESHOLD_PCT, effectiveStatus, openConfirmation } from "./tradeConfirm.js";

const parse = (v) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
};

const HTTP_BY_CODE = {
  invalid_allowance: 422, reason_required: 422, reason_text_required: 422, explanation_required: 422, single_number_required: 422,
  outside_range: 422, inside_range: 422, unchanged: 422, not_as_quoted: 422, bad_action: 400, forbidden_actor: 403, no_confirmation: 404,
};
const ACTIONS_BY_ACTOR = {
  dealer: ["confirm", "revise"],
  buyer: ["open", "accept_revised", "go_back", "walk"],
  system: ["expire", "reopen"],
};

const snap = (a) => {
  if (!a) return null;
  if (a.declined) return { declined: a.declined.code };
  return { single: a.allowanceSingle ?? null, low: a.allowanceLow ?? null, high: a.allowanceHigh ?? null, basis: a.basis ?? null };
};

export function createRfqTradeConfirmHandlers(deps) {
  const { getPool, readBody, sendJson, ensureColumns, loadInvites, publicRfqRequest, logRfqEvent, auditKind } = deps;

  async function audit(conn, e) {
    const row = auditEntry(e);
    await conn.query(
      "INSERT INTO rfq_trade_audit (rfq_id, invite_id, actor, action, from_json, to_json, detail_json, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [Number(row.rfqId), Number(row.inviteId), row.actor, row.action, JSON.stringify(row.from), JSON.stringify(row.to), JSON.stringify(row.detail), new Date(row.at)],
    );
  }

  async function load(pool, rfqId, inviteId) {
    const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
    const rfq = rfqRows[0];
    if (!rfq || rfq.deleted_at) return { error: [404, "RFQ not found"] };
    if (!parse(rfq.trade_in_json)) return { error: [409, "This request has no trade-in"] };
    if (inviteId == null) return { rfq };
    const [inviteRows] = await pool.query("SELECT * FROM rfq_invites WHERE id = ? AND rfq_id = ?", [inviteId, rfqId]);
    const invite = inviteRows[0];
    if (!invite) return { error: [404, "Invite not found"] };
    return { rfq, invite };
  }

  /** The desk that owns the picked quote, as an invite id string, or null. */
  async function pickedInviteId(pool, rfq) {
    if (rfq.status !== "picked" || rfq.picked_quote_id == null) return null;
    const [rows] = await pool.query("SELECT invite_id FROM rfq_quotes WHERE id = ?", [rfq.picked_quote_id]);
    return rows[0] ? String(rows[0].invite_id) : null;
  }

  async function latestQuoteExpiry(pool, inviteId) {
    const [rows] = await pool.query("SELECT * FROM rfq_quotes WHERE invite_id = ? AND superseded_at IS NULL ORDER BY id DESC LIMIT 1", [inviteId]);
    return rows[0] && rows[0].expires_at ? new Date(rows[0].expires_at).toISOString() : null;
  }

  async function respond(res, pool, rfqId, extra) {
    const [fresh] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
    const invites = await loadInvites(pool, rfqId);
    sendJson(res, 200, { rfq: publicRfqRequest(fresh[0], invites), ...extra });
  }

  // ---- the allowance ---------------------------------------------------------
  async function handleTradeAppraisal(req, res, rfqId, inviteId) {
    const body = await readBody(req);
    const a = body && body.appraisal && typeof body.appraisal === "object" ? body.appraisal : null;
    const kind = auditKind ? auditKind(req) : null;
    const problem = body && body.reconfirm === true ? null : appraisalProblem(a);
    if (problem) return sendJson(res, 400, { error: problem });
    const pool = getPool();
    await ensureColumns(pool);
    const loaded = await load(pool, rfqId, inviteId);
    if (loaded.error) return sendJson(res, loaded.error[0], { error: loaded.error[1] });
    const { rfq, invite } = loaded;
    if (invite.not_selected_at) return sendJson(res, 409, { error: "The buyer chose another dealer", code: "not_selected" });
    if (invite.status === "declined") return sendJson(res, 409, { error: "This desk declined" });
    if (rfq.status !== "collecting") {
      // After the buyer picked, only the picked desk may give a number, and only before the confirm step exists.
      const owner = await pickedInviteId(pool, rfq);
      if (!(owner && owner === String(invite.id))) return sendJson(res, 409, { error: "closed" });
      if (parse(invite.trade_confirmation_json)) return sendJson(res, 409, { error: "The buyer selected you: confirm or revise the trade value instead.", code: "locked" });
    }
    const before = parse(invite.trade_appraisal_json);
    let next;
    let action;
    if (body.reconfirm === true) {
      if (!before || before.declined) return sendJson(res, 409, { error: "There is no allowance to reconfirm" });
      next = { ...before, reconfirmedAt: new Date().toISOString() };
      action = "appraisal_reconfirmed";
    } else {
      next = { ...a, createdAt: new Date().toISOString(), reconfirmedAt: null };
      action = a.declined ? "trade_declined" : before ? "appraisal_updated" : "appraisal_set";
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("UPDATE rfq_invites SET trade_appraisal_json = ? WHERE id = ?", [JSON.stringify(next), inviteId]);
      await audit(conn, { rfqId, inviteId, actor: "dealer", action, from: snap(before), to: snap(next), detail: next.conditionChips && next.conditionChips.length ? { conditionChips: next.conditionChips } : null });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    sendJson(res, 200, { ok: true });
  }

  // ---- the confirm step ------------------------------------------------------
  /** Apply one action and store it; returns { confirmation } or { fail: [status, error, code] }. Never responds. */
  async function transition({ pool, invite, rfqId, inviteId, actor, action, config, now }) {
    const before = parse(invite.trade_confirmation_json);
    const rawBefore = invite.trade_confirmation_json ?? null;
    const outcome = applyConfirmAction(before, action, { now, thresholdPct: config.thresholdPct });
    if (!outcome.ok) return { fail: [HTTP_BY_CODE[outcome.code] || 409, outcome.error, outcome.code] };
    const next = outcome.confirmation;
    const type = action.type;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [upd] = await conn.query("UPDATE rfq_invites SET trade_confirmation_json = ? WHERE id = ? AND rfq_id = ? AND (trade_confirmation_json <=> ?)", [JSON.stringify(next), inviteId, rfqId, rawBefore]);
      if (upd.affectedRows === 0) {
        await conn.rollback();
        return { fail: [409, "This trade value just changed. Reload and try again.", "stale"] };
      }
      if (type === "go_back") await conn.query("UPDATE rfq_requests SET status = 'collecting', picked_quote_id = NULL WHERE id = ? AND status = 'picked'", [rfqId]);
      if (type === "walk") await conn.query("UPDATE rfq_requests SET status = 'walked' WHERE id = ? AND status = 'picked'", [rfqId]);
      const label = { confirm: "allowance_confirmed", revise: "allowance_revised", accept_revised: "revision_accepted", go_back: "revision_declined_went_back", walk: "buyer_walked_at_confirm", expire: "allowance_defaulted_at_deadline", reopen: "confirmation_reopened" }[type];
      const finalAmount = next.allowanceFinal;
      await audit(conn, {
        rfqId, inviteId, actor, action: label,
        from: { allowance: before ? before.allowanceFinal ?? before.allowancePrelim : null, status: before ? before.status : null },
        to: { allowance: finalAmount ?? next.allowancePrelim, status: next.status },
        detail: type === "revise" ? { prelim: next.allowancePrelim, final: next.allowanceFinal, delta: next.revisionDelta, reasonCode: next.revisionReasonCode, reasonText: next.revisionReasonText, citedConditions: next.citedConditions, flagged: next.revisionFlagged, firmBreach: next.firmBreach } : null,
        at: now,
      });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    if (logRfqEvent) {
      await logRfqEvent(pool, rfqId, "deal_stage", { inviteId, dealerName: invite.dealer_name, actor, action: `trade_${type}`, stage: next.status, vin: null, stockNumber: null, mustHaves: [] }).catch(() => undefined);
    }
    return { confirmation: next };
  }

  async function applyAndRespond(args) {
    const r = await transition(args);
    if (r.fail) return sendJson(args.res, r.fail[0], { error: r.fail[1], code: r.fail[2] });
    return respond(args.res, args.pool, args.rfqId, { confirmation: r.confirmation });
  }

  async function handleTradeConfirmation(req, res, rfqId, inviteId) {
    const body = await readBody(req);
    const action = body && body.action && typeof body.action === "object" ? body.action : null;
    const actor = body && body.actor;
    if (!action || typeof action.type !== "string") return sendJson(res, 400, { error: "action is required" });
    if (!Object.prototype.hasOwnProperty.call(ACTIONS_BY_ACTOR, actor)) return sendJson(res, 400, { error: "actor must be dealer, buyer or system" });
    if (!ACTIONS_BY_ACTOR[actor].includes(action.type)) return sendJson(res, 403, { error: `A ${actor} cannot do that`, code: "forbidden_actor" });
    const kind = auditKind ? auditKind(req) : null;
    if ((kind === "audit" && actor === "dealer") || (kind === "audit_dealer" && actor === "buyer")) {
      return sendJson(res, 403, { error: `Forbidden: this key can only act as the ${kind === "audit" ? "buyer" : "dealer"}` });
    }
    const config = {
      thresholdPct: Number.isFinite(Number(body.config && body.config.thresholdPct)) && Number(body.config.thresholdPct) >= 0 ? Number(body.config.thresholdPct) : DEFAULT_THRESHOLD_PCT,
      deadlineHours: Number.isFinite(Number(body.config && body.config.deadlineHours)) && Number(body.config.deadlineHours) > 0 ? Number(body.config.deadlineHours) : DEFAULT_DEADLINE_HOURS,
    };
    const pool = getPool();
    await ensureColumns(pool);
    const loaded = await load(pool, rfqId, inviteId);
    if (loaded.error) return sendJson(res, loaded.error[0], { error: loaded.error[1] });
    const { rfq, invite } = loaded;
    const now = new Date();
    const owner = await pickedInviteId(pool, rfq);
    const mine = owner === String(invite.id);

    if (action.type === "open") {
      if (!mine) return sendJson(res, 409, { error: "This desk is not the one the buyer selected.", code: "not_selected_desk" });
      const existing = parse(invite.trade_confirmation_json);
      if (existing) {
        if (existing.status === "revised" && existing.buyerDecision === "went_back") {
          return applyAndRespond({ pool, res, invite, rfqId, inviteId, actor: "system", action: { type: "reopen" }, config, now });
        }
        return respond(res, pool, rfqId, { confirmation: existing, already: true });
      }
      const opened = openConfirmation({ inviteId, quoteId: rfq.picked_quote_id, appraisal: parse(invite.trade_appraisal_json), quoteExpiresAt: await latestQuoteExpiry(pool, inviteId), now, deadlineHours: config.deadlineHours });
      if (!opened.ok) return sendJson(res, 409, { error: opened.error, code: "not_required", reason: opened.code });
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [upd] = await conn.query("UPDATE rfq_invites SET trade_confirmation_json = ? WHERE id = ? AND rfq_id = ? AND (trade_confirmation_json <=> ?)", [JSON.stringify(opened.confirmation), inviteId, rfqId, null]);
        if (upd.affectedRows === 0) { await conn.rollback(); return sendJson(res, 409, { error: "This trade value just changed. Reload and try again.", code: "stale" }); }
        await audit(conn, { rfqId, inviteId, actor: "buyer", action: "confirmation_opened", from: null, to: { allowance: opened.confirmation.allowancePrelim, status: "pending", deadlineAt: opened.confirmation.deadlineAt }, at: now });
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
      if (logRfqEvent) await logRfqEvent(pool, rfqId, "deal_stage", { inviteId, dealerName: invite.dealer_name, actor: "buyer", action: "trade_confirmation_opened", stage: "pending", vin: null, stockNumber: null, mustHaves: [] }).catch(() => undefined);
      return respond(res, pool, rfqId, { confirmation: opened.confirmation });
    }

    // Everything else acts on the open confirmation of the selected desk.
    if (!parse(invite.trade_confirmation_json)) return sendJson(res, 404, { error: "There is nothing to confirm on this deal.", code: "no_confirmation" });
    const stillPicked = rfq.status === "picked" && mine;
    if (!stillPicked && action.type !== "expire") return sendJson(res, 409, { error: "This request is no longer waiting on a trade confirmation.", code: "closed" });
    return applyAndRespond({ pool, res, invite, rfqId, inviteId, actor, action, config, now });
  }

  /** Persist every pending confirmation whose deadline has passed ("the original number stands"). */
  async function handleTradeConfirmSweep(req, res, rfqId) {
    const body = await readBody(req).catch(() => ({}));
    const config = { thresholdPct: DEFAULT_THRESHOLD_PCT, deadlineHours: Number(body && body.config && body.config.deadlineHours) > 0 ? Number(body.config.deadlineHours) : DEFAULT_DEADLINE_HOURS };
    const pool = getPool();
    await ensureColumns(pool);
    const loaded = await load(pool, rfqId, null);
    if (loaded.error) return sendJson(res, loaded.error[0], { error: loaded.error[1] });
    const now = new Date();
    const [rows] = await pool.query("SELECT * FROM rfq_invites WHERE rfq_id = ? AND trade_confirmation_json IS NOT NULL", [rfqId]);
    const expired = [];
    for (const invite of rows) {
      const conf = parse(invite.trade_confirmation_json);
      if (!conf || conf.status !== "pending" || effectiveStatus(conf, now) !== "expired") continue;
      const r = await transition({ pool, invite, rfqId, inviteId: invite.id, actor: "system", action: { type: "expire" }, config, now: new Date(now) });
      if (!r.fail) expired.push(String(invite.id));
    }
    return respond(res, pool, rfqId, { expiredInviteIds: expired });
  }

  async function handleTradeAudit(req, res, rfqId) {
    const pool = getPool();
    await ensureColumns(pool);
    const [rows] = await pool.query("SELECT * FROM rfq_trade_audit WHERE rfq_id = ? ORDER BY id ASC", [rfqId]);
    sendJson(res, 200, {
      audit: rows.map((r) => ({ id: String(r.id), rfqId: String(r.rfq_id), inviteId: String(r.invite_id), actor: r.actor, action: r.action, from: parse(r.from_json), to: parse(r.to_json), detail: parse(r.detail_json), at: r.at })),
    });
  }

  return { handleTradeAppraisal, handleTradeConfirmation, handleTradeConfirmSweep, handleTradeAudit };
}
