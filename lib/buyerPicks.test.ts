import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_PICKS, MAX_VIEWED, markViewed, parseStored, sanitizeState, togglePick, toPick, vehicleKey } from "./buyerPicks";

const car = (vin: string, dealerName = "A Motors") => toPick({ vin, dealerId: null, dealerName, dealerState: "NJ", year: 2025, make: "Ford", model: "F-150", trim: null, mileage: null, price: 50000, vdpUrl: null });

describe("togglePick", () => {
  it("adds up to 3, blocks the 4th, and unticking frees a slot", () => {
    let picks = [] as ReturnType<typeof car>[];
    for (const vin of ["1", "2", "3"]) { const r = togglePick(picks, car(vin)); assert.equal(r.outcome, "added"); picks = r.picks; }
    assert.equal(picks.length, MAX_PICKS);
    const blocked = togglePick(picks, car("4"));
    assert.equal(blocked.outcome, "blocked");
    assert.equal(blocked.picks, picks, "a blocked tick changes nothing");
    const freed = togglePick(picks, car("2"));
    assert.equal(freed.outcome, "removed");
    assert.deepEqual(freed.picks.map((p) => p.vin), ["1", "3"]);
    assert.equal(togglePick(freed.picks, car("4")).outcome, "added");
  });
  it("treats the same VIN at two stores as two vehicles", () => {
    assert.notEqual(vehicleKey({ vin: "1", dealerName: "A" }), vehicleKey({ vin: "1", dealerName: "B" }));
    assert.equal(togglePick([car("1", "A")], car("1", "B")).outcome, "added");
  });
});

describe("markViewed", () => {
  it("keeps each key once, newest last, and caps the list", () => {
    assert.deepEqual(markViewed(["a", "b"], "a"), ["b", "a"]);
    assert.deepEqual(markViewed(["a"], "a"), ["a"]);
    const big = Array.from({ length: MAX_VIEWED }, (_, i) => `k${i}`);
    const next = markViewed(big, "new");
    assert.equal(next.length, MAX_VIEWED);
    assert.equal(next[next.length - 1], "new");
    assert.equal(next[0], "k1");
  });
});

describe("sanitizeState / parseStored", () => {
  it("drops bad entries, dedupes, caps picks at 3, never invents values", () => {
    const s = sanitizeState({ picks: [{ vin: "1", dealerName: "A", mileage: 0, price: "x" }, { vin: "", dealerName: "A" }, { vin: "1", dealerName: "A" }, car("2"), car("3"), car("4")], viewed: ["a", 5, "a", ""] });
    assert.equal(s.picks.length, 3);
    assert.equal(s.picks[0].mileage, 0, "a stored 0 stays 0");
    assert.equal(s.picks[0].price, null, "a non-number price becomes null, not 0");
    assert.deepEqual(s.viewed, ["a"]);
  });
  it("survives garbage", () => {
    assert.deepEqual(parseStored("not json"), { picks: [], viewed: [] });
    assert.deepEqual(parseStored(null), { picks: [], viewed: [] });
    assert.deepEqual(sanitizeState(42), { picks: [], viewed: [] });
  });
});
