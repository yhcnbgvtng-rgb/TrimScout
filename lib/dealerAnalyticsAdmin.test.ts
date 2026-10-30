import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { InventoryApiError } from "./inventoryApi";
import { dealerAnalyticsDealer, dealerAnalyticsDealers, dealerAnalyticsMarket, dealerAnalyticsQuery } from "./dealerAnalyticsApi";
import { getDealerMarket, getDealerView, getDealersTable, parseDealerIdParam, type AdminRouteDeps } from "./dealerAnalyticsAdminRoute";

function deps(over: Partial<AdminRouteDeps> & { admin?: boolean } = {}) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const d: AdminRouteDeps = {
    requireAdmin: async () => (over.admin === false ? null : { user: { role: "admin" } }),
    dealers: (async (...args: unknown[]) => { calls.push({ fn: "dealers", args }); return { dealers: [] }; }) as unknown as AdminRouteDeps["dealers"],
    dealer: (async (...args: unknown[]) => { calls.push({ fn: "dealer", args }); return { ok: true }; }) as unknown as AdminRouteDeps["dealer"],
    market: (async (...args: unknown[]) => { calls.push({ fn: "market", args }); return { rows: [] }; }) as unknown as AdminRouteDeps["market"],
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== "admin")),
  };
  return { d, calls };
}
const req = (qs = "") => new Request(`https://x.test/api/admin/dealer-analytics${qs ? `?${qs}` : ""}`);

describe("admin gate", () => {
  it("403s every endpoint for a non-admin and never reaches the box", async () => {
    const { d, calls } = deps({ admin: false });
    for (const r of [await getDealersTable(req(), d), await getDealerView(req(), "2187", d), await getDealerMarket(req(), "2187", d)]) {
      assert.equal(r.status, 403);
      assert.deepEqual(await r.json(), { error: "Admin access required." });
    }
    assert.equal(calls.length, 0);
  });

  it("passes an admin through with a short private cache header", async () => {
    const { d } = deps();
    const r = await getDealersTable(req(), d);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("Cache-Control"), "private, max-age=60");
  });

  it("the route files are thin wrappers and the default gate is requireAdminSession", () => {
    const handler = fs.readFileSync("lib/dealerAnalyticsAdminRoute.ts", "utf8");
    assert.match(handler, /requireAdminSession\(\)/);
    assert.match(handler, /Admin access required\./);
    assert.match(fs.readFileSync("app/api/admin/dealer-analytics/route.ts", "utf8"), /getDealersTable\(req\)/);
    assert.match(fs.readFileSync("app/api/admin/dealer-analytics/[id]/route.ts", "utf8"), /getDealerView\(req, \(await params\)\.id\)/);
    assert.match(fs.readFileSync("app/api/admin/dealer-analytics/[id]/market/route.ts", "utf8"), /getDealerMarket\(req, \(await params\)\.id\)/);
  });
});

describe("input checks (400, nothing forwarded)", () => {
  it("rejects bad ids, flags, days, paging and directions", async () => {
    const { d, calls } = deps();
    for (const id of ["abc", "0", "-1", "1.5", "007x", "12345678901"]) {
      assert.equal((await getDealerView(req(), id, d)).status, 400, id);
      assert.equal((await getDealerMarket(req(), id, d)).status, 400, id);
    }
    assert.equal((await getDealersTable(req("includeBuckets=maybe"), d)).status, 400);
    assert.equal((await getDealersTable(req("day=2026-13-40"), d)).status, 400);
    for (const qs of ["limit=0", "limit=201", "limit=x", "offset=-1", "offset=10001", "direction=sideways", "day=nope"]) assert.equal((await getDealerView(req(qs), "2187", d)).status, 400, qs);
    assert.equal(calls.length, 0);
    assert.equal(parseDealerIdParam("2187"), 2187);
  });

  it("forwards valid filters as typed values", async () => {
    const { d, calls } = deps();
    await getDealersTable(req("includeBuckets=1&day=2026-10-31"), d);
    await getDealersTable(req(), d);
    await getDealerView(req("limit=25&offset=50&direction=drop&day=2026-10-31"), "2187", d);
    await getDealerMarket(req("day=2026-10-31"), "2187", d);
    assert.deepEqual(calls[0].args, [{ includeBuckets: true, day: "2026-10-31" }]);
    assert.deepEqual(calls[1].args, [{ includeBuckets: false, day: undefined }], "buckets are hidden unless asked for");
    assert.deepEqual(calls[2].args, [2187, { limit: 25, offset: 50, direction: "drop", day: "2026-10-31" }]);
    assert.deepEqual(calls[3].args, [2187, { day: "2026-10-31" }]);
  });
});

describe("box errors map to clear statuses", () => {
  const failing = (err: unknown) => deps({ dealers: (async () => { throw err; }) as unknown as AdminRouteDeps["dealers"] }).d;
  it("503 not-built-yet and timeouts stay 503 with the box's message; 404 and 400 pass through; the rest is 502", async () => {
    const notBuilt = await getDealersTable(req(), failing(new InventoryApiError("Dealer analytics has not been built yet — the nightly job has not finished a run.", 503)));
    assert.equal(notBuilt.status, 503);
    assert.match((await notBuilt.json()).error, /not been built yet/);
    assert.equal((await getDealersTable(req(), failing(new InventoryApiError("No such dealer.", 404)))).status, 404);
    assert.equal((await getDealersTable(req(), failing(new InventoryApiError("bad", 400)))).status, 400);
    assert.equal((await getDealersTable(req(), failing(new InventoryApiError("boom", 500)))).status, 502);
    const generic = await getDealersTable(req(), failing(new Error("secret internals")));
    assert.equal(generic.status, 502);
    assert.equal((await generic.json()).error, "Could not load dealer analytics.");
  });
});

describe("typed client", () => {
  const box = (response: unknown) => {
    const seen: string[] = [];
    return { seen, deps: { request: async (_m: "GET" | "POST", path: string) => { seen.push(path); return response; } } };
  };

  it("builds query strings and completes brands the way the Crawl page does (crawl tags first, then the dealer name)", async () => {
    const row = (dealerId: number, dealerName: string, brandTags: string[]) => ({ dealerId, dealerName, brandTags, activeUnits: 1 });
    const { seen, deps: cd } = box({ day: "2026-10-31", dealers: [row(1, "Paul Miller Chevrolet Buick GMC", []), row(2, "Route 23 Auto Mall", []), row(3, "Anything", ["Jeep"])] });
    const t = await dealerAnalyticsDealers({ includeBuckets: true, day: "2026-10-31" }, cd);
    assert.equal(seen[0], "/api/inventory/dealer-analytics/dealers?includeBuckets=1&day=2026-10-31");
    assert.deepEqual(t.dealers.map((r) => r.brands), [["Chevrolet", "Buick", "GMC"], [], ["Jeep"]]);
    assert.ok(!("brandTags" in t.dealers[0]));
    const none = box({ dealers: [] });
    await dealerAnalyticsDealers({}, none.deps);
    assert.equal(none.seen[0], "/api/inventory/dealer-analytics/dealers", "no flags, no query string");
  });

  it("per-dealer and market calls use the box paths and complete the dealer's brands", async () => {
    const a = box({ dealer: { dealerId: 5, dealerName: "Honda Cars of McKinney", brandTags: [] }, trend: [] });
    const view = await dealerAnalyticsDealer(5, { limit: 25, offset: 0, direction: "drop" }, a.deps);
    assert.equal(a.seen[0], "/api/inventory/dealer-analytics/dealers/5?limit=25&offset=0&direction=drop");
    assert.deepEqual(view.dealer.brands, ["Honda"]);
    const b = box({ rows: [] });
    await dealerAnalyticsMarket(5, { day: "2026-10-31" }, b.deps);
    assert.equal(b.seen[0], "/api/inventory/dealer-analytics/dealers/5/market?day=2026-10-31");
  });

  it("dealerAnalyticsQuery drops empty values and writes true as 1", () => {
    assert.equal(dealerAnalyticsQuery({ a: undefined, b: "", c: false, d: true, e: 0, f: "x" }), "?d=1&e=0&f=x");
    assert.equal(dealerAnalyticsQuery({}), "");
  });
});
