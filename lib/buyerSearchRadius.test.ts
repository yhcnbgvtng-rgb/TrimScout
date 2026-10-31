/**
 * Regression: "910 vehicles found" with an empty list. A radius used to be applied to ONE box page, so a page with no nearby car came back
 * as zero rows while `total` still counted the whole state. The count must describe the rows, and "load more" must reach them.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { parseBuyerSearchParams } from "./buyerSearchQuery";
import { runBuyerSearch } from "./buyerSearch";

// The box returns trim order: 200 cars in Chicago (placed, far), 20 in Cape May NJ (a city the app cannot place, only its state), then 30 in
// Brooklyn (placed, ~1 mi from ZIP 11201). A radius must keep Brooklyn and the unplaceable dealer, and cut Chicago.
const rows = (n: number, city: string, state: string, dealerId: string) => Array.from({ length: n }, () => ({ city, state, dealerId }));
const SPEC = [...rows(200, "Chicago", "IL", "100"), ...rows(20, "Cape May", "NJ", "150"), ...rows(30, "Brooklyn", "NY", "200")];
const NEAR = 30, UNPLACED = 20, KEPT = NEAR + UNPLACED;
const CARS = SPEC.map((c, i) => ({
  vin: `1FTFW1E5X${String(i).padStart(8, "0")}`, vehicleId: i + 1, dealerId: c.dealerId, dealerName: `${c.city} Ford`,
  dealerCity: c.city, dealerState: c.state, state: c.state, make: "Ford", model: "F-150", year: 2024, price: 40000 + i, lastSeenAt: "2026-10-30 10:00:00", sourceBox: "b",
}));
const realFetch = globalThis.fetch;
let boxCalls = 0;
function fakeFetch(url: any): Promise<Response> {
  const u = new URL(String(url));
  const json = (o: unknown) => Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } }));
  if (u.port === "3003") return json({ dealerships: [] });
  if (u.pathname !== "/api/inventory") return json({ error: "unexpected " + u.pathname });
  boxCalls++;
  const limit = Number(u.searchParams.get("limit")), offset = Number(u.searchParams.get("offset") || 0);
  return json({ total: CARS.length, limit, offset, vehicles: CARS.slice(offset, offset + limit) });
}
const parse = (extra: string) => parseBuyerSearchParams(new URLSearchParams(`make=Ford&model=F-150&yearMin=2024${extra}`));

describe("radius search: the count describes the rows and the rows load", () => {
  beforeEach(() => { boxCalls = 0; process.env.LIGHTSAIL_API_KEY = "test-key"; globalThis.fetch = fakeFetch as typeof fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("first page has rows even though the box's first page holds no nearby car (total > 0 never comes with an empty list)", async () => {
    const r = await runBuyerSearch(parse("&zip=11201&radiusMiles=25&limit=50&offset=0"));
    assert.equal(r.total, KEPT, "count is the cars the radius keeps, not the whole result set");
    assert.ok(r.vehicles.length > 0, "list is not empty when the count is positive");
    assert.equal(r.vehicles.length, KEPT);
    assert.ok(r.vehicles.every((v) => v.dealerCity !== "Chicago"), "a placed dealer outside the radius is cut");
  });

  it("a dealer placed only by state shows no distance, is not cut by the radius, and sorts after cars with a real distance", async () => {
    const r = await runBuyerSearch(parse("&zip=11201&radiusMiles=25&limit=100&sort=distance:asc"));
    assert.equal(r.total, r.vehicles.length);
    const near = r.vehicles.filter((v) => v.dealerCity === "Brooklyn"), unplaced = r.vehicles.filter((v) => v.dealerCity === "Cape May");
    assert.equal(near.length, NEAR);
    assert.equal(unplaced.length, UNPLACED);
    assert.ok(near.every((v) => v.distanceMiles !== null && v.distanceMiles <= 25));
    assert.ok(unplaced.every((v) => v.distanceMiles === null), "no made-up state-centroid distance");
    assert.ok(r.vehicles.slice(0, NEAR).every((v) => v.dealerCity === "Brooklyn"), "real distances first");
  });

  it("load more walks the filtered set: pages add up to the count, no repeats", async () => {
    const a = await runBuyerSearch(parse("&zip=11201&radiusMiles=25&limit=20&offset=0"));
    const b = await runBuyerSearch(parse("&zip=11201&radiusMiles=25&limit=20&offset=20"));
    const c = await runBuyerSearch(parse("&zip=11201&radiusMiles=25&limit=20&offset=40"));
    assert.equal(a.total, b.total);
    assert.equal(a.vehicles.length + b.vehicles.length + c.vehicles.length, a.total);
    assert.equal(new Set([...a.vehicles, ...b.vehicles, ...c.vehicles].map((v) => v.vin)).size, a.total);
  });

  it("a count-only request (limit=1) reports the same total as the list", async () => {
    const one = await runBuyerSearch(parse("&zip=11201&radiusMiles=25&limit=1"));
    const list = await runBuyerSearch(parse("&zip=11201&radiusMiles=25&limit=50"));
    assert.equal(one.total, list.total);
    assert.equal(one.vehicles.length, 1);
  });

  it("nothing placeable inside the radius: count and rows still agree", async () => {
    const r = await runBuyerSearch(parse("&zip=11201&radiusMiles=1&limit=100"));
    assert.equal(r.vehicles.length, r.total);
  });

  it("without a radius the box page is used as before (one call)", async () => {
    const r = await runBuyerSearch(parse("&limit=50"));
    assert.equal(boxCalls, 1);
    assert.equal(r.vehicles.length, 50);
    assert.equal(r.total, CARS.length);
  });
});
