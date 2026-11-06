/**
 * Regression: a sparse make with a ZIP + radius. The search used to read the first BUYER_COUNT_CAP (1000) cars of the make in the box's
 * dealer-name order — a nationwide list — and only then cut by radius, so nearby stock that sorted late never arrived and the page showed
 * almost nothing. Dealers inside the radius are now resolved first (directory ZIPs through the ZCTA table) and the box is asked only for
 * their cars, before its cap. Fixtures and a fake box only.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { parseBuyerSearchParams, BUYER_COUNT_CAP } from "./buyerSearchQuery";
import { runBuyerSearch } from "./buyerSearch";
import { dealerIdsWithin, zipLatLng } from "./dealerGeo";
import { buildContactIndex } from "./dealerContactIndex";
import type { Dealership } from "./dealershipsApi";

type Car = { vin: string; vehicleId: number; dealerId: string; dealerName: string; dealerCity: string; dealerState: string; state: string; make: string; model: string; year: number; price: number; lastSeenAt: string; sourceBox: string };

const FAR_DEALERS = 30, CARS_PER_FAR = 50; // 1,500 Ford cars in Dallas: more than the 1,000 cap, and they sort FIRST by dealer name
const dealer = (id: string, name: string, city: string, state: string, zip: string) => ({ id, dealerName: name, address: null, city, state, zipCode: zip, phone: null, contactName: null, contactEmail: null, notes: null, website: null, domains: [], emailOptOut: false, createdAt: "", updatedAt: "" });
const DIRECTORY = [
  ...Array.from({ length: FAR_DEALERS }, (_, i) => dealer(String(i + 1), `Alpha Ford ${String(i + 1).padStart(2, "0")}`, "Dallas", "TX", "75201")),
  dealer("901", "Zeta Ford Newark", "Newark", "NJ", "07102"),
  dealer("902", "Zulu Ford Brooklyn", "Brooklyn", "NY", "11201"),
  dealer("903", "Zed Ford Honolulu", "Honolulu", "HI", "96813"),
];
let seq = 0;
const car = (d: { id: string; dealerName: string; city: string; state: string }): Car => ({ vin: `1FTFW1E5X${String(++seq).padStart(8, "0")}`, vehicleId: seq, dealerId: d.id, dealerName: d.dealerName, dealerCity: d.city, dealerState: d.state, state: d.state, make: "Ford", model: "Bronco", year: 2025, price: 40000 + seq, lastSeenAt: "2026-11-04 10:00:00", sourceBox: "b" });
const byName = (a: Car, b: Car) => (a.dealerName < b.dealerName ? -1 : a.dealerName > b.dealerName ? 1 : a.vehicleId - b.vehicleId);
const STOCK: Car[] = [
  ...DIRECTORY.slice(0, FAR_DEALERS).flatMap((d) => Array.from({ length: CARS_PER_FAR }, () => car(d))),
  ...Array.from({ length: 8 }, () => car(DIRECTORY[FAR_DEALERS])),
  ...Array.from({ length: 4 }, () => car(DIRECTORY[FAR_DEALERS + 1])),
  ...Array.from({ length: 5 }, () => car(DIRECTORY[FAR_DEALERS + 2])),
].sort(byName);
const NEAR = 12; // Newark 8 + Brooklyn 4 are within 25 miles of 11201; Honolulu is not

const realFetch = globalThis.fetch;
let unscopedCalls = 0, scopedCalls = 0, scopedIds: string[] = [];
let scopedEndpoint: "ok" | "missing" = "ok";
const json = (o: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } }));

/** The box: same make filter + dealer-name order + count cap as the real list query; the POST variant adds the dealer-id filter. */
function page(rows: Car[], q: URLSearchParams) {
  const cap = Number(q.get("countCap")) || Infinity, limit = Number(q.get("limit")), offset = Number(q.get("offset") || 0);
  const matched = rows.filter((c) => c.make === q.get("make"));
  const total = Math.min(matched.length, cap);
  return { total, totalCapped: matched.length > cap, limit, offset, vehicles: matched.slice(0, cap).slice(offset, offset + limit) };
}
function fakeFetch(url: any, init?: RequestInit): Promise<Response> {
  const u = new URL(String(url));
  if (u.port === "3003") return json({ dealerships: DIRECTORY });
  if (u.pathname === "/api/inventory") { unscopedCalls++; return json(page(STOCK, u.searchParams)); }
  if (u.pathname === "/api/inventory/contact-search") {
    if (scopedEndpoint === "missing") return json({ error: "not found" }, 404);
    scopedCalls++;
    const body = JSON.parse(String(init?.body));
    scopedIds = body.dealerIds;
    const ids = new Set<string>(body.dealerIds);
    const p = page(STOCK.filter((c) => ids.has(c.dealerId)), new URLSearchParams(body.query));
    return json({ ...p, contactFilter: { dealers: body.dealerIds.length } });
  }
  return json({ error: "unexpected " + u.pathname }, 500);
}
const parse = (extra: string) => parseBuyerSearchParams(new URLSearchParams(`make=Ford&model=Bronco${extra}`));

describe("ZIP + radius resolves dealers in range BEFORE the 1,000-row cap", () => {
  beforeEach(() => { unscopedCalls = 0; scopedCalls = 0; scopedIds = []; scopedEndpoint = "ok"; process.env.LIGHTSAIL_API_KEY = "test-key"; globalThis.fetch = fakeFetch as typeof fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("the fixture really is the failure: the make has more cars than the cap and every near car sorts after them", () => {
    assert.ok(STOCK.length > BUYER_COUNT_CAP);
    const firstCap = STOCK.slice(0, BUYER_COUNT_CAP);
    assert.equal(firstCap.filter((c) => ["901", "902"].includes(c.dealerId)).length, 0, "the old scan would have read none of the nearby stock");
  });

  it("a sparse-make search near Brooklyn finds all of the nearby cars, none of the far ones", async () => {
    const r = await runBuyerSearch(parse("&zip=11201&radiusMiles=25&limit=50"));
    assert.equal(r.total, NEAR);
    assert.equal(r.vehicles.length, NEAR);
    assert.ok(r.vehicles.every((v) => ["901", "902"].includes(String(v.dealerId))));
    assert.ok(r.vehicles.every((v) => v.distanceMiles !== null && v.distanceMiles <= 25));
  });

  it("asks the box only for the dealers in range (the box never sees the far dealers)", async () => {
    await runBuyerSearch(parse("&zip=11201&radiusMiles=25&limit=50"));
    assert.equal(unscopedCalls, 0, "no nationwide scan");
    assert.ok(scopedCalls >= 1);
    assert.deepEqual([...scopedIds].sort(), ["901", "902"]);
  });

  it("the count is exact (no '+') and equals the rows: count, pages and 'load more' are one set", async () => {
    const a = await runBuyerSearch(parse("&zip=11201&radiusMiles=25&limit=5&offset=0"));
    const b = await runBuyerSearch(parse("&zip=11201&radiusMiles=25&limit=5&offset=5"));
    const c = await runBuyerSearch(parse("&zip=11201&radiusMiles=25&limit=5&offset=10"));
    assert.equal(a.total, NEAR);
    assert.equal(a.totalCapped, false);
    assert.equal(a.vehicles.length + b.vehicles.length + c.vehicles.length, NEAR);
    assert.equal(new Set([...a.vehicles, ...b.vehicles, ...c.vehicles].map((v) => v.vin)).size, NEAR);
    const one = await runBuyerSearch(parse("&zip=11201&radiusMiles=25&limit=1"));
    assert.equal(one.total, a.total, "a count-only request reports the same total as the list");
  });

  it("a radius wide enough to hold the whole country is still capped honestly (a floor, not an exact count); a tight one stays exact", async () => {
    const wide = await runBuyerSearch(parse("&zip=11201&radiusMiles=5000&limit=100"));
    assert.ok(scopedIds.includes("903"), "Honolulu is inside 5,000 miles, so its dealer is asked for");
    assert.equal(wide.totalCapped, true, "more than the cap is in range: '1,000+', never a false exact number");
    const tight = await runBuyerSearch(parse("&zip=11201&radiusMiles=5&limit=100"));
    assert.ok(tight.vehicles.every((v) => v.distanceMiles !== null && v.distanceMiles <= 5), "post-filter keeps the exact radius rule");
    assert.equal(tight.total, tight.vehicles.length);
  });

  it("no ZIP / radius: the search is unchanged (plain box query, no dealer list)", async () => {
    const r = await runBuyerSearch(parse("&limit=50"));
    assert.equal(scopedCalls, 0);
    assert.equal(unscopedCalls, 1);
    assert.equal(r.vehicles.length, 50);
  });

  it("a box without the dealer-id endpoint falls back to the old scan instead of failing", async () => {
    scopedEndpoint = "missing";
    const r = await runBuyerSearch(parse("&zip=11201&radiusMiles=25&limit=50"));
    assert.ok(unscopedCalls >= 1, "fell back to the nationwide scan");
    assert.equal(r.total, r.vehicles.length);
    assert.equal(r.totalCapped, true, "and says the count is a floor, as it always did");
  });

  it("dealerIdsWithin: directory dealers placed by ZIP inside the radius, none when the buyer ZIP or directory is unknown", () => {
    const idx = buildContactIndex(DIRECTORY as unknown as Dealership[]);
    const buyer = zipLatLng("11201");
    assert.deepEqual(dealerIdsWithin(idx, buyer, 25).sort(), ["901", "902"]);
    assert.deepEqual(dealerIdsWithin(idx, zipLatLng("00000"), 25), []);
    assert.deepEqual(dealerIdsWithin(null, buyer, 25), []);
  });
});
