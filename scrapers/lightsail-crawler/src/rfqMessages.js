// POST /api/rfqs/:id/invites/:inviteId/messages — the buyer <-> dealer chat on one desk's quote, the buyer's "Report" on a dealer
// message, and the one deal event the app logs for a dealer's fee override. Kept out of deals_api_server.js behind injected
// dependencies so it can be unit-tested without a database and added to the live server by a small anchored patch.
//
// Body: { kind: "message", from: "buyer" | "dealer", text, aiVerdict? }
//       { kind: "report", messageId }                       the buyer flags a dealer message -> admin review queue (message stays until an admin blocks it)
//       { kind: "event", type: "fee_override", overrides }  logged to rfq_events (dealer only); the thread itself is not touched
//
// A thread belongs to ONE invite. Every chat message is screened (identityFilter.js: names, phone numbers in any form, emails,
// handles, social platforms, addresses, non-trimscout.com links, files; plus the sender's last five messages joined together) before it
// is stored, and the response says what happened:
//   delivered     stored in the thread
//   blocked       refused; logged as an attempt (never the text); a dealer's first attempt carries a warning, the third in 30 days pauses
//                 that dealer's chat everywhere (rfqChatGuard.js). The text is never shown to the other side.
//   needs_review  clears every rule but scores as borderline: the Next app asks the AI and re-posts with aiVerdict "yes" | "no" | "unavailable"
//   held          the AI check failed or timed out: parked in the admin queue, not delivered
//   paused        the dealer's chat is paused
// Emails (SAFE MODE) are the Next app's job. Scoped audit keys are pinned to their own side (buyer key -> "buyer", test dealer -> "dealer").
import { hasAttachment, screenMessage, CROSS_MESSAGE_WINDOW } from "./identityFilter.js";
import { BLOCKED_NOTE, dealerKeyOf, enqueueReview, ensureGuardTables, FIRST_WARNING, HELD_NOTE, isPaused, PAUSED_NOTE, recordAttempt } from "./rfqChatGuard.js";

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

/** The sender's last delivered messages in this thread (hidden ones excluded), oldest first. */
export function previousFrom(list, from, n = CROSS_MESSAGE_WINDOW) {
  return (Array.isArray(list) ? list : []).filter((m) => m && m.from === from && !m.hidden && m.text).map((m) => m.text).slice(-n);
}

export function createRfqMessagesHandler(deps) {
  const { getPool, readBody, sendJson, ensureColumns, loadInvites, publicRfqRequest, logRfqEvent, findContactInfo, auditKind } = deps;

  return async function handleRfqMessages(req, res, rfqId, inviteId) {
    const body = await readBody(req);
    const kind = body?.kind;
    if (kind !== "message" && kind !== "event" && kind !== "report") return sendJson(res, 400, { error: "kind must be message, report or event" });
    const key = auditKind ? auditKind(req) : null;
    const actor = kind === "event" ? "dealer" : kind === "report" ? "buyer" : body?.from;
    if (actor !== "buyer" && actor !== "dealer") return sendJson(res, 400, { error: "from must be buyer or dealer" });
    if ((key === "audit" && actor !== "buyer") || (key === "audit_dealer" && actor !== "dealer")) {
      return sendJson(res, 403, { error: `Forbidden: this key can only act as the ${key === "audit" ? "buyer" : "dealer"}` });
    }
    if (kind === "event" && !EVENT_TYPES.has(body?.type)) return sendJson(res, 400, { error: "unknown event type" });
    if (kind === "message" && hasAttachment(body)) return sendJson(res, 400, { error: "No images or files in chat.", code: "attachment" });

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

    await ensureGuardTables(pool);
    const dealerKey = dealerKeyOf(invite);
    const thread = parse(invite.messages_json);

    if (kind === "report") {
      const msg = (Array.isArray(thread) ? thread : []).find((m) => m && m.id === String(body.messageId ?? "") && m.from === "dealer" && !m.hidden);
      if (!msg) return sendJson(res, 404, { error: "Message not found" });
      const q = await enqueueReview(pool, { rfqId, inviteId, sender: "dealer", kind: "reported", messageId: msg.id, text: msg.text, reason: "reported by the buyer", reporter: "buyer" });
      return sendJson(res, 200, { status: "reported", duplicate: q.duplicate });
    }

    // From here: a chat message.
    if (actor === "dealer" && (await isPaused(pool, dealerKey))) return sendJson(res, 200, { status: "paused", note: PAUSED_NOTE });
    const checked = appendMessage([], { from: actor, text: body.text });
    if (!checked.ok) return sendJson(res, 400, { error: checked.error, code: checked.code });
    const text = checked.message.text;

    let blockedReason = null;
    const screen = screenMessage({ text, previous: previousFrom(thread, actor) });
    if (screen.verdict === "block") blockedReason = screen.reason;
    else if (findContactInfo && findContactInfo(text)) blockedReason = "contact information";
    let review = !blockedReason && screen.verdict === "review";
    if (review && body.aiVerdict === "no") review = false;
    else if (review && body.aiVerdict === "yes") { blockedReason = "AI review"; review = false; }

    if (blockedReason) {
      const a = await recordAttempt(pool, { dealerKey, side: actor, rfqId, inviteId, kind: "blocked", reason: blockedReason });
      return sendJson(res, 200, { status: "blocked", note: BLOCKED_NOTE, warning: a.warning ? FIRST_WARNING : null, attempts: a.attempts, paused: a.paused, justPaused: a.justPaused });
    }
    if (review) {
      if (body.aiVerdict === undefined) return sendJson(res, 200, { status: "needs_review", score: screen.score });
      // "unavailable" (error or timeout) or anything else: never deliver on a failed check; park it for an admin.
      await enqueueReview(pool, { rfqId, inviteId, sender: actor, kind: "held", text, reason: `held: AI check ${body.aiVerdict === "unavailable" ? "unavailable" : "inconclusive"}` });
      return sendJson(res, 200, { status: "held", note: HELD_NOTE });
    }

    const rawBefore = invite.messages_json ?? null;
    const outcome = appendMessage(parse(rawBefore), { from: actor, text });
    if (!outcome.ok) return sendJson(res, 400, { error: outcome.error, code: outcome.code });
    // Optimistic lock: only write if nobody posted between our read and our write.
    const [upd] = await pool.query("UPDATE rfq_invites SET messages_json = ? WHERE id = ? AND rfq_id = ? AND (messages_json <=> ?)", [JSON.stringify(outcome.list), inviteId, rfqId, rawBefore]);
    if (upd.affectedRows === 0) return sendJson(res, 409, { error: "Someone just posted. Try again.", code: "stale" });

    const [freshRfq] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
    const invites = await loadInvites(pool, rfqId);
    sendJson(res, 200, { status: "delivered", rfq: publicRfqRequest(freshRfq[0], invites), message: outcome.message });
  };
}
