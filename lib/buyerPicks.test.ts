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

// ---- expiry, unsaving, and cars that are no longer listed -------------------------------------------------------------------------
import { PICK_TTL_MS, stampSaved, dropExpired, removeKey, dropGone, pickNotice, listingFor, type PickListing } from "./buyerPicks";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-07T18:00:00Z");
const saved = (vin: string, savedAt: number | null) => ({ ...car(vin), savedAt });

describe("saved picks expire 7 days after they were saved", () => {
  it("the window is exactly 7 days", () => assert.equal(PICK_TTL_MS, 7 * DAY));

  it("a pick saved 6 days 23 hours ago is kept; one saved 7 days and a second ago is dropped; exactly 7 days is still kept", () => {
    const { live, expired } = dropExpired([saved("A", NOW - (6 * DAY + 23 * 3600_000)), saved("B", NOW - (7 * DAY + 1000)), saved("C", NOW - 7 * DAY)], NOW);
    assert.deepEqual(live.map((p) => p.vin), ["A", "C"]);
    assert.deepEqual(expired.map((p) => p.vin), ["B"]);
  });

  it("a pick that is only ticked (no save time) is never expired", () => {
    const { live, expired } = dropExpired([saved("A", null)], NOW);
    assert.equal(live.length, 1);
    assert.equal(expired.length, 0);
  });

  it("saving stamps a new pick with the save time, and saving again does NOT extend an already-saved pick", () => {
    const earlier = NOW - 3 * DAY;
    const out = stampSaved([saved("OLD", earlier), saved("NEW", null)], NOW);
    assert.equal(out.find((p) => p.vin === "OLD")!.savedAt, earlier, "original time kept");
    assert.equal(out.find((p) => p.vin === "NEW")!.savedAt, NOW);
  });

  it("toPick starts unsaved, and savedAt survives a storage round trip (and is dropped when it is garbage)", () => {
    assert.equal(car("A").savedAt, null);
    const round = parseStored(JSON.stringify({ picks: [saved("A", NOW), { ...saved("B", NOW), savedAt: "yesterday" }, { ...saved("C", NOW), savedAt: -5 }], viewed: [] }));
    assert.deepEqual(round.picks.map((p) => p.savedAt), [NOW, null, null]);
  });
});

describe("unsaving", () => {
  it("removeKey drops exactly that pick and keeps the others and their save times", () => {
    const picks = [saved("A", NOW), saved("B", NOW - DAY), saved("C", NOW)];
    const out = removeKey(picks, picks[1].key);
    assert.deepEqual(out.map((p) => p.vin), ["A", "C"]);
    assert.equal(out[0].savedAt, NOW);
    assert.equal(removeKey(picks, "nope").length, 3);
  });
  it("clearing is simply an empty list: nothing left to expire, and the 3-pick rule starts fresh", () => {
    assert.deepEqual(dropExpired([], NOW), { live: [], expired: [] });
    let picks: ReturnType<typeof car>[] = [];
    for (const v of ["A", "B", "C"]) picks = togglePick(picks, car(v)).picks;
    assert.equal(togglePick(picks, car("D")).outcome, "blocked");
    picks = [];
    assert.equal(togglePick(picks, car("D")).outcome, "added");
  });
});

describe("a pick whose car is no longer listed is dropped; doubt keeps it", () => {
  const a = saved("A", NOW), b = saved("B", NOW), c = saved("C", NOW);
  it("drops only 'gone'; 'listed', 'unknown' and an unanswered pick all stay", () => {
    const listing: Record<string, PickListing> = { [a.key]: "gone", [b.key]: "listed", [c.key]: "unknown" };
    const { live, gone } = dropGone([a, b, c], listing);
    assert.deepEqual(gone.map((p) => p.vin), ["A"]);
    assert.deepEqual(live.map((p) => p.vin), ["B", "C"]);
    assert.equal(dropGone([a], {}).live.length, 1, "a failed check (no answer) never costs a pick");
  });

  const here = { vin: "V", dealerId: "11", dealerName: "A Motors" };
  it("listed: one live listing of the VIN at this store", () => {
    assert.equal(listingFor(here, [{ dealerId: "11", dealerName: "A Motors", removedAt: null }]), "listed");
  });
  it("gone: every listing at this store is removed (sold)", () => {
    assert.equal(listingFor(here, [{ dealerId: "11", dealerName: "A Motors", removedAt: "2026-10-05T10:00:00Z" }]), "gone");
  });
  it("gone: the VIN is only listed at a DIFFERENT store now (the same VIN at two stores is two vehicles)", () => {
    assert.equal(listingFor(here, [{ dealerId: "99", dealerName: "B Motors", removedAt: null }]), "gone");
  });
  it("listed at this store even when another store's copy was removed", () => {
    assert.equal(listingFor(here, [{ dealerId: "99", dealerName: "B Motors", removedAt: "2026-10-01T00:00:00Z" }, { dealerId: "11", dealerName: "A Motors", removedAt: null }]), "listed");
  });
  it("matches by dealer name (case-insensitive) when either side has no store id", () => {
    assert.equal(listingFor({ vin: "V", dealerId: null, dealerName: "A Motors" }, [{ dealerId: "11", dealerName: " a motors ", removedAt: null }]), "listed");
    assert.equal(listingFor(here, [{ dealerId: null, dealerName: "A MOTORS", removedAt: "2026-10-05T10:00:00Z" }]), "gone");
  });
  it("unknown, not gone, when the box has no listing of the VIN at all (never drop a car it never indexed)", () => {
    assert.equal(listingFor(here, []), "unknown");
  });
});

describe("the short note on the bar", () => {
  it("'1 pick removed — no longer listed' / plural / expired / both / nothing", () => {
    assert.equal(pickNotice({ gone: 1, expired: 0 }), "1 pick removed — no longer listed");
    assert.equal(pickNotice({ gone: 2, expired: 0 }), "2 picks removed — no longer listed");
    assert.equal(pickNotice({ gone: 0, expired: 1 }), "1 pick removed — saved over 7 days ago");
    assert.equal(pickNotice({ gone: 1, expired: 2 }), "1 pick removed — no longer listed · 2 picks removed — saved over 7 days ago");
    assert.equal(pickNotice({ gone: 0, expired: 0 }), null);
  });
});
