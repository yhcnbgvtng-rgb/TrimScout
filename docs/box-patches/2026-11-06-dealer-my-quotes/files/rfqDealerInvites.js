// Dealer "My Quotes" on the deals box. Kept out of deals_api_server.js behind injected dependencies (like rfqNotSelected.js)
// so it is unit-tested without a database.
//
//   GET  /api/dealer-invites?dealerUserId=…   every released RFQ invite linked to that dealer ACCOUNT (rfq_invites.dealer_user_id).
//        Never a dealer-name match: an invite that was never linked to the account is simply not listed.
//        Audit RFQs are listed only when the invite itself is for an is_test dealer; a real dealer never sees them.
//        Rows carry facts only (the Next app derives the dealer-facing status); the deal stage always goes through
//        stageForDealer, and the buyer's contact details never leave this endpoint.
//   POST /api/dealer-invites/claim { dealerUserId, viewToken }   link the invite behind a tracked link to the signed-in dealer
//        account (first authenticated use of the token). Idempotent for the same account; a different account is refused.
import { stageForDealer } from "./dealStages.js";

// A "test dealer" is a dealership_contacts row with is_test = 1 (rows: { dealer_name, contact_email }). Matched on the invite's
// dealer name or its contact email. Local on purpose: the live box's auditKey.js predates isTestInvite, so importing it would
// stop deals-api from starting.
const norm = (v) => String(v ?? "").trim().toLowerCase();
export function isTestInvite(testDealers, invite) {
  const name = norm(invite.dealer_name);
  const email = norm(invite.dealer_contact_email);
  return (testDealers || []).some((d) => (name !== "" && norm(d.dealer_name) === name) || (email !== "" && norm(d.contact_email) === email));
}

export const MAX_ROWS = 500;
const USER_ID = /^[A-Za-z0-9_.:@-]{1,128}$/;
const TOKEN = /^[A-Za-z0-9_-]{8,80}$/;

const parse = (v) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
};

const iso = (v) => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);

/** The stage as a dealer may see it: no release contact, ever, on a list. */
export function dealerListStage(stageJson, notSelected) {
  const state = parse(stageJson);
  if (!state) return null;
  const view = stageForDealer(state, { notSelected: Boolean(notSelected) });
  if (view && view.release && "contact" in view.release) {
    const { contact: _contact, ...marker } = view.release;
    return { ...view, release: marker };
  }
  return view;
}

function quoteFact(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    totalOtdPrice: Number(row.total_otd_price),
    submittedAt: iso(row.submitted_at),
    supersededAt: iso(row.superseded_at),
  };
}

export function createDealerInvitesHandlers(deps) {
  const { getPool, readBody, sendJson, ensureColumns, loadTestDealers } = deps;

  async function list(req, res, query) {
    const dealerUserId = String(query.get("dealerUserId") || "").trim();
    if (!USER_ID.test(dealerUserId)) return sendJson(res, 400, { error: "dealerUserId is required" });
    const pool = getPool();
    await ensureColumns(pool);
    // Loaded first: it also makes sure the audit / deleted_at columns the query below reads exist.
    const testDealers = await loadTestDealers(pool);
    const [rows] = await pool.query(
      `SELECT i.*, r.status AS rfq_status, r.picked_quote_id AS rfq_picked_quote_id, r.audit AS rfq_audit,
              r.approval_status AS rfq_approval_status, r.vin AS rfq_vin, r.vehicle_year AS rfq_vehicle_year,
              r.vehicle_make AS rfq_vehicle_make, r.vehicle_model AS rfq_vehicle_model, r.vehicle_trim AS rfq_vehicle_trim,
              r.quote_prefs_json AS rfq_quote_prefs_json, r.lease_prefs_json AS rfq_lease_prefs_json
         FROM rfq_invites i JOIN rfq_requests r ON r.id = i.rfq_id
        WHERE i.dealer_user_id = ? AND i.deleted_at IS NULL AND r.deleted_at IS NULL AND r.approval_status = 'approved'
        ORDER BY i.id DESC LIMIT ${MAX_ROWS}`,
      [dealerUserId]
    );
    const visible = rows.filter((row) => !row.rfq_audit || isTestInvite(testDealers, row));
    const quotesByInvite = new Map();
    if (visible.length) {
      const [quotes] = await pool.query("SELECT * FROM rfq_quotes WHERE invite_id IN (?) ORDER BY id ASC", [visible.map((r) => r.id)]);
      for (const q of quotes) {
        if (q.deleted_at) continue;
        const key = String(q.invite_id);
        const prev = quotesByInvite.get(key);
        // The live quote is the newest one that was not superseded by a buyer counter.
        if (!prev || !q.superseded_at || prev.superseded_at) quotesByInvite.set(key, q);
      }
    }
    const invites = visible.map((row) => {
      const vehicle = parse(row.vehicle_json) || {
        vin: row.rfq_vin || "", year: row.rfq_vehicle_year, make: row.rfq_vehicle_make, model: row.rfq_vehicle_model, trim: row.rfq_vehicle_trim, vdpUrl: null,
      };
      const quote = quotesByInvite.get(String(row.id)) || null;
      return {
        inviteId: String(row.id),
        rfqId: String(row.rfq_id),
        dealerName: row.dealer_name,
        // Server-to-server only: the Next route turns it into a link and never forwards the token itself.
        viewToken: row.view_token || null,
        inviteStatus: row.status,
        invitedAt: iso(row.invited_at),
        respondedAt: iso(row.responded_at),
        viewedAt: iso(row.viewed_at),
        buyerCounterAt: iso(row.buyer_counter_at),
        hasBuyerCounter: Boolean(parse(row.buyer_counter_json)),
        notSelectedAt: iso(row.not_selected_at),
        dealerUnsubscribedAt: iso(row.dealer_unsubscribed_at),
        rfqStatus: row.rfq_status,
        pickedQuoteId: row.rfq_picked_quote_id ? String(row.rfq_picked_quote_id) : null,
        vehicle,
        quote: quoteFact(quote),
        stage: dealerListStage(row.stage_json, row.not_selected_at),
        audit: Boolean(row.rfq_audit),
        testDealer: isTestInvite(testDealers, row),
      };
    });
    sendJson(res, 200, { invites });
  }

  async function claim(req, res) {
    const body = await readBody(req);
    const dealerUserId = String(body?.dealerUserId || "").trim();
    const viewToken = String(body?.viewToken || "").trim();
    if (!USER_ID.test(dealerUserId) || !TOKEN.test(viewToken)) return sendJson(res, 400, { error: "dealerUserId and viewToken are required" });
    const pool = getPool();
    await ensureColumns(pool);
    const [found] = await pool.query("SELECT id, dealer_user_id FROM rfq_invites WHERE view_token = ? AND deleted_at IS NULL", [viewToken]);
    const invite = found[0];
    if (!invite) return sendJson(res, 404, { error: "Invite not found" });
    if (invite.dealer_user_id && invite.dealer_user_id !== dealerUserId) {
      return sendJson(res, 409, { error: "This quote request is already linked to another dealer account.", code: "linked_elsewhere" });
    }
    if (invite.dealer_user_id === dealerUserId) return sendJson(res, 200, { ok: true, claimed: false });
    // Atomic: only an unlinked invite can be taken, so two accounts racing for one token cannot both win.
    const [upd] = await pool.query("UPDATE rfq_invites SET dealer_user_id = ? WHERE id = ? AND dealer_user_id IS NULL", [dealerUserId, invite.id]);
    if (upd.affectedRows > 0) return sendJson(res, 200, { ok: true, claimed: true });
    return sendJson(res, 409, { error: "This quote request is already linked to another dealer account.", code: "linked_elsewhere" });
  }

  return { list, claim };
}
