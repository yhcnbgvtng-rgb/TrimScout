import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collapseByVin, type OnePerVinRow } from "./onePerVin";
import { inventoryQueryString } from "./inventoryApi";

const car = (dealerId: string, lastSeenAt: string, price: number | null, vin = "1FTFW1E50NFA00001"): OnePerVinRow => ({ vin, dealerId, price, lastSeenAt });

describe("collapseByVin — one listing per VIN", () => {
  it("same VIN at two stores: the one seen most recently stays", () => {
    const { rows, dropped } = collapseByVin([car("1", "2026-10-26T22:00:00Z", 39000), car("2", "2026-10-27T02:00:00Z", 45000)]);
    assert.deepEqual(rows.map((r) => r.dealerId), ["2"]);
    assert.equal(dropped, 1);
  });
  it("a tie goes to the nearer store when the buyer's location is known", () => {
    const t = "2026-10-27T02:00:00Z";
    const miles: Record<string, number> = { "1": 80, "2": 12 };
    const { rows } = collapseByVin([car("1", t, 30000), car("2", t, 45000)], (r) => miles[r.dealerId!] ?? null);
    assert.deepEqual(rows.map((r) => r.dealerId), ["2"]);
  });
  it("a tie with no location goes to the lowest price, then the lowest dealer id", () => {
    const t = "2026-10-27T02:00:00Z";
    assert.deepEqual(collapseByVin([car("1", t, 45000), car("2", t, 41000)]).rows.map((r) => r.dealerId), ["2"]);
    assert.deepEqual(collapseByVin([car("7", t, 41000), car("3", t, 41000)]).rows.map((r) => r.dealerId), ["3"]);
    assert.deepEqual(collapseByVin([car("1", t, null), car("2", t, 90000)]).rows.map((r) => r.dealerId), ["2"]);
  });
  it("an unknown distance never beats a known one; equal distances fall back to price", () => {
    const t = "2026-10-27T02:00:00Z";
    const d: Record<string, number | null> = { "1": null, "2": 50, "3": 50 };
    assert.deepEqual(collapseByVin([car("1", t, 1), car("2", t, 9)], (r) => d[r.dealerId!]).rows.map((r) => r.dealerId), ["2"]);
    assert.deepEqual(collapseByVin([car("2", t, 9), car("3", t, 5)], (r) => d[r.dealerId!]).rows.map((r) => r.dealerId), ["3"]);
  });
  it("a single store, and different VINs, are untouched and keep their order", () => {
    const rows = [car("1", "2026-10-27T02:00:00Z", 1, "A"), car("1", "2026-10-27T02:00:00Z", 2, "B")];
    const out = collapseByVin(rows);
    assert.deepEqual(out.rows, rows);
    assert.equal(out.dropped, 0);
  });
});

describe("onePerVin on the wire", () => {
  it("is sent only when set (admin and dealer queries never set it)", () => {
    assert.doesNotMatch(inventoryQueryString({ inStock: true, make: "Ford" }), /onePerVin/);
    assert.match(inventoryQueryString({ inStock: true, onePerVin: "1" }), /onePerVin=1/);
  });
});
