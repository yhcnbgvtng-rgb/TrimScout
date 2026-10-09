// Scoped "audit" API key for TrimScout's AI auditor.
//
// The deals API historically had ONE shared key (TRIMSCOUT_API_KEY) that can do
// everything. The auditor needs to act as a single test buyer: read that buyer's
// requests/bids and create test RFQs, and nothing else. This module is the whole
// policy, kept free of I/O (the DB ownership lookup is injected) so it is unit-tested
// without booting the server.
//
// Default DENY: a request the table below does not explicitly allow is a 403 — new
// routes added to deals_api_server.js are therefore closed to this key until someone
// opts them in here.
import { timingSafeEqual } from "node:crypto";

export const AUDIT_RATE_LIMIT = 60; // requests
export const AUDIT_RATE_WINDOW_MS = 60_000; // per minute

function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ""));
  const bb = Buffer.from(String(b ?? ""));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Who is calling? "full" (the shared key), "audit" (the scoped buyer key), "audit_dealer" (the scoped
 * test-dealer key), or null. A scoped key is only honoured when it differs from every other key and its
 * config is complete (the buyer key also needs TRIMSCOUT_AUDIT_BUYER_USER_ID), so a half-configured box
 * fails closed — those calls get 401, never silently full access.
 */
export function authenticate(headerKey, env = process.env) {
  const fullKey = env.TRIMSCOUT_API_KEY;
  const auditKey = env.TRIMSCOUT_AUDIT_API_KEY;
  const dealerKey = env.TRIMSCOUT_AUDIT_DEALER_KEY;
  const auditBuyerUserId = String(env.TRIMSCOUT_AUDIT_BUYER_USER_ID ?? "").trim();
  if (typeof headerKey !== "string" || headerKey === "") return null;
  if (fullKey && safeEqual(headerKey, fullKey)) return { kind: "full" };
  if (auditKey && auditBuyerUserId && auditKey !== fullKey && auditKey !== dealerKey && safeEqual(headerKey, auditKey)) {
    return { kind: "audit", buyerUserId: auditBuyerUserId };
  }
  if (dealerKey && dealerKey !== fullKey && dealerKey !== auditKey && safeEqual(headerKey, dealerKey)) {
    return { kind: "audit_dealer" };
  }
  return null;
}

/** Fixed sliding window per key; `now` is injectable for tests. */
export function createRateLimiter({ limit = AUDIT_RATE_LIMIT, windowMs = AUDIT_RATE_WINDOW_MS, now = Date.now } = {}) {
  let hits = [];
  return {
    /** Records the attempt. Returns { ok, retryAfterSeconds }. Rejected attempts do not extend the window. */
    take() {
      const t = now();
      hits = hits.filter((h) => t - h < windowMs);
      if (hits.length >= limit) {
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (t - hits[0])) / 1000)) };
      }
      hits.push(t);
      return { ok: true, retryAfterSeconds: 0 };
    },
  };
}


// ---------------------------------------------------------------------
// Route policy, one table per key.
//   ownership  the table whose buyer_user_id must be the audit buyer for :id (capture group 1)
//   guard      a named DB-backed check run by evaluateGuard() before the handler (ids from the path)
//   bodyGuard  the handler itself runs the matching verdict (it needs the request body)
//   params     { name: "BUYER" } must equal the audit buyer; anything not listed is rejected, so
//              e.g. ?all=1 can't widen a list. anyParams opts a public-data route out of the check.
// ---------------------------------------------------------------------
export const AUDIT_ROUTES = [
  // test RFQs: create + read back
  { method: "POST", re: /^\/api\/rfqs$/, label: "POST /api/rfqs", forceBuyer: true },
  { method: "GET", re: /^\/api\/rfqs$/, label: "GET /api/rfqs", params: { buyerUserId: "BUYER" }, requiredParams: ["buyerUserId"] },
  { method: "GET", re: /^\/api\/rfqs\/(\d+)$/, label: "GET /api/rfqs/:id", ownership: "rfq_requests" },
  // bids / requests: create (audit-flagged, own buyer) + reads
  { method: "POST", re: /^\/api\/deal-requests$/, label: "POST /api/deal-requests", forceBuyer: true },
  { method: "GET", re: /^\/api\/deal-requests$/, label: "GET /api/deal-requests", params: { buyerUserId: "BUYER" }, allowParams: ["status"], requiredParams: ["buyerUserId"] },
  { method: "GET", re: /^\/api\/deal-requests\/(\d+)$/, label: "GET /api/deal-requests/:id", ownership: "deal_requests" },
  { method: "GET", re: /^\/api\/deal-requests\/(\d+)\/bids$/, label: "GET /api/deal-requests/:id/bids", ownership: "deal_requests" },
  { method: "GET", re: /^\/api\/deal-requests\/(\d+)\/bids\/\d+$/, label: "GET /api/deal-requests/:id/bids/:bidId", ownership: "deal_requests" },
  { method: "GET", re: /^\/api\/deal-requests\/(\d+)\/market$/, label: "GET /api/deal-requests/:id/market", ownership: "deal_requests" },
  // buyer counter + deal: only on audit RFQs / audit requests whose dealers are all is_test
  { method: "POST", re: /^\/api\/rfqs\/(\d+)\/invites\/(\d+)\/buyer-counter$/, label: "POST /api/rfqs/:id/invites/:inviteId/buyer-counter", guard: "buyer_counter" },
  { method: "POST", re: /^\/api\/deals$/, label: "POST /api/deals", bodyGuard: "deal_create" },
  // invite its own audit RFQ to the is_test dealers (and only them: the handler's inviteCreationVerdict 403s any other dealer)
  { method: "POST", re: /^\/api\/rfqs\/(\d+)\/invites$/, label: "POST /api/rfqs/:id/invites", guard: "buyer_rfq", bodyGuard: "invite_create" },
  // inventory search, so the auditor can pick a VIN for an RFQ (public listing data; no export/ops)
  { method: "GET", re: /^\/api\/inventory$/, label: "GET /api/inventory", anyParams: true },
  { method: "GET", re: /^\/api\/inventory\/vin\/[A-HJ-NPR-Z0-9]{17}$/i, label: "GET /api/inventory/vin/:vin" },
  { method: "GET", re: /^\/api\/inventory\/makes$/, label: "GET /api/inventory/makes" },
  { method: "GET", re: /^\/api\/inventory\/facets$/, label: "GET /api/inventory/facets", anyParams: true },
];

// The test-dealer key: view an invite, quote, decline / re-quote after a buyer counter, bid on an audit
// request. Every route is bound to an audit RFQ/request AND an is_test dealer by a guard.
export const AUDIT_DEALER_ROUTES = [
  { method: "GET", re: /^\/api\/rfq-invites\/by-token\/([A-Za-z0-9_-]{8,80})$/, label: "GET /api/rfq-invites/by-token/:token", guard: "dealer_token" },
  { method: "GET", re: /^\/api\/rfqs\/(\d+)$/, label: "GET /api/rfqs/:id", guard: "dealer_rfq" },
  { method: "POST", re: /^\/api\/rfqs\/(\d+)\/invites\/(\d+)\/quotes$/, label: "POST /api/rfqs/:id/invites/:inviteId/quotes", guard: "dealer_invite" },
  { method: "POST", re: /^\/api\/rfqs\/(\d+)\/invites\/(\d+)\/decline$/, label: "POST /api/rfqs/:id/invites/:inviteId/decline", guard: "dealer_invite" },
  { method: "GET", re: /^\/api\/deal-requests\/(\d+)$/, label: "GET /api/deal-requests/:id", guard: "audit_request" },
  { method: "POST", re: /^\/api\/deal-requests\/(\d+)\/bids$/, label: "POST /api/deal-requests/:id/bids", guard: "audit_request", bodyGuard: "bid_submit" },
];

const ALL_ROUTES = [...AUDIT_ROUTES, ...AUDIT_DEALER_ROUTES];

/** A stable, id-free label for logs, including for denied/unknown routes. */
export function routeLabel(method, pathname) {
  const hit = ALL_ROUTES.find((r) => r.method === method && r.re.test(pathname));
  if (hit) return hit.label;
  const generic = pathname
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/\/[A-HJ-NPR-Z0-9]{17}(?=\/|$)/gi, "/:vin")
    .replace(/(by-token\/)[^/]+/, "$1:token");
  return `${method} ${generic}`;
}

function authorizeIn(table, method, pathname, searchParams, buyerUserId) {
  const route = routeLabel(method, pathname);
  const deny = (error) => ({ allowed: false, status: 403, error, route });
  const entry = table.find((r) => r.method === method && r.re.test(pathname));
  if (!entry) return deny("Forbidden: this key cannot call that route");

  const seen = new Set();
  for (const [name, value] of searchParams) {
    seen.add(name);
    if (entry.anyParams) continue;
    if (entry.params && name in entry.params) {
      if (entry.params[name] === "BUYER" && String(value).trim() !== buyerUserId) {
        return deny("Forbidden: this key is limited to its own test buyer");
      }
      continue;
    }
    if (entry.allowParams && entry.allowParams.includes(name)) continue;
    return deny(`Forbidden: query parameter "${name}" is not allowed for this key`);
  }
  for (const name of entry.requiredParams || []) {
    if (!seen.has(name)) return deny(`Forbidden: ${name} is required for this key`);
  }

  const m = pathname.match(entry.re);
  const out = { allowed: true, route };
  if (entry.ownership) out.ownership = { table: entry.ownership, id: Number(m[1]) };
  if (entry.forceBuyer) out.forceBuyer = true;
  if (entry.bodyGuard) out.bodyGuard = entry.bodyGuard;
  if (entry.guard) {
    out.guard =
      entry.guard === "dealer_token" ? { kind: entry.guard, token: m[1] }
      : entry.guard === "dealer_invite" || entry.guard === "buyer_counter" ? { kind: entry.guard, rfqId: Number(m[1]), inviteId: Number(m[2]) }
      : entry.guard === "dealer_rfq" || entry.guard === "buyer_rfq" ? { kind: entry.guard, rfqId: Number(m[1]) }
      : { kind: entry.guard, dealRequestId: Number(m[1]) };
  }
  return out;
}

/**
 * Decide whether the audit BUYER key may make this request.
 * Returns { allowed: true, route, ownership?, guard?, bodyGuard?, forceBuyer? } or
 * { allowed: false, status: 403, error, route }. Pure: DB-backed checks happen in the caller.
 */
export function authorizeAudit(method, pathname, searchParams, buyerUserId) {
  return authorizeIn(AUDIT_ROUTES, method, pathname, searchParams, buyerUserId);
}

/** Same, for the audit TEST-DEALER key (no query parameters are accepted at all). */
export function authorizeAuditDealer(method, pathname, searchParams) {
  return authorizeIn(AUDIT_DEALER_ROUTES, method, pathname, searchParams, null);
}

/**
 * Ownership gate: the row must exist AND belong to the audit buyer. A missing row and a
 * someone-else's row both come back as 403 so the key can't be used to probe which ids exist.
 * `lookupBuyerId(table, id)` resolves to the row's buyer_user_id (string/number) or null.
 */
export async function checkOwnership(ownership, buyerUserId, lookupBuyerId) {
  const owner = await lookupBuyerId(ownership.table, ownership.id);
  return owner != null && String(owner) === buyerUserId;
}

// ---------------------------------------------------------------------
// Verdicts: who may touch whom. Pure functions over already-loaded rows (column names as in the
// DB) so they are unit-tested without a database. null = allowed, else { status, error }.
//
// "Test dealer" = a dealership_contacts row with is_test = 1 (`testDealers` is that list as
// { dealer_name, contact_email }). An invite is a test invite only when BOTH its dealer name and
// contact email match the same row, so a real dealer can't pass by sharing a name or an address.
// ---------------------------------------------------------------------
const norm = (s) => String(s ?? "").trim().toLowerCase();
const forbid = (error) => ({ status: 403, error: `Forbidden: ${error}` });
const live = (row) => Boolean(row) && !row.deleted_at;
const flagged = (v) => Number(v) === 1 || v === true;

export function isTestDealerName(testDealers, name) {
  return testDealers.some((d) => norm(d.dealer_name) === norm(name) && norm(name) !== "");
}
export function isTestInvite(testDealers, invite) {
  return testDealers.some(
    (d) => norm(d.dealer_name) === norm(invite?.dealer_name) && norm(d.contact_email) !== "" && norm(d.contact_email) === norm(invite?.dealer_contact_email)
  );
}
function isTestEmail(testDealers, email) {
  return norm(email) !== "" && testDealers.some((d) => norm(d.contact_email) === norm(email));
}

/** Applies to EVERY key, including the full key: audit RFQs only ever invite test dealers, and test dealers only ever get audit RFQs. */
export function inviteCreationVerdict({ rfq, dealerName, dealerEmail, testDealers }) {
  const testDealer = isTestInvite(testDealers, { dealer_name: dealerName, dealer_contact_email: dealerEmail });
  if (flagged(rfq?.audit_forced_safe)) {
    return testDealer ? null : forbid("an audit RFQ can only invite test dealers");
  }
  if (testDealer || isTestDealerName(testDealers, dealerName) || isTestEmail(testDealers, dealerEmail)) {
    return forbid("test dealers can only be invited to audit RFQs");
  }
  return null;
}

/** Test-dealer key on one invite: the RFQ is an audit RFQ and this invite's dealer is a test dealer. */
export function dealerInviteVerdict({ rfq, invite, testDealers }) {
  if (!live(rfq) || !flagged(rfq.audit_forced_safe)) return forbid("not an audit RFQ");
  if (!live(invite) || Number(invite.rfq_id) !== Number(rfq.id)) return forbid("not an audit invite");
  if (!isTestInvite(testDealers, invite)) return forbid("not a test dealer");
  return null;
}

/** Test-dealer key reading an RFQ: audit RFQ whose every invite is a test invite (it carries all invites' quotes). */
export function dealerRfqVerdict({ rfq, invites, testDealers }) {
  if (!live(rfq) || !flagged(rfq.audit_forced_safe)) return forbid("not an audit RFQ");
  if (!invites.every((i) => isTestInvite(testDealers, i))) return forbid("RFQ has a non-test dealer");
  return null;
}

/** Buyer key countering: own audit RFQ, and the countered desk is a test dealer. */
export function counterVerdict({ buyerUserId, rfq, invite, testDealers }) {
  if (!live(rfq) || String(rfq.buyer_user_id) !== String(buyerUserId)) return forbid("this key is limited to its own test buyer");
  return dealerInviteVerdict({ rfq, invite, testDealers });
}

/** Buyer key inviting dealers: its own audit RFQ. Which dealers is checked per request by inviteCreationVerdict. */
export function buyerRfqVerdict({ buyerUserId, rfq }) {
  if (!live(rfq) || String(rfq.buyer_user_id) !== String(buyerUserId)) return forbid("this key is limited to its own test buyer");
  if (!flagged(rfq.audit_forced_safe)) return forbid("not an audit RFQ");
  return null;
}

/** Test-dealer key on a deal request (read it / bid on it): must be an audit request. */
export function auditRequestVerdict({ dealRequest }) {
  if (!live(dealRequest) || !flagged(dealRequest.audit)) return forbid("not an audit request");
  return null;
}

/**
 * Submitting a bid (every key): bids on an audit request come only from test dealers, and a test
 * dealer only bids on audit requests. `principal` is the caller kind.
 */
export function bidVerdict({ dealRequest, dealerName, testDealers, principal }) {
  const isAuditRequest = live(dealRequest) && flagged(dealRequest.audit);
  const testDealer = isTestDealerName(testDealers, dealerName);
  if (principal === "audit_dealer" && !isAuditRequest) return forbid("not an audit request");
  if (isAuditRequest && !testDealer) return forbid("an audit request only accepts bids from test dealers");
  if (!isAuditRequest && testDealer) return forbid("test dealers can only bid on audit requests");
  return null;
}

/**
 * Creating a deal. Buyer key (buyerUserId set): must reference its own audit request and a live audit
 * bid by a test dealer for that same request, with matching dealer/VIN. Any other key (buyerUserId
 * null): the same pairing rule, so a real dealer's bid can never be tied to an audit request.
 */
export function dealVerdict({ buyerUserId, dealRequest, bid, body, testDealers }) {
  const auditRequest = live(dealRequest) && flagged(dealRequest.audit);
  const auditBid = live(bid) && flagged(bid.audit);
  if (buyerUserId != null) {
    if (!body?.dealRequestId || !body?.bidId) return forbid("dealRequestId and bidId are required for this key");
    if (!live(dealRequest) || String(dealRequest.buyer_user_id) !== String(buyerUserId)) return forbid("this key is limited to its own test buyer");
    if (!auditRequest) return forbid("not an audit request");
    if (!live(bid) || Number(bid.deal_request_id) !== Number(dealRequest.id)) return forbid("bid does not belong to that request");
  }
  if (!dealRequest && !bid) return null; // full-key deal with no auction link: untouched legacy behaviour
  if (auditRequest || auditBid) {
    if (!auditRequest || !auditBid || Number(bid.deal_request_id) !== Number(dealRequest.id)) return forbid("audit deals must pair an audit request with its audit bid");
    if (!isTestDealerName(testDealers, bid.dealer_name)) return forbid("not a test dealer");
    if (norm(body?.dealerName) !== norm(bid.dealer_name) || norm(body?.matchedVin) !== norm(bid.matched_vin)) return forbid("deal does not match the bid");
  } else if (bid && isTestDealerName(testDealers, bid.dealer_name)) {
    return forbid("test dealers can only be part of audit deals");
  }
  return null;
}

/**
 * Runs a path-level guard. `db` supplies already-live-filtered lookups:
 *   rfq(id), invite(id), inviteByToken(token), invitesForRfq(rfqId), dealRequest(id), testDealers()
 * Missing rows come back as the same 403 as foreign rows (no id probing).
 */
export async function evaluateGuard(guard, principal, db) {
  const testDealers = await db.testDealers();
  switch (guard.kind) {
    case "dealer_token": {
      const invite = await db.inviteByToken(guard.token);
      const rfq = invite ? await db.rfq(invite.rfq_id) : null;
      return dealerInviteVerdict({ rfq, invite, testDealers });
    }
    case "dealer_invite": {
      const [rfq, invite] = [await db.rfq(guard.rfqId), await db.invite(guard.inviteId)];
      return dealerInviteVerdict({ rfq, invite, testDealers });
    }
    case "dealer_rfq": {
      const rfq = await db.rfq(guard.rfqId);
      return dealerRfqVerdict({ rfq, invites: rfq ? await db.invitesForRfq(rfq.id) : [], testDealers });
    }
    case "buyer_counter": {
      const [rfq, invite] = [await db.rfq(guard.rfqId), await db.invite(guard.inviteId)];
      return counterVerdict({ buyerUserId: principal.buyerUserId, rfq, invite, testDealers });
    }
    case "buyer_rfq":
      return buyerRfqVerdict({ buyerUserId: principal.buyerUserId, rfq: await db.rfq(guard.rfqId) });
    case "audit_request":
      return auditRequestVerdict({ dealRequest: await db.dealRequest(guard.dealRequestId) });
    default:
      return forbid("unknown guard");
  }
}

/** One JSON line per call. Never includes the key or the query string (route template + status only). */
export function auditLogLine({ method, pathname, status, ms, kind = "audit", now = new Date() }) {
  return JSON.stringify({
    audit_key: true,
    key: kind,
    at: now.toISOString(),
    route: routeLabel(method, pathname),
    status,
    ms,
  });
}
