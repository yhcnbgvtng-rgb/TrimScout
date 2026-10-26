import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isHiddenFromBuyerSearch, isRfqEligible, STALE_HIDE_DAYS, RFQ_MAX_AGE_DAYS } from "./lastConfirmed";
import { toBuyerVehicle } from "./buyerSearch";
import type { InventoryVehicle } from "./inventoryApi";

const NOW = Date.parse("2026-10-10T15:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86400_000).toISOString();

describe("age bands", () => {
  it("the thresholds are 3 and 7 days", () => {
    assert.equal(RFQ_MAX_AGE_DAYS, 3);
    assert.equal(STALE_HIDE_DAYS, 7);
  });
  it("up to 3 days: shown and RFQ-eligible", () => {
    for (const d of [0, 1, 3]) {
      assert.equal(isRfqEligible(daysAgo(d), NOW), true, String(d));
      assert.equal(isHiddenFromBuyerSearch(daysAgo(d), NOW), false);
    }
  });
  it("3 to 7 days: shown, not RFQ-eligible", () => {
    for (const d of [3.001, 5, 7]) {
      assert.equal(isRfqEligible(daysAgo(d), NOW), false, String(d));
      assert.equal(isHiddenFromBuyerSearch(daysAgo(d), NOW), false, String(d));
    }
  });
  it("over 7 days: hidden from buyer search (and not RFQ-eligible)", () => {
    for (const d of [7.001, 30]) {
      assert.equal(isHiddenFromBuyerSearch(daysAgo(d), NOW), true, String(d));
      assert.equal(isRfqEligible(daysAgo(d), NOW), false, String(d));
    }
  });
  it("a missing or unparseable date is never hidden and stays eligible", () => {
    for (const bad of [null, undefined, "", "not a date"]) {
      assert.equal(isHiddenFromBuyerSearch(bad, NOW), false);
      assert.equal(isRfqEligible(bad, NOW), true);
    }
  });
});

describe("toBuyerVehicle", () => {
  it("exposes rfqEligible, never the crawl date or the box", () => {
    const stale = { vin: "1", dealerName: "X", lastSeenAt: "2020-01-01T00:00:00.000Z", sourceBox: "box1", crawlFirstSeen: null } as unknown as InventoryVehicle;
    const fresh = { ...stale, lastSeenAt: new Date().toISOString() } as InventoryVehicle;
    assert.equal(toBuyerVehicle(stale, null, null).rfqEligible, false);
    const b = toBuyerVehicle(fresh, null, null);
    assert.equal(b.rfqEligible, true);
    for (const k of ["sourceBox", "lastSeenAt", "lastConfirmedAt"]) assert.equal(k in b, false, k);
  });
});

describe("buyerHideDays — the staleness rule flag", () => {
  it("is the shipped 7 days unless STALE_RULE is exactly 1", async () => {
    const { buyerHideDays, STALE_RULE_HIDE_DAYS } = await import("./lastConfirmed");
    for (const v of [undefined, "", "0", "true"]) assert.equal(buyerHideDays({ STALE_RULE: v }), 7, String(v));
    assert.equal(buyerHideDays({ STALE_RULE: "1" }), STALE_RULE_HIDE_DAYS);
    assert.equal(STALE_RULE_HIDE_DAYS, 4);
  });
  it("honours STALE_RULE_HIDE_DAYS only inside 2..30, and the RFQ line stays below the hide line", async () => {
    const { buyerHideDays } = await import("./lastConfirmed");
    assert.equal(buyerHideDays({ STALE_RULE: "1", STALE_RULE_HIDE_DAYS: "5" }), 5);
    for (const bad of ["1", "31", "x", "4.5"]) assert.equal(buyerHideDays({ STALE_RULE: "1", STALE_RULE_HIDE_DAYS: bad }), 4, bad);
    assert.ok(RFQ_MAX_AGE_DAYS < buyerHideDays({ STALE_RULE: "1" }));
  });
  it("with the flag on a car 5 days old is hidden, with it off it is shown", () => {
    assert.equal(isHiddenFromBuyerSearch(daysAgo(5), NOW), false);
    const prev = process.env.STALE_RULE;
    process.env.STALE_RULE = "1";
    try { assert.equal(isHiddenFromBuyerSearch(daysAgo(5), NOW), true); assert.equal(isHiddenFromBuyerSearch(daysAgo(3.5), NOW), false); }
    finally { if (prev === undefined) delete process.env.STALE_RULE; else process.env.STALE_RULE = prev; }
  });
});
