/**
 * /search data fixes: real ZIP-based distances, one authoritative total + nextOffset, a buyer-safe allow-list, the price guard, and
 * colour filters that find every stored spelling behind a clean value.
 */
import "./testdata/blockLiveHttp";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { parseBuyerSearchParams } from "./buyerSearchQuery";
import { runBuyerSearch, toBuyerVehicle, isSuspectPrice, clearColorFacetCache } from "./buyerSearch";
import { zipLatLng, haversineMiles } from "./dealerGeo";
import type { InventoryVehicle } from "./inventoryApi";

const DEALERS = [
  { id: "11", dealerName: "Fred Beans Hyundai Of Flemington", city: "Flemington", state: "NJ", zipCode: "08822", contactEmail: "a@x.com" },
  { id: "12", dealerName: "Johnson Hyundai Budd Lake", city: "Budd Lake", state: "NJ", zipCode: "07828", contactEmail: "b@x.com" },
  { id: "13", dealerName: "Cherry Hill Hyundai", city: "Cherry Hill", state: "NJ", zipCode: "08003", contactEmail: "c@x.com" },
  { id: "14", dealerName: "Mystery Hyundai", city: "Nowhereville", state: "NJ", zipCode: null, contactEmail: "d@x.com" },
  { id: "15", dealerName: "Typo Zip Hyundai", city: "Somewhere", state: "NJ", zipCode: "00000", contactEmail: "e@x.com" },
];
const ph = (n: number) => String(n).padStart(6, "0");
let seq = 0;
const car = (d: (typeof DEALERS)[number], extra: Partial<InventoryVehicle> = {}) => ({
  vin: `5NMJ3DEA0RH${ph(++seq)}`, vehicleId: seq, dealerId: d.id, dealerName: d.dealerName, dealerCity: d.city, dealerState: d.state, state: d.state,
  make: "Hyundai", model: "Tucson", trim: "SEL", year: 2025, condition: "new", price: 30000 + seq, msrp: 32000, lastSeenAt: "2026-10-30 10:00:00", sourceBox: "box1", ...extra,
}) as unknown as InventoryVehicle;

const CARS = [
  ...DEALERS.flatMap((d) => Array.from({ length: d.id === "12" ? 40 : 30 }, () => car(d))),
];
const realFetch = globalThis.fetch;
let boxUrls: string[] = [];
function fakeFetch(url: any): Promise<Response> {
  const u = new URL(String(url));
  const json = (o: unknown) => Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } }));
  if (u.port === "3003") return json({ dealerships: DEALERS });
  if (u.pathname === "/api/inventory/catalog") return json({ options: [], exteriorColors: ["0300 Alpine White", "Alpine White", "BK"], interiorColors: [] });
  if (u.pathname !== "/api/inventory") return json({ error: "unexpected " + u.pathname });
  boxUrls.push(u.search);
  let rows = CARS;
  const ext = u.searchParams.get("exteriorColor");
  if (ext) rows = rows.filter((c) => c.exteriorColor === ext);
  const limit = Number(u.searchParams.get("limit")), offset = Number(u.searchParams.get("offset") || 0);
  return json({ total: rows.length, limit, offset, vehicles: rows.slice(offset, offset + limit) });
}
const parse = (extra: string) => parseBuyerSearchParams(new URLSearchParams(`make=Hyundai&model=Tucson&state=NJ${extra}`));

describe("ZIP table", () => {
  it("07836 -> Flemington is about 24 miles, Budd Lake about 4", () => {
    const b = zipLatLng("07836")!;
    assert.ok(Math.abs(haversineMiles(b, zipLatLng("08822")!) - 23.7) < 1);
    assert.ok(haversineMiles(b, zipLatLng("07828")!) < 6);
  });
  it("an unknown ZIP is null", () => { assert.equal(zipLatLng("00000"), null); assert.equal(zipLatLng("abc"), null); assert.equal(zipLatLng(null), null); });
});

describe("radius search with real dealer coordinates", () => {
  beforeEach(() => { seq = 0; boxUrls = []; clearColorFacetCache(); process.env.LIGHTSAIL_API_KEY = "test-key"; process.env.LIGHTSAIL_IP = "203.0.113.10"; globalThis.fetch = fakeFetch as typeof fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("NJ Hyundai 07836 25 mi includes the Flemington and Budd Lake dealers with real distances and drops Cherry Hill", async () => {
    const r = await runBuyerSearch(parse("&zip=07836&radiusMiles=25&limit=100&sort=distance"));
    const byDealer = (id: string) => r.vehicles.filter((v) => v.dealerId === id);
    assert.ok(byDealer("11").length > 0, "Flemington present");
    assert.ok(byDealer("12").length > 0, "Budd Lake present");
    assert.equal(byDealer("13").length, 0, "Cherry Hill is ~70 miles away");
    const flem = byDealer("11")[0].distanceMiles!, budd = byDealer("12")[0].distanceMiles!;
    assert.ok(flem > 20 && flem <= 25, `Flemington ${flem}`);
    assert.ok(budd < 10, `Budd Lake ${budd}`);
    assert.notEqual(flem, budd, "distances differ per dealer");
  });

  it("a dealer with no usable ZIP gets distance null, is kept, and sorts after every real distance", async () => {
    const r = await runBuyerSearch(parse("&zip=07836&radiusMiles=25&limit=100&sort=distance"));
    const unknown = r.vehicles.filter((v) => v.dealerId === "14" || v.dealerId === "15");
    assert.ok(unknown.length > 0);
    assert.ok(unknown.every((v) => v.distanceMiles === null));
    const firstNull = r.vehicles.findIndex((v) => v.distanceMiles === null);
    assert.ok(r.vehicles.slice(firstNull).every((v) => v.distanceMiles === null), "nulls all last");
    assert.ok(r.vehicles.every((v) => v.distanceMiles === null || v.distanceMiles <= 25));
  });

  it("total is stable across pages and nextOffset walks the set exactly once", async () => {
    const seen = new Set<string>();
    let offset: number | null = 0, total = -1, pages = 0;
    while (offset !== null && pages++ < 20) {
      const r = await runBuyerSearch(parse(`&zip=07836&radiusMiles=25&limit=20&offset=${offset}`));
      if (total < 0) total = r.total;
      assert.equal(r.total, total, "same total on every page");
      assert.equal(r.offset, offset);
      for (const v of r.vehicles) { assert.ok(!seen.has(v.vin)); seen.add(v.vin); }
      offset = r.nextOffset;
    }
    assert.equal(seen.size, total);
    assert.equal(total, 40 + 30 + 30 + 30, "Budd Lake + Flemington + two unplaceable dealers");
  });

  it("without a radius: total and nextOffset come from the one box query", async () => {
    const r = await runBuyerSearch(parse("&limit=50&offset=0"));
    assert.equal(r.total, CARS.length);
    assert.equal(r.nextOffset, 50);
    const last = await runBuyerSearch(parse("&limit=50&offset=150"));
    assert.equal(last.nextOffset, null);
  });
});

describe("colour filter on a clean value", () => {
  beforeEach(() => { seq = 0; boxUrls = []; clearColorFacetCache(); process.env.LIGHTSAIL_API_KEY = "test-key"; process.env.LIGHTSAIL_IP = "203.0.113.10"; globalThis.fetch = fakeFetch as typeof fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });
  it("Alpine White finds cars stored as '0300 Alpine White' and 'Alpine White', with one merged total", async () => {
    CARS[0] = car(DEALERS[0], { exteriorColor: "0300 Alpine White" });
    CARS[1] = car(DEALERS[0], { exteriorColor: "Alpine White" });
    CARS[2] = car(DEALERS[0], { exteriorColor: "BK" });
    const r = await runBuyerSearch(parse("&exteriorColor=Alpine%20White&limit=50"));
    assert.equal(r.total, 2);
    assert.equal(r.vehicles.length, 2);
    assert.equal(r.nextOffset, null);
  });
});

describe("buyer vehicle is an allow-list", () => {
  const dirty = {
    vin: "5NMJ3DEA0RH000001", vehicleId: 9, dealerId: "11", dealerName: "Fred Beans Hyundai", dealerCity: "Flemington", dealerState: "NJ", price: 31000, msrp: 32000,
    exteriorColor: "Alpine White", interiorColor: "Black", firstSeenAt: "2026-10-01T06:28:19.000Z", lastSeenAt: "2026-10-22T06:28:19.000Z", crawlFirstSeen: "2026-09-30", sourceBox: "box4",
    removedAt: "2026-10-20 03:00:00", daysOnLot: 41, changeType: "price_drop", priceHistory: [{ date: "2026-10-01", price: 33000 }], secretNewBoxField: "leak",
    options: [
      { code: "A1", name: "Heated Seats", price: 500, kind: "factory" },
      { code: null, name: "Please call Matt or Darren at (973) 328-1900", price: null, kind: "factory" },
      { code: null, name: "Sales line 740-928-9000", price: null, kind: "factory" },
      { code: null, name: "email sales@dealer.com", price: null, kind: "factory" },
      { code: "Z9", name: "Pinstripes", price: 99, kind: "dealer" },
    ],
  } as unknown as InventoryVehicle;
  const b = toBuyerVehicle(dirty, null, null);
  const json = JSON.stringify(b);
  it("no phone or email patterns, no ISO dates, none of the removed keys, no unlisted box field", () => {
    assert.doesNotMatch(json, /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}/);
    assert.doesNotMatch(json, /[\w.+-]+@[\w-]+\.\w+/);
    assert.doesNotMatch(json, /\d{4}-\d{2}-\d{2}/);
    for (const k of ["priceHistory", "removedAt", "changeType", "daysOnLot", "secretNewBoxField", "sourceBox", "firstSeenAt", "lastSeenAt", "crawlFirstSeen"]) assert.ok(!(k in b), k);
  });
  it("keeps factory options only", () => { assert.deepEqual(b.options?.map((o) => o.name), ["Heated Seats"]); });
});

describe("price guard", () => {
  it("under $1,000 or over 5x MSRP is suspect; normal prices and unknown MSRP are not", () => {
    assert.equal(isSuspectPrice(37, 40000), true);
    assert.equal(isSuspectPrice(999, null), true);
    assert.equal(isSuspectPrice(1000, null), false);
    assert.equal(isSuspectPrice(250001, 50000), true);
    assert.equal(isSuspectPrice(250000, 50000), false);
    assert.equal(isSuspectPrice(45000, null), false);
    assert.equal(isSuspectPrice(null, 40000), false);
  });
  it("a $37 Tesla comes out with price null and priceSuspect true", () => {
    const b = toBuyerVehicle({ vin: "5YJ3E1EA7PF000001", price: 37, msrp: 42000, oldPrice: 30, priceDiff: 7 } as unknown as InventoryVehicle, null, null);
    assert.equal(b.price, null); assert.equal(b.priceSuspect, true); assert.equal(b.priceDiff, null);
    const ok = toBuyerVehicle({ vin: "5YJ3E1EA7PF000002", price: 41000, msrp: 42000 } as unknown as InventoryVehicle, null, null);
    assert.equal(ok.price, 41000); assert.equal(ok.priceSuspect, false);
  });
});
