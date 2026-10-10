import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lastConfirmedLabel, LAST_CONFIRMED_AFTER_HOURS } from "./lastConfirmed";
import { toBuyerVehicle } from "./buyerSearch";
import type { InventoryVehicle } from "./inventoryApi";

const NOW = Date.parse("2026-10-10T15:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe("lastConfirmedLabel", () => {
  it("says nothing for a car confirmed within the last 48 hours", () => {
    assert.equal(lastConfirmedLabel(hoursAgo(0), NOW), null);
    assert.equal(lastConfirmedLabel(hoursAgo(47.9), NOW), null);
  });
  it("labels a car last seen 48 hours or more ago with the date", () => {
    assert.equal(LAST_CONFIRMED_AFTER_HOURS, 48);
    assert.equal(lastConfirmedLabel(hoursAgo(48), NOW), "Last confirmed Oct 8");
    assert.equal(lastConfirmedLabel("2026-10-07T07:08:01.000Z", NOW), "Last confirmed Oct 7");
  });
  it("adds the year when it is not the current one", () => {
    assert.equal(lastConfirmedLabel("2025-12-30T10:00:00Z", NOW), "Last confirmed Dec 30, 2025");
  });
  it("ignores a missing or unparseable date", () => {
    assert.equal(lastConfirmedLabel(null, NOW), null);
    assert.equal(lastConfirmedLabel(undefined, NOW), null);
    assert.equal(lastConfirmedLabel("not a date", NOW), null);
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
