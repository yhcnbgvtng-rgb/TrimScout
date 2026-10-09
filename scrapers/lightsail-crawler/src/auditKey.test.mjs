// Policy tests for the scoped audit key. Run via `npm test` (tsx --test).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { AUDIT_ROUTES, auditLogLine, authenticate, authorizeAudit, checkOwnership, createRateLimiter } from "./auditKey.js";

const BUYER = "9001";
const env = { TRIMSCOUT_API_KEY: "full-key", TRIMSCOUT_AUDIT_API_KEY: "audit-key", TRIMSCOUT_AUDIT_BUYER_USER_ID: BUYER };
const q = (s = "") => new URLSearchParams(s);
const check = (method, path, query = "") => authorizeAudit(method, path, q(query), BUYER);

describe("authenticate", () => {
  it("full key -> full, audit key -> audit tied to the buyer, anything else -> null", () => {
    assert.deepEqual(authenticate("full-key", env), { kind: "full" });
    assert.deepEqual(authenticate("audit-key", env), { kind: "audit", buyerUserId: BUYER });
    assert.equal(authenticate("nope", env), null);
    assert.equal(authenticate("", env), null);
    assert.equal(authenticate(undefined, env), null);
  });
  it("fails closed when half-configured or when the audit key equals the full key", () => {
    assert.equal(authenticate("audit-key", { ...env, TRIMSCOUT_AUDIT_BUYER_USER_ID: "" }), null);
    assert.equal(authenticate("audit-key", { ...env, TRIMSCOUT_AUDIT_API_KEY: undefined }), null);
    assert.equal(authenticate("same", { TRIMSCOUT_API_KEY: "same", TRIMSCOUT_AUDIT_API_KEY: "same", TRIMSCOUT_AUDIT_BUYER_USER_ID: BUYER }).kind, "full");
    assert.equal(authenticate("anything", { TRIMSCOUT_AUDIT_API_KEY: "anything", TRIMSCOUT_AUDIT_BUYER_USER_ID: BUYER }).kind, "audit");
  });
});

describe("allowed routes", () => {
  const allowed = [
    ["POST", "/api/rfqs", ""],
    ["GET", "/api/rfqs", `buyerUserId=${BUYER}`],
    ["GET", "/api/rfqs/12", ""],
    ["GET", "/api/deal-requests", `buyerUserId=${BUYER}&status=active`],
    ["GET", "/api/deal-requests/5", ""],
    ["GET", "/api/deal-requests/5/bids", ""],
    ["GET", "/api/deal-requests/5/bids/77", ""],
    ["GET", "/api/deal-requests/5/market", ""],
    ["GET", "/api/inventory", "make=Porsche&state=NJ"],
    ["GET", "/api/inventory/vin/WP0AB2A96NS123456", ""],
    ["GET", "/api/inventory/makes", ""],
    ["GET", "/api/inventory/facets", "make=Porsche"],
  ];
  for (const [m, p, qs] of allowed) {
    it(`${m} ${p}${qs ? "?" + qs : ""}`, () => assert.equal(check(m, p, qs).allowed, true));
  }
  it("id-scoped reads ask for an ownership check on the right table", () => {
    assert.deepEqual(check("GET", "/api/rfqs/12").ownership, { table: "rfq_requests", id: 12 });
    assert.deepEqual(check("GET", "/api/deal-requests/5/bids/77").ownership, { table: "deal_requests", id: 5 });
    assert.equal(check("GET", "/api/deal-requests", `buyerUserId=${BUYER}`).ownership, undefined);
  });
  it("POST /api/rfqs forces the buyer", () => assert.equal(check("POST", "/api/rfqs").forceBuyer, true));
});

describe("buyer scoping on list routes", () => {
  it("another buyer's id, a missing buyerUserId, or a widening param is 403", () => {
    for (const [p, qs] of [
      ["/api/rfqs", "buyerUserId=1"],
      ["/api/rfqs", ""],
      ["/api/rfqs", "all=1"],
      ["/api/rfqs", `buyerUserId=${BUYER}&all=1`],
      ["/api/rfqs", `buyerUserId=${BUYER}&approval=pending`],
      ["/api/deal-requests", ""],
      ["/api/deal-requests", "buyerUserId=1"],
      ["/api/deal-requests", `buyerUserId=${BUYER}&dealerUserId=3`],
    ]) {
      const r = check("GET", p, qs);
      assert.equal(r.allowed, false, `${p}?${qs}`);
      assert.equal(r.status, 403);
    }
  });
});

describe("ownership gate", () => {
  it("passes only when the row belongs to the audit buyer; missing rows are denied too", async () => {
    const own = { table: "rfq_requests", id: 1 };
    assert.equal(await checkOwnership(own, BUYER, async () => 9001), true);
    assert.equal(await checkOwnership(own, BUYER, async () => "9001"), true);
    assert.equal(await checkOwnership(own, BUYER, async () => 42), false);
    assert.equal(await checkOwnership(own, BUYER, async () => null), false);
  });
});

describe("denied routes — every one is 403", () => {
  const denied = [
    // money / deals
    ["POST", "/api/deals"], ["GET", "/api/deals/1"], ["POST", "/api/deals/1/mark-paid"], ["POST", "/api/deals/1/contract"],
    ["GET", "/api/deals/1/contract"], ["POST", "/api/deals/1/verification"], ["POST", "/api/deals/1/trade-in"], ["POST", "/api/deals/1/trade-in/appraisal"],
    // dealer routes
    ["POST", "/api/deal-requests/5/bids"], ["GET", "/api/dealer-bids"], ["GET", "/api/dealer-won-deals"], ["GET", "/api/dealer-responsiveness"],
    ["POST", "/api/rfqs/1/invites/2/quotes"], ["POST", "/api/rfqs/1/invites/2/decline"], ["GET", "/api/rfq-invites/by-token/abcdefgh12"],
    // buyer writes the key must not make
    ["POST", "/api/deal-requests"], ["POST", "/api/deal-requests/5/expire"], ["POST", "/api/deal-requests/5/negotiation"],
    ["POST", "/api/rfqs/1/invites/2/buyer-counter"], ["POST", "/api/rfqs/1/pick"], ["POST", "/api/rfqs/1/walk"], ["PATCH", "/api/rfqs/1/lease-prefs"],
    ["PUT", "/api/deal-engagement"], ["GET", "/api/deal-engagement"],
    // admin / ops
    ["POST", "/api/rfqs/1/approval"], ["PATCH", "/api/rfqs/1"], ["POST", "/api/rfqs/1/invites"], ["POST", "/api/rfqs/1/invites/2/delivery"], ["DELETE", "/api/rfqs/1/invites/2"],
    ["POST", "/api/ops/sync-lock/acquire"], ["POST", "/api/ops/crawl-claims/claim"], ["GET", "/api/ops/crawl-claims/status"],
    ["POST", "/api/inventory/bulk"], ["POST", "/api/inventory/sweep"], ["POST", "/api/inventory/catalog-facets/rebuild"], ["GET", "/api/inventory/export"], ["GET", "/api/inventory/stats"],
    // wrong verbs on allowed paths, and unknown paths
    ["PUT", "/api/rfqs/1"], ["DELETE", "/api/rfqs/1"], ["POST", "/api/deal-requests/5/market"], ["GET", "/health"], ["GET", "/"], ["GET", "/api/rfqs/abc"], ["GET", "/api/nope"],
  ];
  for (const [m, p] of denied) {
    it(`${m} ${p}`, () => {
      const r = check(m, p, `buyerUserId=${BUYER}`);
      assert.equal(r.allowed, false);
      assert.equal(r.status, 403);
    });
  }
});

describe("every route the server defines is covered", () => {
  // Pull each route out of deals_api_server.js, synthesize a concrete path, and assert the audit
  // key is denied everywhere except the explicit AUDIT_ROUTES. Catches a route that is added to
  // the server and accidentally matches an allow pattern.
  const src = fs.readFileSync(fileURLToPath(new URL("./deals_api_server.js", import.meta.url)), "utf8");
  const sample = (re) =>
    re
      .replace(/^\^/, "").replace(/\$$/, "")
      .replace(/\(\\d\+\)/g, "7")
      .replace(/\(\[A-HJ-NPR-Z0-9\]\{17\}\)/g, "WP0AB2A96NS123456")
      .replace(/\(\[A-Za-z0-9_-\]\{8,80\}\)/g, "abcdefgh12")
      .replace(/\\\//g, "/");
  const paths = new Set();
  for (const m of src.matchAll(/pathname === "([^"]+)"/g)) paths.add(m[1]);
  for (const m of src.matchAll(/pathname\.match\(\/(.+?)\/i?\)/g)) paths.add(sample(m[1]));
  it("found a plausible number of server routes", () => assert.ok(paths.size > 40, `only ${paths.size}`));
  it("only the allowlisted shapes are reachable, on any verb", () => {
    const reachable = [];
    for (const p of paths) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        if (authorizeAudit(method, p, q(`buyerUserId=${BUYER}`), BUYER).allowed) reachable.push(`${method} ${p}`);
      }
    }
    const expected = AUDIT_ROUTES.map((r) => r.label);
    for (const r of reachable) {
      const label = authorizeAudit(r.split(" ")[0], r.split(" ")[1], q(`buyerUserId=${BUYER}`), BUYER).route;
      assert.ok(expected.includes(label), `${r} is reachable but not in AUDIT_ROUTES`);
    }
  });
  it("nothing under /api/ops or the dealer-scoped paths is reachable", () => {
    for (const p of paths) {
      if (!/^\/api\/(ops|dealer-|rfq-invites)/.test(p)) continue;
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) assert.equal(authorizeAudit(method, p, q(), BUYER).allowed, false, `${method} ${p}`);
    }
  });
  it("the server wires the gate and the forced-safe column", () => {
    assert.match(src, /authorizeAudit\(req\.method, pathname/);
    assert.match(src, /audit_forced_safe/);
    assert.match(src, /auditRateLimiter\.take\(\)/);
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
  it("rejected attempts do not extend the window", () => {
    let t = 0;
    const rl = createRateLimiter({ now: () => t });
    for (let i = 0; i < 60; i++) rl.take();
    t = 30_000;
    for (let i = 0; i < 100; i++) rl.take();
    t = 60_001;
    assert.equal(rl.take().ok, true);
  });
});

describe("call log", () => {
  it("logs route template + status, never the key, ids, or query string", () => {
    const line = JSON.parse(auditLogLine({ method: "GET", pathname: "/api/rfqs/12", status: 200, ms: 4, now: new Date("2026-10-08T00:00:00Z") }));
    assert.deepEqual(line, { audit_key: true, at: "2026-10-08T00:00:00.000Z", route: "GET /api/rfqs/:id", status: 200, ms: 4 });
    const denied = JSON.parse(auditLogLine({ method: "POST", pathname: "/api/deals/5/mark-paid", status: 403, ms: 1 }));
    assert.equal(denied.route, "POST /api/deals/:id/mark-paid");
    assert.equal(denied.status, 403);
    assert.equal(JSON.parse(auditLogLine({ method: "GET", pathname: "/api/rfq-invites/by-token/secrettoken123", status: 403, ms: 0 })).route, "GET /api/rfq-invites/by-token/:token");
  });
});
