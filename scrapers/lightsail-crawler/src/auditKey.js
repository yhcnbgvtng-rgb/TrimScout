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
 * Who is calling? "full" (the shared key), "audit" (the scoped key), or null.
 * The audit key is only honoured when BOTH TRIMSCOUT_AUDIT_API_KEY and
 * TRIMSCOUT_AUDIT_BUYER_USER_ID are set and the key differs from the full key, so a
 * half-configured box fails closed (audit calls get 401, never silently full access).
 */
export function authenticate(headerKey, env = process.env) {
  const fullKey = env.TRIMSCOUT_API_KEY;
  const auditKey = env.TRIMSCOUT_AUDIT_API_KEY;
  const auditBuyerUserId = String(env.TRIMSCOUT_AUDIT_BUYER_USER_ID ?? "").trim();
  if (typeof headerKey !== "string" || headerKey === "") return null;
  if (fullKey && safeEqual(headerKey, fullKey)) return { kind: "full" };
  if (auditKey && auditBuyerUserId && auditKey !== fullKey && safeEqual(headerKey, auditKey)) {
    return { kind: "audit", buyerUserId: auditBuyerUserId };
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
// Route policy. `ownership` names a table whose buyer_user_id must be the audit buyer
// for the :id in capture group 1 (checked by the caller via the injected lookup).
// `params` constrains query-string values: { name: "BUYER" } must equal the audit buyer;
// anything not listed in `params` (or `allowParams`) is rejected so e.g. ?all=1 can't widen a list.
// ---------------------------------------------------------------------
export const AUDIT_ROUTES = [
  // test RFQs: create + read back
  { method: "POST", re: /^\/api\/rfqs$/, label: "POST /api/rfqs", forceBuyer: true },
  { method: "GET", re: /^\/api\/rfqs$/, label: "GET /api/rfqs", params: { buyerUserId: "BUYER" }, requiredParams: ["buyerUserId"] },
  { method: "GET", re: /^\/api\/rfqs\/(\d+)$/, label: "GET /api/rfqs/:id", ownership: "rfq_requests" },
  // bids / requests (buyer-side reads)
  { method: "GET", re: /^\/api\/deal-requests$/, label: "GET /api/deal-requests", params: { buyerUserId: "BUYER" }, allowParams: ["status"], requiredParams: ["buyerUserId"] },
  { method: "GET", re: /^\/api\/deal-requests\/(\d+)$/, label: "GET /api/deal-requests/:id", ownership: "deal_requests" },
  { method: "GET", re: /^\/api\/deal-requests\/(\d+)\/bids$/, label: "GET /api/deal-requests/:id/bids", ownership: "deal_requests" },
  { method: "GET", re: /^\/api\/deal-requests\/(\d+)\/bids\/\d+$/, label: "GET /api/deal-requests/:id/bids/:bidId", ownership: "deal_requests" },
  { method: "GET", re: /^\/api\/deal-requests\/(\d+)\/market$/, label: "GET /api/deal-requests/:id/market", ownership: "deal_requests" },
  // inventory search, so the auditor can pick a VIN for an RFQ (public listing data; no export/ops)
  { method: "GET", re: /^\/api\/inventory$/, label: "GET /api/inventory", anyParams: true },
  { method: "GET", re: /^\/api\/inventory\/vin\/[A-HJ-NPR-Z0-9]{17}$/i, label: "GET /api/inventory/vin/:vin" },
  { method: "GET", re: /^\/api\/inventory\/makes$/, label: "GET /api/inventory/makes" },
  { method: "GET", re: /^\/api\/inventory\/facets$/, label: "GET /api/inventory/facets", anyParams: true },
];

/** A stable, id-free label for logs, including for denied/unknown routes. */
export function routeLabel(method, pathname) {
  const hit = AUDIT_ROUTES.find((r) => r.method === method && r.re.test(pathname));
  if (hit) return hit.label;
  const generic = pathname
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/\/[A-HJ-NPR-Z0-9]{17}(?=\/|$)/gi, "/:vin")
    .replace(/(by-token\/)[^/]+/, "$1:token");
  return `${method} ${generic}`;
}

/**
 * Decide whether the audit principal may make this request.
 * Returns { allowed: true, route, ownership? } or { allowed: false, status: 403, error, route }.
 * Pure: the DB-backed ownership check happens in the caller using `ownership`.
 */
export function authorizeAudit(method, pathname, searchParams, buyerUserId) {
  const route = routeLabel(method, pathname);
  const deny = (error) => ({ allowed: false, status: 403, error, route });
  const entry = AUDIT_ROUTES.find((r) => r.method === method && r.re.test(pathname));
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
  return out;
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

/** One JSON line per call. Never includes the key or the query string (route template + status only). */
export function auditLogLine({ method, pathname, status, ms, now = new Date() }) {
  return JSON.stringify({
    audit_key: true,
    at: now.toISOString(),
    route: routeLabel(method, pathname),
    status,
    ms,
  });
}
