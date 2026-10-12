// POST /api/rfqs/:id/invites/:inviteId/messages — the buyer <-> dealer chat on one desk's quote, plus the one deal event
// the app logs for a dealer's fee override. Kept out of deals_api_server.js behind injected dependencies so it can be
// unit-tested without a database and added to the live server by a small anchored patch.
//
// Body: { kind: "message", from: "buyer" | "dealer", text }   -> appended to that invite's thread (rfq_invites.messages_json)
//       { kind: "event", type: "fee_override", overrides: [] } -> logged to rfq_events (dealer only); the thread itself is not touched
// A thread belongs to ONE invite: the dealer's tokened page and the buyer's page for that desk read the same list, and no
// other desk's invite is ever read or written here. Text never carries contact details (findContactInfo, same check the
// request comment uses); the server refuses it outright rather than editing it. Scoped audit keys are pinned to their own
// side (buyer key -> from "buyer", test-dealer key -> "dealer"). Emails are the Next app's job and stay under SAFE MODE there.
export const MAX_MESSAGES = 200;
export const MAX_TEXT = 1000;
const EVENT_TYPES = new Set(["fee_override"]);

const parse = (v) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
};

/** Appends one message to a thread; the oldest fall off past MAX_MESSAGES. Pure. */
export function appendMessage(list, { from, text }, now = new Date(), id = null) {
  const clean = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (from !== "buyer" && from !== "dealer") return { ok: false, code: "bad_from", error: "from must be buyer or dealer" };
  if (!clean) return { ok: false, code: "empty", error: "Write a message first." };
  if (clean.length > MAX_TEXT) return { ok: false, code: "too_long", error: `Keep messages under ${MAX_TEXT} characters.` };
  const message = { id: id || `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 7)}`, from, text: clean, at: now.toISOString() };
  const next = [...(Array.isArray(list) ? list : []), message].slice(-MAX_MESSAGES);
  return { ok: true, list: next, message };
}

export function createRfqMessagesHandler(deps) {
  const { getPool, readBody, sendJson, ensureColumns, loadInvites, publicRfqRequest, logRfqEvent, findContactInfo, auditKind } = deps;

  return async function handleRfqMessages(req, res, rfqId, inviteId) {
    const body = await readBody(req);
    const kind = body?.kind;
    if (kind !== "message" && kind !== "event") return sendJson(res, 400, { error: "kind must be message or event" });
    const key = auditKind ? auditKind(req) : null;
    const actor = kind === "event" ? "dealer" : body?.from;
    if (actor !== "buyer" && actor !== "dealer") return sendJson(res, 400, { error: "from must be buyer or dealer" });
    if ((key === "audit" && actor !== "buyer") || (key === "audit_dealer" && actor !== "dealer")) {
      return sendJson(res, 403, { error: `Forbidden: this key can only act as the ${key === "audit" ? "buyer" : "dealer"}` });
    }
    if (kind === "event" && !EVENT_TYPES.has(body?.type)) return sendJson(res, 400, { error: "unknown event type" });

    const pool = getPool();
    await ensureColumns(pool);
    const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
    const rfq = rfqRows[0];
    if (!rfq || rfq.deleted_at) return sendJson(res, 404, { error: "RFQ not found" });
    if (rfq.approval_status && rfq.approval_status !== "approved") return sendJson(res, 409, { error: "This request hasn't been released to dealers." });
    if (rfq.status === "walked") return sendJson(res, 409, { error: "closed", code: "closed" });
    const [inviteRows] = await pool.query("SELECT * FROM rfq_invites WHERE id = ? AND rfq_id = ?", [inviteId, rfqId]);
    const invite = inviteRows[0];
    if (!invite) return sendJson(res, 404, { error: "Invite not found" });
    if (invite.status === "declined" || invite.status === "expired") return sendJson(res, 409, { error: "This dealer is no longer in the running.", code: "closed" });
    if (invite.not_selected_at) return sendJson(res, 409, { error: "This quote is closed.", code: "closed" });
    if (invite.dealer_unsubscribed_at) return sendJson(res, 409, { error: "This dealership is no longer accepting requests on TrimScout.", code: "closed" });

    if (kind === "event") {
      const overrides = (Array.isArray(body.overrides) ? body.overrides : []).slice(0, 4).map((o) => ({
        key: String(o?.key || "").slice(0, 32), label: String(o?.label || "").slice(0, 60),
        calculated: Number(o?.calculated) || 0, amount: Number(o?.amount) || 0, reason: String(o?.reason || "").slice(0, 140),
      }));
      await logRfqEvent(pool, rfqId, body.type, { inviteId, dealerName: invite.dealer_name, actor: "dealer", overrides, vin: null, stockNumber: null, mustHaves: [] });
      return sendJson(res, 200, { ok: true });
    }

    const found = findContactInfo ? findContactInfo(String(body.text ?? "")) : null;
    if (found) return sendJson(res, 400, { error: `Messages can't include ${found} — TrimScout passes them along without sharing contact details.`, code: "contact_info" });

    const rawBefore = invite.messages_json ?? null;
    const outcome = appendMessage(parse(rawBefore), { from: actor, text: body.text });
    if (!outcome.ok) return sendJson(res, 400, { error: outcome.error, code: outcome.code });
    // Optimistic lock: only write if nobody posted between our read and our write.
    const [upd] = await pool.query("UPDATE rfq_invites SET messages_json = ? WHERE id = ? AND rfq_id = ? AND (messages_json <=> ?)", [JSON.stringify(outcome.list), inviteId, rfqId, rawBefore]);
    if (upd.affectedRows === 0) return sendJson(res, 409, { error: "Someone just posted. Try again.", code: "stale" });

    const [freshRfq] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
    const invites = await loadInvites(pool, rfqId);
    sendJson(res, 200, { rfq: publicRfqRequest(freshRfq[0], invites), message: outcome.message });
  };
}
