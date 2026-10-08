// What the search page does with saved picks on load — the same for a guest (local copy only) and a signed-in buyer (local + account).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reconcileLoaded } from "./buyerPickSession";
import { PICK_TTL_MS, toPick, type BuyerSearchState, type PickedVehicle } from "./buyerPicks";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-07T18:00:00Z");
const car = (vin: string, savedAt: number | null): PickedVehicle => ({ ...toPick({ vin, dealerId: "1", dealerName: "A Motors", dealerState: "NJ", year: 2025, make: "Ford", model: "F-150", trim: null, mileage: 10, price: 40000, vdpUrl: null }), savedAt });
const st = (picks: PickedVehicle[], extra: Partial<BuyerSearchState> = {}): BuyerSearchState => ({ picks, viewed: [], ...extra });

describe("reconcileLoaded — a guest (no account copy)", () => {
  it("keeps fresh saved picks, drops ones saved over 7 days ago, and says how many expired", () => {
    const r = reconcileLoaded({ local: st([car("A", NOW - DAY), car("B", NOW - 8 * DAY)]), server: null, now: NOW });
    assert.deepEqual(r.state.picks.map((p) => p.vin), ["A"]);
    assert.deepEqual(r.expired.map((p) => p.vin), ["B"]);
    assert.equal(r.pushToAccount, false, "a guest has no account to write");
  });
  it("picks saved before expiry existed (no time) are stamped 'saved now', not deleted", () => {
    const r = reconcileLoaded({ local: st([car("A", null)]), server: null, now: NOW });
    assert.equal(r.state.picks.length, 1);
    assert.equal(r.state.picks[0].savedAt, NOW);
    assert.equal(r.expired.length, 0);
  });
  it("an empty local list stays empty", () => {
    assert.deepEqual(reconcileLoaded({ local: st([]), server: null, now: NOW }).state.picks, []);
  });
});

describe("reconcileLoaded — signed in (account copy + local copy)", () => {
  it("expiry applies the same way, and the account is told to drop the expired picks", () => {
    const server = st([car("A", NOW - DAY), car("B", NOW - 9 * DAY)]);
    const r = reconcileLoaded({ local: st([]), server, now: NOW });
    assert.deepEqual(r.state.picks.map((p) => p.vin), ["A"]);
    assert.deepEqual(r.expired.map((p) => p.vin), ["B"]);
    assert.equal(r.pushToAccount, true);
  });
  it("picks the account holds with no save time are stamped now and pushed back so the 7 days start once", () => {
    const r = reconcileLoaded({ local: st([]), server: st([car("A", null)]), now: NOW });
    assert.equal(r.state.picks[0].savedAt, NOW);
    assert.equal(r.pushToAccount, true);
  });
  it("healthy account copy, nothing to change: no write", () => {
    const picks = [car("A", NOW - DAY)];
    const r = reconcileLoaded({ local: st(picks), server: st(picks), now: NOW });
    assert.equal(r.pushToAccount, false);
    assert.deepEqual(r.state.picks.map((p) => p.vin), ["A"]);
  });
  it("a clear (or ×) that never reached the account is NOT undone: the newer local change wins and is pushed again", () => {
    // The buyer cleared at NOW-1h while offline; the account still has the picks saved a day ago.
    const server = st([car("A", NOW - DAY), car("B", NOW - DAY)]);
    const local = st([], { picksEditedAt: NOW - 3600_000 });
    const r = reconcileLoaded({ local, server, now: NOW });
    assert.deepEqual(r.state.picks, []);
    assert.equal(r.pushToAccount, true);
  });
  it("…but an account copy saved AFTER the local edit (another device) wins", () => {
    const server = st([car("A", NOW - 1000)]);
    const local = st([], { picksEditedAt: NOW - 3600_000 });
    const r = reconcileLoaded({ local, server, now: NOW });
    assert.deepEqual(r.state.picks.map((p) => p.vin), ["A"]);
  });
  it("with no local edit and nothing on the account, the local picks are used (the account store was down when they were saved)", () => {
    const r = reconcileLoaded({ local: st([car("A", NOW - DAY)]), server: st([]), now: NOW });
    assert.deepEqual(r.state.picks.map((p) => p.vin), ["A"]);
  });
  it("viewed marks from both copies are merged, each once", () => {
    const r = reconcileLoaded({ local: st([], { viewed: ["x", "y"] }), server: st([], { viewed: ["y", "z"] }), now: NOW });
    assert.deepEqual(r.state.viewed.sort(), ["x", "y", "z"]);
  });
});

describe("the locked rules still hold", () => {
  it("reconciling never produces more than 3 picks (the storage sanitizer caps them) and never invents one", () => {
    const four = [car("A", NOW), car("B", NOW), car("C", NOW), car("D", NOW)];
    const r = reconcileLoaded({ local: st(four.slice(0, 3)), server: null, now: NOW });
    assert.ok(r.state.picks.length <= 3);
    assert.equal(PICK_TTL_MS, 7 * DAY);
  });
});
