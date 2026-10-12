// The admin side of the conversation guard (rfqChatGuard.js): the review queue of held and reported messages with Release / Block,
// the list of paused dealers with a lift, and the pause status the dealer's chat panel reads. All server-to-server behind the app's
// admin session; the box only trusts its API key. Emails to Paul (SAFE MODE) are the Next app's job: a decision that pauses a dealer
// reports justPaused so the app can send it.
//
//   GET  /api/admin/chat-review                 pending items, oldest first
//   POST /api/admin/chat-review/:id             { decision: "release" | "block", by }
//        held     + release -> the message is delivered to the thread now       + block -> counts as an attempt (held-then-blocked)
//        reported + release -> dismissed, the message stays                     + block -> the message is hidden from both sides and counts as an attempt
//   GET  /api/admin/chat-pauses                 dealers whose chat is paused
//   POST /api/admin/chat-pauses/lift            { dealerKey, by }   attempts before the lift stop counting
//   GET  /api/rfqs/:id/invites/:inviteId/chat-status    { paused } for that invite's dealer
import { appendMessage } from "./rfqMessages.js";
import { dealerKeyOf, ensureGuardTables, isPaused, recordAttempt } from "./rfqChatGuard.js";

const parse = (v) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
};

export function createChatAdminHandlers(deps) {
  const { getPool, readBody, sendJson, ensureColumns } = deps;

  async function pool() {
    const p = getPool();
    await ensureColumns(p);
    await ensureGuardTables(p);
    return p;
  }

  async function list(req, res) {
    const p = await pool();
    const [rows] = await p.query("SELECT r.id, r.rfq_id, r.invite_id, r.sender, r.kind, r.message_id, r.text, r.reason, r.reporter, r.created_at, i.dealer_name FROM rfq_chat_review r LEFT JOIN rfq_invites i ON i.id = r.invite_id WHERE r.status = 'pending' ORDER BY r.id");
    sendJson(res, 200, { items: rows.map((r) => ({ id: r.id, rfqId: r.rfq_id, inviteId: r.invite_id, sender: r.sender, kind: r.kind, messageId: r.message_id, text: r.text, reason: r.reason, reporter: r.reporter, createdAt: r.created_at, dealerName: r.dealer_name || null })) });
  }

  async function decide(req, res, id) {
    const body = await readBody(req);
    const decision = body?.decision;
    if (decision !== "release" && decision !== "block") return sendJson(res, 400, { error: "decision must be release or block" });
    const by = String(body?.by || "admin").slice(0, 120);
    const p = await pool();
    const [rows] = await p.query("SELECT * FROM rfq_chat_review WHERE id = ?", [id]);
    const item = rows[0];
    if (!item) return sendJson(res, 404, { error: "Review item not found" });
    if (item.status !== "pending") return sendJson(res, 409, { error: "Already decided", code: "decided" });
    const [invRows] = await p.query("SELECT * FROM rfq_invites WHERE id = ? AND rfq_id = ?", [item.invite_id, item.rfq_id]);
    const invite = invRows[0];
    if (!invite) return sendJson(res, 404, { error: "Invite not found" });
    const dealerKey = dealerKeyOf(invite);
    const now = new Date();
    let strike = null;

    if (item.kind === "held" && decision === "release") {
      const before = invite.messages_json ?? null;
      const out = appendMessage(parse(before), { from: item.sender, text: item.text }, now);
      if (!out.ok) return sendJson(res, 400, { error: out.error });
      const [upd] = await p.query("UPDATE rfq_invites SET messages_json = ? WHERE id = ? AND rfq_id = ? AND (messages_json <=> ?)", [JSON.stringify(out.list), item.invite_id, item.rfq_id, before]);
      if (upd.affectedRows === 0) return sendJson(res, 409, { error: "The thread just changed. Try again.", code: "stale" });
    } else if (item.kind === "held" && decision === "block") {
      strike = await recordAttempt(p, { dealerKey, side: item.sender, rfqId: item.rfq_id, inviteId: item.invite_id, kind: "held_blocked", reason: item.reason, now });
    } else if (item.kind === "reported" && decision === "block") {
      const before = invite.messages_json ?? null;
      const list = (parse(before) || []).map((m) => (m && m.id === item.message_id ? { ...m, hidden: true, text: "" } : m));
      const [upd] = await p.query("UPDATE rfq_invites SET messages_json = ? WHERE id = ? AND rfq_id = ? AND (messages_json <=> ?)", [JSON.stringify(list), item.invite_id, item.rfq_id, before]);
      if (upd.affectedRows === 0) return sendJson(res, 409, { error: "The thread just changed. Try again.", code: "stale" });
      strike = await recordAttempt(p, { dealerKey, side: "dealer", rfqId: item.rfq_id, inviteId: item.invite_id, kind: "reported_blocked", reason: "reported by the buyer", now });
    }
    const status = decision === "release" ? "released" : "blocked";
    const [upd] = await p.query("UPDATE rfq_chat_review SET status = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'", [status, now, by, id]);
    if (upd.affectedRows === 0) return sendJson(res, 409, { error: "Already decided", code: "decided" });
    sendJson(res, 200, { ok: true, status, dealerName: invite.dealer_name, attempts: strike?.attempts ?? null, paused: strike?.paused ?? false, justPaused: strike?.justPaused ?? false });
  }

  async function pauses(req, res) {
    const p = await pool();
    const [rows] = await p.query("SELECT id, dealer_key, paused_at, reason FROM rfq_chat_pauses WHERE lifted_at IS NULL ORDER BY id");
    sendJson(res, 200, { pauses: rows.map((r) => ({ id: r.id, dealerKey: r.dealer_key, pausedAt: r.paused_at, reason: r.reason })) });
  }

  async function lift(req, res) {
    const body = await readBody(req);
    const dealerKey = String(body?.dealerKey || "").trim().toLowerCase();
    if (!dealerKey) return sendJson(res, 400, { error: "dealerKey is required" });
    const p = await pool();
    const [upd] = await p.query("UPDATE rfq_chat_pauses SET lifted_at = ?, lifted_by = ? WHERE dealer_key = ? AND lifted_at IS NULL", [new Date(), String(body?.by || "admin").slice(0, 120), dealerKey]);
    if (upd.affectedRows === 0) return sendJson(res, 404, { error: "That dealer's chat isn't paused." });
    sendJson(res, 200, { ok: true });
  }

  async function status(req, res, rfqId, inviteId) {
    const p = await pool();
    const [rows] = await p.query("SELECT * FROM rfq_invites WHERE id = ? AND rfq_id = ?", [inviteId, rfqId]);
    if (!rows[0]) return sendJson(res, 404, { error: "Invite not found" });
    sendJson(res, 200, { paused: await isPaused(p, dealerKeyOf(rows[0])) });
  }

  return { list, decide, pauses, lift, status };
}
