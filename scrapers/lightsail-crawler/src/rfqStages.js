// POST /api/rfqs/:id/invites/:inviteId/stage — one action on a dealer's Cash / Finance deal stages
// (see dealStages.js for the rules). Kept out of deals_api_server.js behind injected dependencies so it can be
// unit-tested without a database and added to the live server by a small anchored patch.
//
// Body: { action: { type, ...fields }, actor: "buyer" | "dealer", state?: "NJ" }
//   `state` is the buyer's two-letter state (from their ZIP, resolved by the Next app); it only decides whether the
//   trade-in tax saving is shown. The OTD amount and tax rate always come from the quote on file, never from the body.
// Scoped audit keys are pinned to their own side: the audit buyer key can only act as "buyer", the audit
// test-dealer key only as "dealer". Real emails are the Next app's job and stay under SAFE MODE there.
import { applyStageAction, cashQuoteOtd, initialStageState, quoteTaxRate } from "./dealStages.js";

const parse = (v) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
};

const HTTP_BY_CODE = { invalid: 400, bad_action: 400, bad_actor: 400, forbidden_actor: 403 };

export function createRfqStageHandler(deps) {
  const { getPool, readBody, sendJson, ensureColumns, loadInvites, publicRfqRequest, logRfqEvent, auditKind } = deps;

  return async function handleRfqStage(req, res, rfqId, inviteId) {
    const body = await readBody(req);
    const action = body?.action && typeof body.action === "object" ? body.action : null;
    const actor = body?.actor;
    if (!action || typeof action.type !== "string") return sendJson(res, 400, { error: "action is required" });
    if (actor !== "buyer" && actor !== "dealer") return sendJson(res, 400, { error: "actor must be buyer or dealer" });
    const kind = auditKind ? auditKind(req) : null;
    if ((kind === "audit" && actor !== "buyer") || (kind === "audit_dealer" && actor !== "dealer")) {
      return sendJson(res, 403, { error: `Forbidden: this key can only act as the ${kind === "audit" ? "buyer" : "dealer"}` });
    }
    const buyerState = typeof body.state === "string" && /^[A-Za-z]{2}$/.test(body.state) ? body.state.toUpperCase() : null;

    const pool = getPool();
    await ensureColumns(pool);
    const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
    const rfq = rfqRows[0];
    if (!rfq || rfq.deleted_at) return sendJson(res, 404, { error: "RFQ not found" });
    if (rfq.approval_status && rfq.approval_status !== "approved") return sendJson(res, 409, { error: "This request hasn't been released to dealers." });
    if (rfq.status !== "collecting") return sendJson(res, 409, { error: "closed", code: "closed" });
    const prefs = parse(rfq.quote_prefs_json);
    if (!prefs || prefs.staged !== true) return sendJson(res, 409, { error: "This request doesn't use the staged Cash / Finance flow.", code: "not_staged" });

    const [inviteRows] = await pool.query("SELECT * FROM rfq_invites WHERE id = ? AND rfq_id = ?", [inviteId, rfqId]);
    const invite = inviteRows[0];
    if (!invite) return sendJson(res, 404, { error: "Invite not found" });
    if (invite.status === "declined" || invite.status === "expired") return sendJson(res, 409, { error: "This dealer is no longer in the running.", code: "closed" });
    if (invite.dealer_unsubscribed_at && action.type !== "walk") return sendJson(res, 409, { error: "This dealership is no longer accepting requests on TrimScout.", code: "closed" });

    const [quoteRows] = await pool.query("SELECT * FROM rfq_quotes WHERE invite_id = ? AND superseded_at IS NULL ORDER BY id DESC LIMIT 1", [inviteId]);
    const quote = quoteRows[0] || null;
    const used = quote ? parse(quote.used_json) : null;
    const quoteLive = Boolean(quote) && invite.status === "quoted" && !(quote.expires_at && new Date(quote.expires_at).getTime() < Date.now());
    if (action.type === "accept_otd" && quote && invite.status === "quoted" && !quoteLive) {
      return sendJson(res, 409, { error: "That quote has expired. Ask the dealer to refresh it.", code: "expired" });
    }

    const rawBefore = invite.stage_json ?? null;
    const before = parse(rawBefore) || initialStageState({ tradeInExpected: Boolean(rfq.trade_in_expected) });
    const outcome = applyStageAction(before, { ...action, actor }, {
      otdAmount: quoteLive ? cashQuoteOtd(used) : null,
      taxRate: quoteTaxRate(used),
      state: buyerState,
      hasTradeInOnFile: rfq.trade_in_json != null && rfq.trade_in_json !== "",
    });
    if (!outcome.ok) return sendJson(res, HTTP_BY_CODE[outcome.code] || 409, { error: outcome.error, code: outcome.code });
    const next = outcome.state;
    const nextJson = JSON.stringify(next);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Optimistic lock: only write if nobody moved the deal since we read it.
      const [upd] = await conn.query("UPDATE rfq_invites SET stage_json = ? WHERE id = ? AND rfq_id = ? AND (stage_json <=> ?)", [nextJson, inviteId, rfqId, rawBefore]);
      if (upd.affectedRows === 0) {
        await conn.rollback();
        return sendJson(res, 409, { error: "This deal just changed. Reload and try again.", code: "stale" });
      }
      if (next.stage === "closed" && quote) {
        await conn.query("UPDATE rfq_requests SET status = 'picked', picked_quote_id = ? WHERE id = ? AND status = 'collecting'", [quote.id, rfqId]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await logRfqEvent(pool, rfqId, next.stage === "closed" ? "buyer_picked" : "deal_stage", {
      inviteId, dealerName: invite.dealer_name, actor, action: action.type, stage: next.stage, vin: null, stockNumber: null, mustHaves: [],
      ...(next.stage === "closed" ? { pickedQuoteId: quote ? quote.id : null, method: next.payment.method } : {}),
    });
    const [freshRfq] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
    const invites = await loadInvites(pool, rfqId);
    sendJson(res, 200, { rfq: publicRfqRequest(freshRfq[0], invites), stage: next });
  };
}
