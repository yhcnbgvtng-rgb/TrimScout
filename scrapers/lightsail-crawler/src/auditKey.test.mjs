// Policy tests for the scoped audit keys (buyer + test-dealer). Run via `npm test` (tsx --test).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AUDIT_DEALER_ROUTES,
  AUDIT_ROUTES,
  auditLogLine,
  authenticate,
  authorizeAudit,
  authorizeAuditDealer,
  bidVerdict,
  checkOwnership,
  counterVerdict,
  createRateLimiter,
  dealVerdict,
  evaluateGuard,
  inviteCreationVerdict,
} from "./auditKey.js";

const BUYER = "9001";
const env = { TRIMSCOUT_API_KEY: "full-key", TRIMSCOUT_AUDIT_API_KEY: "audit-key", TRIMSCOUT_AUDIT_BUYER_USER_ID: BUYER, TRIMSCOUT_AUDIT_DEALER_KEY: "dealer-key" };
const q = (s = "") => new URLSearchParams(s);
const buyer = (method, path, query = "") => authorizeAudit(method, path, q(query), BUYER);
const dealer = (method, path, query = "") => authorizeAuditDealer(method, path, q(query));

// ---- a tiny world: 3 test dealers + one audit RFQ/request, and a REAL dealer + REAL RFQ/request ----
const TEST_DEALERS = [1, 2, 3].map((n) => ({ dealer_name: `AUDIT TEST Dealer ${n}`, contact_email: `audit-dealer-${n}@audit.trimscout.test` }));
const testInvite = { id: 20, rfq_id: 10, dealer_name: "AUDIT TEST Dealer 1", dealer_contact_email: "audit-dealer-1@audit.trimscout.test", deleted_at: null };
const realInvite = { id: 21, rfq_id: 11, dealer_name: "Route 22 Toyota", dealer_contact_email: "sales@route22toyota.com", deleted_at: null };
const auditRfq = { id: 10, buyer_user_id: BUYER, audit_forced_safe: 1, audit: 1, deleted_at: null };
const realRfq = { id: 11, buyer_user_id: "55", audit_forced_safe: 0, audit: 0, deleted_at: null };
const auditRequest = { id: 30, buyer_user_id: BUYER, audit: 1, deleted_at: null };
const realRequest = { id: 31, buyer_user_id: "55", audit: 0, deleted_at: null };
const auditBid = { id: 40, deal_request_id: 30, dealer_name: "AUDIT TEST Dealer 1", matched_vin: "WP0AB2A96NS123456", audit: 1, deleted_at: null };
const realBid = { id: 41, deal_request_id: 31, dealer_name: "Route 22 Toyota", matched_vin: "2T36CRAVXTC39J403", audit: 0, deleted_at: null };
const fakeDb = (rows) => ({
  testDealers: async () => TEST_DEALERS,
  rfq: async (id) => rows.rfqs.find((r) => r.id === id) || null,
  invite: async (id) => rows.invites.find((r) => r.id === id) || null,
  inviteByToken: async (t) => rows.invites.find((r) => r.view_token === t) || null,
  invitesForRfq: async (id) => rows.invites.filter((r) => r.rfq_id === id),
  dealRequest: async (id) => rows.requests.find((r) => r.id === id) || null,
});
const WORLD = fakeDb({
  rfqs: [auditRfq, realRfq],
  invites: [{ ...testInvite, view_token: "tok-test-0001" }, { ...realInvite, view_token: "tok-real-0001" }],
  requests: [auditRequest, realRequest],
});

describe("authenticate", () => {
  it("full / buyer-audit / dealer-audit keys resolve to their own principal; anything else is null", () => {
    assert.deepEqual(authenticate("full-key", env), { kind: "full" });
    assert.deepEqual(authenticate("audit-key", env), { kind: "audit", buyerUserId: BUYER });
    assert.deepEqual(authenticate("dealer-key", env), { kind: "audit_dealer" });
    for (const k of ["nope", "", undefined, null]) assert.equal(authenticate(k, env), null);
  });
  it("fails closed when half-configured or when keys collide", () => {
    assert.equal(authenticate("audit-key", { ...env, TRIMSCOUT_AUDIT_BUYER_USER_ID: "" }), null);
    assert.equal(authenticate("audit-key", { ...env, TRIMSCOUT_AUDIT_API_KEY: undefined }), null);
    assert.equal(authenticate("dealer-key", { ...env, TRIMSCOUT_AUDIT_DEALER_KEY: undefined }), null);
    // dealer key == full key -> it is the full key, never the weaker principal; dealer key == buyer key -> both rejected
    assert.equal(authenticate("same", { TRIMSCOUT_API_KEY: "same", TRIMSCOUT_AUDIT_DEALER_KEY: "same" }).kind, "full");
    assert.equal(authenticate("same", { ...env, TRIMSCOUT_AUDIT_API_KEY: "same", TRIMSCOUT_AUDIT_DEALER_KEY: "same" }), null);
  });
});

describe("buyer key: allowed routes", () => {
  const allowed = [
    ["POST", "/api/rfqs", ""],
    ["GET", "/api/rfqs", `buyerUserId=${BUYER}`],
    ["GET", "/api/rfqs/12", ""],
    ["POST", "/api/deal-requests", ""],
    ["GET", "/api/deal-requests", `buyerUserId=${BUYER}&status=active`],
    ["GET", "/api/deal-requests/5", ""],
    ["GET", "/api/deal-requests/5/bids", ""],
    ["GET", "/api/deal-requests/5/bids/77", ""],
    ["GET", "/api/deal-requests/5/market", ""],
    ["POST", "/api/rfqs/10/invites/20/buyer-counter", ""],
    ["POST", "/api/deals", ""],
    ["GET", "/api/inventory", "make=Porsche&state=NJ"],
    ["GET", "/api/inventory/vin/WP0AB2A96NS123456", ""],
    ["GET", "/api/inventory/makes", ""],
    ["GET", "/api/inventory/facets", "make=Porsche"],
  ];
  for (const [m, p, qs] of allowed) it(`${m} ${p}${qs ? "?" + qs : ""}`, () => assert.equal(buyer(m, p, qs).allowed, true));
  it("id routes ask for an ownership check; counter/deal carry their guards", () => {
    assert.deepEqual(buyer("GET", "/api/rfqs/12").ownership, { table: "rfq_requests", id: 12 });
    assert.deepEqual(buyer("GET", "/api/deal-requests/5/bids/77").ownership, { table: "deal_requests", id: 5 });
    assert.deepEqual(buyer("POST", "/api/rfqs/10/invites/20/buyer-counter").guard, { kind: "buyer_counter", rfqId: 10, inviteId: 20 });
    assert.equal(buyer("POST", "/api/deals").bodyGuard, "deal_create");
    assert.equal(buyer("POST", "/api/rfqs").forceBuyer, true);
    assert.equal(buyer("POST", "/api/deal-requests").forceBuyer, true);
  });
});

describe("buyer key: denied routes — every one is 403", () => {
  const denied = [
    // money: only creating the pending deal is allowed; nothing past it
    ["GET", "/api/deals/1"], ["POST", "/api/deals/1/mark-paid"], ["POST", "/api/deals/1/contract"], ["GET", "/api/deals/1/contract"],
    ["POST", "/api/deals/1/verification"], ["POST", "/api/deals/1/trade-in"], ["POST", "/api/deals/1/trade-in/appraisal"],
    // dealer routes
    ["POST", "/api/deal-requests/5/bids"], ["GET", "/api/dealer-bids"], ["GET", "/api/dealer-won-deals"], ["GET", "/api/dealer-responsiveness"],
    ["POST", "/api/rfqs/1/invites/2/quotes"], ["POST", "/api/rfqs/1/invites/2/decline"], ["GET", "/api/rfq-invites/by-token/abcdefgh12"],
    // buyer writes not granted
    ["POST", "/api/deal-requests/5/expire"], ["POST", "/api/deal-requests/5/negotiation"], ["POST", "/api/rfqs/1/pick"], ["POST", "/api/rfqs/1/walk"],
    ["PATCH", "/api/rfqs/1/lease-prefs"], ["PUT", "/api/deal-engagement"], ["GET", "/api/deal-engagement"],
    // admin / ops
    ["POST", "/api/rfqs/1/approval"], ["PATCH", "/api/rfqs/1"], ["POST", "/api/rfqs/1/invites"], ["POST", "/api/rfqs/1/invites/2/delivery"], ["DELETE", "/api/rfqs/1/invites/2"],
    ["POST", "/api/ops/sync-lock/acquire"], ["POST", "/api/ops/crawl-claims/claim"], ["GET", "/api/ops/crawl-claims/status"],
    ["POST", "/api/inventory/bulk"], ["POST", "/api/inventory/sweep"], ["POST", "/api/inventory/catalog-facets/rebuild"], ["GET", "/api/inventory/export"], ["GET", "/api/inventory/stats"],
    // wrong verbs on allowed paths, unknown paths
    ["PUT", "/api/rfqs/1"], ["DELETE", "/api/rfqs/1"], ["PUT", "/api/deals"], ["GET", "/api/deals"], ["POST", "/api/deal-requests/5/market"], ["GET", "/health"], ["GET", "/"], ["GET", "/api/rfqs/abc"], ["GET", "/api/nope"],
  ];
  for (const [m, p] of denied) {
    it(`${m} ${p}`, () => {
      const r = buyer(m, p, `buyerUserId=${BUYER}`);
      assert.equal(r.allowed, false);
      assert.equal(r.status, 403);
    });
  }
  it("list routes: another buyer, a missing buyerUserId or a widening param is 403", () => {
    for (const [p, qs] of [
      ["/api/rfqs", "buyerUserId=1"], ["/api/rfqs", ""], ["/api/rfqs", "all=1"], ["/api/rfqs", `buyerUserId=${BUYER}&all=1`], ["/api/rfqs", `buyerUserId=${BUYER}&approval=pending`],
      ["/api/deal-requests", ""], ["/api/deal-requests", "buyerUserId=1"], ["/api/deal-requests", `buyerUserId=${BUYER}&includeAudit=1`], ["/api/deal-requests", `buyerUserId=${BUYER}&dealerUserId=3`],
    ]) assert.equal(buyer("GET", p, qs).allowed, false, `${p}?${qs}`);
  });
});

describe("test-dealer key: allowed routes", () => {
  const allowed = [
    ["GET", "/api/rfq-invites/by-token/tok-test-0001"],
    ["GET", "/api/rfqs/10"],
    ["POST", "/api/rfqs/10/invites/20/quotes"],
    ["POST", "/api/rfqs/10/invites/20/decline"],
    ["GET", "/api/deal-requests/30"],
    ["POST", "/api/deal-requests/30/bids"],
  ];
  for (const [m, p] of allowed) it(`${m} ${p}`, () => assert.equal(dealer(m, p).allowed, true));
  it("carries the right guard for each route", () => {
    assert.deepEqual(dealer("GET", "/api/rfq-invites/by-token/tok-test-0001").guard, { kind: "dealer_token", token: "tok-test-0001" });
    assert.deepEqual(dealer("POST", "/api/rfqs/10/invites/20/quotes").guard, { kind: "dealer_invite", rfqId: 10, inviteId: 20 });
    assert.deepEqual(dealer("GET", "/api/rfqs/10").guard, { kind: "dealer_rfq", rfqId: 10 });
    assert.deepEqual(dealer("POST", "/api/deal-requests/30/bids").guard, { kind: "audit_request", dealRequestId: 30 });
    assert.equal(dealer("POST", "/api/deal-requests/30/bids").bodyGuard, "bid_submit");
  });
  it("accepts no query parameters at all", () => assert.equal(dealer("GET", "/api/rfqs/10", "all=1").allowed, false));
});

describe("test-dealer key: denied routes — every one is 403", () => {
  const denied = [
    // everything a buyer does
    ["POST", "/api/rfqs"], ["GET", "/api/rfqs"], ["POST", "/api/deal-requests"], ["GET", "/api/deal-requests"], ["POST", "/api/deals"], ["GET", "/api/deals/1"],
    ["POST", "/api/rfqs/10/invites/20/buyer-counter"], ["POST", "/api/rfqs/10/pick"], ["POST", "/api/rfqs/10/walk"], ["GET", "/api/deal-requests/30/bids"], ["GET", "/api/deal-requests/30/market"],
    // admin / ops / other dealers' data
    ["POST", "/api/rfqs/10/approval"], ["PATCH", "/api/rfqs/10"], ["POST", "/api/rfqs/10/invites"], ["DELETE", "/api/rfqs/10/invites/20"], ["POST", "/api/rfqs/10/invites/20/delivery"],
    ["GET", "/api/dealer-bids"], ["GET", "/api/dealer-won-deals"], ["GET", "/api/dealer-responsiveness"],
    ["POST", "/api/ops/sync-lock/acquire"], ["GET", "/api/ops/crawl-claims/status"], ["POST", "/api/inventory/bulk"], ["GET", "/api/inventory"], ["GET", "/api/inventory/export"],
    ["POST", "/api/deals/1/mark-paid"], ["POST", "/api/deals/1/contract"],
    // wrong verbs, unknown
    ["PUT", "/api/rfqs/10"], ["DELETE", "/api/rfq-invites/by-token/tok-test-0001"], ["POST", "/api/rfq-invites/by-token/tok-test-0001"], ["GET", "/health"], ["GET", "/api/nope"],
  ];
  for (const [m, p] of denied) it(`${m} ${p}`, () => {
    const r = dealer(m, p);
    assert.equal(r.allowed, false);
    assert.equal(r.status, 403);
  });
});

describe("ownership gate", () => {
  it("passes only when the row belongs to the audit buyer; missing rows are denied too", async () => {
    const own = { table: "rfq_requests", id: 1 };
    assert.equal(await checkOwnership(own, BUYER, async () => 9001), true);
    assert.equal(await checkOwnership(own, BUYER, async () => 42), false);
    assert.equal(await checkOwnership(own, BUYER, async () => null), false);
  });
});

describe("invites: audit RFQs only reach test dealers, test dealers only get audit RFQs (every key)", () => {
  const v = (rfq, dealerName, dealerEmail) => inviteCreationVerdict({ rfq, dealerName, dealerEmail, testDealers: TEST_DEALERS });
  it("audit RFQ + test dealer -> ok; real RFQ + real dealer -> ok", () => {
    assert.equal(v(auditRfq, testInvite.dealer_name, testInvite.dealer_contact_email), null);
    assert.equal(v(realRfq, realInvite.dealer_name, realInvite.dealer_contact_email), null);
  });
  it("audit RFQ + real dealer -> 403, however the dealer is spelled", () => {
    assert.equal(v(auditRfq, realInvite.dealer_name, realInvite.dealer_contact_email).status, 403);
    assert.equal(v(auditRfq, realInvite.dealer_name, null).status, 403);
    // test name but a real address (or the reverse) is not a test dealer
    assert.equal(v(auditRfq, "AUDIT TEST Dealer 1", "sales@route22toyota.com").status, 403);
    assert.equal(v(auditRfq, "Route 22 Toyota", "audit-dealer-1@audit.trimscout.test").status, 403);
    assert.equal(v(auditRfq, "AUDIT TEST Dealer 1", null).status, 403);
  });
  it("real RFQ + any test dealer (name or address) -> 403", () => {
    assert.equal(v(realRfq, testInvite.dealer_name, testInvite.dealer_contact_email).status, 403);
    assert.equal(v(realRfq, "AUDIT TEST Dealer 2", "someone@else.com").status, 403);
    assert.equal(v(realRfq, "Route 22 Toyota", "audit-dealer-3@audit.trimscout.test").status, 403);
  });
});

describe("guards: nothing real is reachable with either key", () => {
  const dealerPrincipal = { kind: "audit_dealer" };
  const buyerPrincipal = { kind: "audit", buyerUserId: BUYER };
  it("test dealer key: test invite ok; every real invite / RFQ / token / request is 403", async () => {
    assert.equal(await evaluateGuard({ kind: "dealer_invite", rfqId: 10, inviteId: 20 }, dealerPrincipal, WORLD), null);
    assert.equal(await evaluateGuard({ kind: "dealer_token", token: "tok-test-0001" }, dealerPrincipal, WORLD), null);
    assert.equal(await evaluateGuard({ kind: "dealer_rfq", rfqId: 10 }, dealerPrincipal, WORLD), null);
    assert.equal(await evaluateGuard({ kind: "audit_request", dealRequestId: 30 }, dealerPrincipal, WORLD), null);
    for (const g of [
      { kind: "dealer_invite", rfqId: 11, inviteId: 21 },
      { kind: "dealer_invite", rfqId: 10, inviteId: 21 }, // real invite smuggled under an audit RFQ id
      { kind: "dealer_invite", rfqId: 11, inviteId: 20 }, // test invite under a real RFQ id
      { kind: "dealer_invite", rfqId: 999, inviteId: 999 },
      { kind: "dealer_token", token: "tok-real-0001" },
      { kind: "dealer_token", token: "no-such-token" },
      { kind: "dealer_rfq", rfqId: 11 },
      { kind: "dealer_rfq", rfqId: 999 },
      { kind: "audit_request", dealRequestId: 31 },
      { kind: "audit_request", dealRequestId: 999 },
    ]) assert.equal((await evaluateGuard(g, dealerPrincipal, WORLD))?.status, 403, JSON.stringify(g));
  });
  it("an audit RFQ that somehow holds a real dealer's invite is closed to the dealer key", async () => {
    const db = fakeDb({ rfqs: [auditRfq], invites: [testInvite, { ...realInvite, rfq_id: 10 }], requests: [] });
    assert.equal((await evaluateGuard({ kind: "dealer_rfq", rfqId: 10 }, dealerPrincipal, db))?.status, 403);
    assert.equal((await evaluateGuard({ kind: "dealer_invite", rfqId: 10, inviteId: 21 }, dealerPrincipal, db))?.status, 403);
  });
  it("buyer counter: own audit RFQ + test dealer ok; real RFQ, someone else's RFQ or a real dealer is 403", async () => {
    assert.equal(await evaluateGuard({ kind: "buyer_counter", rfqId: 10, inviteId: 20 }, buyerPrincipal, WORLD), null);
    for (const g of [{ rfqId: 11, inviteId: 21 }, { rfqId: 10, inviteId: 21 }, { rfqId: 11, inviteId: 20 }, { rfqId: 999, inviteId: 20 }]) {
      assert.equal((await evaluateGuard({ kind: "buyer_counter", ...g }, buyerPrincipal, WORLD))?.status, 403, JSON.stringify(g));
    }
    // an audit RFQ owned by a DIFFERENT buyer id is not this key's
    const other = fakeDb({ rfqs: [{ ...auditRfq, buyer_user_id: "1" }], invites: [testInvite], requests: [] });
    assert.equal((await evaluateGuard({ kind: "buyer_counter", rfqId: 10, inviteId: 20 }, buyerPrincipal, other))?.status, 403);
  });
  it("soft-deleted RFQs, invites and requests are gone", async () => {
    const gone = { ...auditRfq, deleted_at: new Date() };
    const db = fakeDb({ rfqs: [gone], invites: [{ ...testInvite, deleted_at: new Date() }], requests: [{ ...auditRequest, deleted_at: new Date() }] });
    assert.equal((await evaluateGuard({ kind: "dealer_invite", rfqId: 10, inviteId: 20 }, dealerPrincipal, db))?.status, 403);
    assert.equal((await evaluateGuard({ kind: "audit_request", dealRequestId: 30 }, dealerPrincipal, db))?.status, 403);
  });
  it("counterVerdict is false for a real dealer even on the buyer's own audit RFQ", () => {
    assert.equal(counterVerdict({ buyerUserId: BUYER, rfq: auditRfq, invite: { ...realInvite, rfq_id: 10 }, testDealers: TEST_DEALERS }).status, 403);
  });
});

describe("bids and deals", () => {
  const bid = (dealRequest, dealerName, principal) => bidVerdict({ dealRequest, dealerName, testDealers: TEST_DEALERS, principal });
  it("audit request takes only test-dealer bids; test dealers bid only on audit requests (every key)", () => {
    assert.equal(bid(auditRequest, "AUDIT TEST Dealer 2", "audit_dealer"), null);
    assert.equal(bid(auditRequest, "AUDIT TEST Dealer 2", "full"), null);
    assert.equal(bid(realRequest, "Route 22 Toyota", "full"), null);
    assert.equal(bid(auditRequest, "Route 22 Toyota", "full").status, 403);
    assert.equal(bid(auditRequest, "Route 22 Toyota", "audit_dealer").status, 403);
    assert.equal(bid(realRequest, "AUDIT TEST Dealer 1", "full").status, 403);
    assert.equal(bid(realRequest, "Route 22 Toyota", "audit_dealer").status, 403);
    assert.equal(bid(realRequest, "AUDIT TEST Dealer 1", "audit_dealer").status, 403);
    assert.equal(bid(null, "AUDIT TEST Dealer 1", "audit_dealer").status, 403);
  });
  const deal = (over) => dealVerdict({ buyerUserId: BUYER, dealRequest: auditRequest, bid: auditBid, body: { dealRequestId: 30, bidId: 40, dealerName: "AUDIT TEST Dealer 1", matchedVin: "WP0AB2A96NS123456" }, testDealers: TEST_DEALERS, ...over });
  it("buyer key: own audit request + that request's test-dealer bid -> ok", () => assert.equal(deal({}), null));
  it("buyer key: anything real, mismatched or unlinked -> 403", () => {
    const body = { dealRequestId: 31, bidId: 41, dealerName: "Route 22 Toyota", matchedVin: "2T36CRAVXTC39J403" };
    assert.equal(deal({ dealRequest: realRequest, bid: realBid, body }).status, 403); // real request + real dealer
    assert.equal(deal({ dealRequest: realRequest, bid: auditBid }).status, 403); // real request
    assert.equal(deal({ bid: realBid, body }).status, 403); // audit request + real dealer's bid
    assert.equal(deal({ dealRequest: { ...auditRequest, buyer_user_id: "1" } }).status, 403); // someone else's
    assert.equal(deal({ bid: { ...auditBid, deal_request_id: 99 } }).status, 403); // bid from another request
    assert.equal(deal({ bid: { ...auditBid, audit: 0 } }).status, 403);
    assert.equal(deal({ bid: { ...auditBid, dealer_name: "Route 22 Toyota" } }).status, 403);
    assert.equal(deal({ body: { dealRequestId: 30, bidId: 40, dealerName: "AUDIT TEST Dealer 2", matchedVin: "WP0AB2A96NS123456" } }).status, 403); // names a different dealer
    assert.equal(deal({ body: { dealRequestId: 30, bidId: 40, dealerName: "AUDIT TEST Dealer 1", matchedVin: "2T36CRAVXTC39J403" } }).status, 403);
    assert.equal(deal({ body: { dealerName: "AUDIT TEST Dealer 1" } }).status, 403); // no ids at all
    assert.equal(deal({ dealRequest: null, bid: null, body: { dealRequestId: 30, bidId: 40 } }).status, 403);
    assert.equal(deal({ dealRequest: { ...auditRequest, deleted_at: new Date() } }).status, 403);
  });
  it("any other key can't pair a real bid with an audit request or a test bid with a real request", () => {
    const any = (over) => dealVerdict({ buyerUserId: null, testDealers: TEST_DEALERS, ...over });
    assert.equal(any({ dealRequest: auditRequest, bid: realBid, body: { dealerName: "Route 22 Toyota", matchedVin: "x" } }).status, 403);
    assert.equal(any({ dealRequest: realRequest, bid: { ...auditBid, deal_request_id: 31, audit: 0 }, body: { dealerName: "AUDIT TEST Dealer 1", matchedVin: auditBid.matched_vin } }).status, 403);
    assert.equal(any({ dealRequest: realRequest, bid: realBid, body: { dealerName: "Route 22 Toyota" } }), null); // legacy real deal untouched
    assert.equal(any({ dealRequest: null, bid: null, body: {} }), null); // legacy deal with no auction link untouched
  });
});

describe("every route the server defines: no real dealer or real RFQ is reachable on any verb", () => {
  const src = fs.readFileSync(fileURLToPath(new URL("./deals_api_server.js", import.meta.url)), "utf8");
  const sample = (re, id) =>
    re
      .replace(/^\^/, "").replace(/\$$/, "")
      .replace(/\(\\d\+\)/g, String(id))
      .replace(/\(\[A-HJ-NPR-Z0-9\]\{17\}\)/g, "WP0AB2A96NS123456")
      .replace(/\(\[A-Za-z0-9_-\]\{8,80\}\)/g, "tok-real-0001")
      .replace(/\\\//g, "/");
  const pathsFor = (id) => {
    const paths = new Set();
    for (const m of src.matchAll(/pathname === "([^"]+)"/g)) paths.add(m[1]);
    for (const m of src.matchAll(/pathname\.match\(\/(.+?)\/i?\)/g)) paths.add(sample(m[1], id));
    return paths;
  };
  const VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  const labels = (tbl) => tbl.map((r) => r.label);
  it("found a plausible number of server routes", () => assert.ok(pathsFor(1).size > 40));

  // Stand-ins for the SQL the server runs: rows are visible to the audit buyer's ownership check only if audit = 1 and not deleted.
  const ownerLookup = (rows) => async (table, id) => {
    const r = rows[table].find((x) => x.id === id);
    return r && Number(r.audit) === 1 && !r.deleted_at ? r.buyer_user_id : null;
  };
  const rows = { rfq_requests: [auditRfq, realRfq], deal_requests: [auditRequest, realRequest] };

  it("buyer key, pointed at the REAL RFQ / request / invite / bid (ids 11, 21, 31, 41): every verb on every route is denied or guarded to a no-op", async () => {
    for (const p of pathsFor(11)) {
      for (const method of VERBS) {
        const v = buyer(method, p, `buyerUserId=${BUYER}`);
        if (!v.allowed) continue;
        // allowed by the table -> must still be stopped by ownership / guard, or be a create that can only mint audit rows
        if (v.ownership) assert.equal(await checkOwnership(v.ownership, BUYER, ownerLookup(rows)), false, `${method} ${p} reached a real row`);
        if (v.guard) assert.equal((await evaluateGuard(v.guard, { kind: "audit", buyerUserId: BUYER }, WORLD))?.status, 403, `${method} ${p} guard let a real row through`);
        const inert = v.ownership || v.guard || v.forceBuyer || v.bodyGuard || /^\/api\/inventory/.test(p) || (method === "GET" && /^\/api\/(rfqs|deal-requests)$/.test(p));
        assert.ok(inert, `${method} ${p} is allowed with no scoping at all`);
      }
    }
  });
  it("buyer key, pointed at the REAL invite (21) under every id slot", async () => {
    for (const p of pathsFor(21)) for (const method of VERBS) {
      const v = buyer(method, p, `buyerUserId=${BUYER}`);
      if (v.allowed && v.guard) assert.equal((await evaluateGuard(v.guard, { kind: "audit", buyerUserId: BUYER }, WORLD))?.status, 403, `${method} ${p}`);
      if (v.allowed && v.ownership) assert.equal(await checkOwnership(v.ownership, BUYER, ownerLookup(rows)), false, `${method} ${p}`);
    }
  });
  it("test-dealer key, pointed at the REAL RFQ / invite / request / token: denied or guarded on every verb", async () => {
    for (const id of [11, 21, 31, 41]) {
      for (const p of pathsFor(id)) for (const method of VERBS) {
        const v = dealer(method, p);
        if (!v.allowed) continue;
        assert.ok(v.guard, `${method} ${p} is allowed with no guard`);
        // the guard must reject real objects; the audit objects live at ids 10/20/30/40, so id 21/31/11 are real, 41 is nothing
        assert.equal((await evaluateGuard(v.guard, { kind: "audit_dealer" }, WORLD))?.status, 403, `${method} ${p} reached a real row`);
      }
    }
  });
  it("test-dealer key: a REAL dealer's name on an otherwise audit-shaped bid/invite is rejected", () => {
    assert.equal(bidVerdict({ dealRequest: auditRequest, dealerName: realInvite.dealer_name, testDealers: TEST_DEALERS, principal: "audit_dealer" }).status, 403);
    assert.equal(inviteCreationVerdict({ rfq: auditRfq, dealerName: realInvite.dealer_name, dealerEmail: realInvite.dealer_contact_email, testDealers: TEST_DEALERS }).status, 403);
  });
  it("each key reaches only its own table: unlisted routes are denied on every verb", () => {
    const buyerOk = new Set(labels(AUDIT_ROUTES));
    const dealerOk = new Set(labels(AUDIT_DEALER_ROUTES));
    for (const p of pathsFor(7)) for (const method of VERBS) {
      const b = buyer(method, p, `buyerUserId=${BUYER}`);
      const d = dealer(method, p);
      if (b.allowed) assert.ok(buyerOk.has(b.route), `buyer ${method} ${p}`);
      if (d.allowed) assert.ok(dealerOk.has(d.route), `dealer ${method} ${p}`);
    }
  });
  it("nothing under /api/ops, admin-only, or the other key's private routes is reachable", () => {
    for (const p of pathsFor(7)) {
      if (/^\/api\/(ops|dealer-)/.test(p)) for (const method of VERBS) {
        assert.equal(buyer(method, p).allowed, false, `buyer ${method} ${p}`);
        assert.equal(dealer(method, p).allowed, false, `dealer ${method} ${p}`);
      }
      if (/\/(approval|mark-paid|contract|verification|trade-in|pick|walk|expire|negotiation|delivery|lease-prefs)(\/|$)/.test(p) || /^\/api\/inventory\/(bulk|sweep|export|stats)/.test(p)) {
        for (const method of VERBS) {
          assert.equal(buyer(method, p).allowed, false, `buyer ${method} ${p}`);
          assert.equal(dealer(method, p).allowed, false, `dealer ${method} ${p}`);
        }
      }
    }
  });
  it("the server wires every gate: audit flags on creates, audit/deleted filters on reads, per-key rate limit", () => {
    for (const re of [
      /authorizeAudit\(req\.method, pathname/, /authorizeAuditDealer\(req\.method, pathname/, /evaluateGuard\(verdict\.guard/,
      /inviteCreationVerdict\(/, /bidVerdict\(\{/, /dealVerdict\(\{/,
      /auditRateLimiters\[principal\.kind\]\.take\(\)/,
      /WHERE id = \? AND audit = 1 AND deleted_at IS NULL/, // ownership lookup: audit rows only
      /AND deleted_at IS NULL\$\{isAuditBuyer\(req\) \? " AND audit = 1" : ""\}/, // buyer's RFQ list
      /isAuditBuyer\(req\) \? "audit = 1"/, // deal-request list
      /INSERT INTO rfq_requests[\s\S]*audit_forced_safe, audit, audit_at/,
      /INSERT INTO deal_requests[\s\S]*expires_at, audit, audit_at/,
      /INSERT INTO deals \([^)]*audit, audit_at\)/,
      /"sales_rep_phone", "audit", "audit_at"/,
      /INSERT INTO rfq_invites \([^)]*audit, audit_at\)/,
      /INSERT INTO rfq_quotes \([^)]*audit, audit_at\)/,
      /INSERT INTO rfq_events \(rfq_id, event_type, payload_json, audit, audit_at\)/,
    ]) assert.match(src, re);
  });
  it("real-facing reads exclude audit rows: dealer-matching list, dealer dashboards, won deals, responsiveness, market", () => {
    for (const re of [
      /"audit = 0"\]/, // handleListDealRequests default
      /status != 'withdrawn' AND audit = 0 AND deleted_at IS NULL ORDER BY created_at DESC/, // dealer-bids (own rows)
      /status != 'withdrawn' AND audit = 0 AND deleted_at IS NULL`/, // dealer-bids (rank peers)
      /db\.status = 'accepted' AND db\.audit = 0 AND db\.deleted_at IS NULL/, // dealer-won-deals
      /db\.status != 'withdrawn' AND db\.audit = 0 AND db\.deleted_at IS NULL/, // dealer-responsiveness
      /AND audit = \(SELECT audit FROM deal_requests WHERE id = \?\)/, // market
    ]) assert.match(src, re);
  });
  it("test dealerships never appear in the real dealer directory", () => {
    const auth = fs.readFileSync(fileURLToPath(new URL("./auth_api_server.js", import.meta.url)), "utf8");
    assert.match(auth, /SELECT \* FROM dealership_contacts WHERE is_test = 0 ORDER BY dealer_name ASC/);
    assert.match(auth, /ADD COLUMN IF NOT EXISTS is_test TINYINT\(1\) NOT NULL DEFAULT 0/);
  });
});

describe("rate limit: 60 requests per minute", () => {
  it("allows 60, rejects the 61st with a Retry-After, and recovers when the window slides", () => {
    let t = 1_000_000;
    const rl = createRateLimiter({ now: () => t });
    for (let i = 0; i < 60; i++) assert.equal(rl.take().ok, true, `request ${i + 1}`);
    const blocked = rl.take();
    assert.equal(blocked.ok, false);
    assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 60);
    t += 61_000;
    assert.equal(rl.take().ok, true);
  });
  it("rejected attempts do not extend the window; each limiter is independent", () => {
    let t = 0;
    const rl = createRateLimiter({ now: () => t });
    const other = createRateLimiter({ now: () => t });
    for (let i = 0; i < 60; i++) rl.take();
    t = 30_000;
    for (let i = 0; i < 100; i++) rl.take();
    assert.equal(other.take().ok, true);
    t = 60_001;
    assert.equal(rl.take().ok, true);
  });
});

describe("call log", () => {
  it("logs key kind, route template and status — never the key, ids, tokens or query string", () => {
    const line = JSON.parse(auditLogLine({ method: "GET", pathname: "/api/rfqs/12", status: 200, ms: 4, now: new Date("2026-10-08T00:00:00Z") }));
    assert.deepEqual(line, { audit_key: true, key: "audit", at: "2026-10-08T00:00:00.000Z", route: "GET /api/rfqs/:id", status: 200, ms: 4 });
    const d = JSON.parse(auditLogLine({ method: "POST", pathname: "/api/rfqs/10/invites/20/quotes", status: 201, ms: 9, kind: "audit_dealer" }));
    assert.equal(d.key, "audit_dealer");
    assert.equal(d.route, "POST /api/rfqs/:id/invites/:inviteId/quotes");
    assert.equal(JSON.parse(auditLogLine({ method: "POST", pathname: "/api/deals/5/mark-paid", status: 403, ms: 1 })).route, "POST /api/deals/:id/mark-paid");
    assert.equal(JSON.parse(auditLogLine({ method: "GET", pathname: "/api/rfq-invites/by-token/secrettoken123", status: 200, ms: 0 })).route, "GET /api/rfq-invites/by-token/:token");
  });
});
