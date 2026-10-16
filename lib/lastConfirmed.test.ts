import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lastSeenLabel, isHiddenFromBuyerSearch, STALE_HIDE_DAYS, LAST_SEEN_LABEL_AFTER_DAYS } from "./lastConfirmed";
import { toBuyerVehicle } from "./buyerSearch";
import type { InventoryVehicle } from "./inventoryApi";

const NOW = Date.parse("2026-10-10T15:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86400_000).toISOString();

describe("age bands", () => {
  it("the thresholds are 3 and 7 days", () => {
    assert.equal(LAST_SEEN_LABEL_AFTER_DAYS, 3);
    assert.equal(STALE_HIDE_DAYS, 7);
  });
  it("under 3 days: no label, shown", () => {
    for (const d of [0, 1, 2.99]) {
      assert.equal(lastSeenLabel(daysAgo(d), NOW), null, String(d));
      assert.equal(isHiddenFromBuyerSearch(daysAgo(d), NOW), false);
    }
  });
  it("3 to 7 days: a Last seen label, shown", () => {
    assert.equal(lastSeenLabel(daysAgo(3), NOW), "Last seen Oct 7");
    assert.equal(lastSeenLabel(daysAgo(5), NOW), "Last seen Oct 5");
    assert.equal(lastSeenLabel(daysAgo(7), NOW), "Last seen Oct 3");
    for (const d of [3, 5, 7]) assert.equal(isHiddenFromBuyerSearch(daysAgo(d), NOW), false, String(d));
  });
  it("over 7 days: hidden from buyer search, and the label is still there for admin / direct-page views", () => {
    assert.equal(isHiddenFromBuyerSearch(daysAgo(7.001), NOW), true);
    assert.equal(isHiddenFromBuyerSearch(daysAgo(30), NOW), true);
    assert.equal(lastSeenLabel(daysAgo(10), NOW), "Last seen Sep 30");
  });
});

describe("label date", () => {
  it("is the calendar date in US Eastern, not UTC", () => {
    // 2026-10-07 02:30 UTC is still Oct 6 at 10:30 pm EDT
    assert.equal(lastSeenLabel("2026-10-07T02:30:00Z", NOW), "Last seen Oct 6");
    // 2026-12-01 03:30 UTC is Nov 30 in EST
    assert.equal(lastSeenLabel("2026-12-01T03:30:00Z", Date.parse("2026-12-10T15:00:00Z")), "Last seen Nov 30");
  });
  it("adds the year when it is not the current one (ET)", () => {
    assert.equal(lastSeenLabel("2025-12-30T10:00:00Z", NOW), "Last seen Dec 30, 2025");
  });
  it("a missing or unparseable date shows no label and is never hidden", () => {
    for (const bad of [null, undefined, "", "not a date"]) {
      assert.equal(lastSeenLabel(bad, NOW), null);
      assert.equal(isHiddenFromBuyerSearch(bad, NOW), false);
    }
  });
});

describe("toBuyerVehicle", () => {
  it("exposes the car's last_seen_at as lastConfirmedAt", () => {
    const v = { vin: "1", dealerName: "X", lastSeenAt: "2026-10-07T07:08:01.000Z", sourceBox: "box1", crawlFirstSeen: null } as unknown as InventoryVehicle;
    const b = toBuyerVehicle(v, null, null);
    assert.equal(b.lastConfirmedAt, "2026-10-07T07:08:01.000Z");
    assert.equal("sourceBox" in b, false);
  });
});

describe("buyerHideDays — the staleness rule flag", () => {
  it("is the shipped 7 days unless STALE_RULE is exactly 1", async () => {
    const { buyerHideDays, STALE_RULE_HIDE_DAYS } = await import("./lastConfirmed");
    for (const v of [undefined, "", "0", "true"]) assert.equal(buyerHideDays({ STALE_RULE: v }), 7, String(v));
    assert.equal(buyerHideDays({ STALE_RULE: "1" }), STALE_RULE_HIDE_DAYS);
    assert.equal(STALE_RULE_HIDE_DAYS, 4);
  });
  it("honours STALE_RULE_HIDE_DAYS only inside 2..30, and the label line stays below the hide line", async () => {
    const { buyerHideDays } = await import("./lastConfirmed");
    assert.equal(buyerHideDays({ STALE_RULE: "1", STALE_RULE_HIDE_DAYS: "5" }), 5);
    for (const bad of ["1", "31", "x", "4.5"]) assert.equal(buyerHideDays({ STALE_RULE: "1", STALE_RULE_HIDE_DAYS: bad }), 4, bad);
    assert.ok(LAST_SEEN_LABEL_AFTER_DAYS < buyerHideDays({ STALE_RULE: "1" }));
  });
  it("with the flag on a car 5 days old is hidden, with it off it is shown", () => {
    assert.equal(isHiddenFromBuyerSearch(daysAgo(5), NOW), false);
    const prev = process.env.STALE_RULE;
    process.env.STALE_RULE = "1";
    try { assert.equal(isHiddenFromBuyerSearch(daysAgo(5), NOW), true); assert.equal(isHiddenFromBuyerSearch(daysAgo(3.5), NOW), false); }
    finally { if (prev === undefined) delete process.env.STALE_RULE; else process.env.STALE_RULE = prev; }
  });
});
