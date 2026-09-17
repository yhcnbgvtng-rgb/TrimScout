import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyResolvePath, dealerFromVdp, factoryBuildStateLine, lotAgeHint, resolveLogEntry } from "./resolvePath";
import type { Vehicle } from "./types";

const VIN = "2T36CRAVXTC39J403";
const car = (over: Partial<Vehicle> = {}): Vehicle =>
  ({
    vin: VIN, year: 2026, make: "Toyota", model: "RAV4", trim: "XLE", daysOnLot: 0, dealerPrice: 0, msrp: 0,
    location: { dealerName: "Route 22 Toyota", city: "Hillside", state: "NJ", distanceMiles: 0, dealerConfirmed: true, dealerSource: "listing_domain" },
    ...over,
  }) as unknown as Vehicle;

describe("classifyResolvePath — the QA enum", () => {
  it("url_only: the link carried the VIN and it built as read", () => {
    assert.equal(classifyResolvePath({ paste: "url", vinFromUrl: VIN, vinUsed: VIN, ok: true, factoryBuildUnavailable: false }), "url_only");
    assert.equal(classifyResolvePath({ paste: "url", vinFromUrl: VIN.toLowerCase(), vinUsed: VIN, ok: true, factoryBuildUnavailable: false }), "url_only");
  });
  it("url_plus_vin_confirm: a link, but the buyer typed or corrected the VIN", () => {
    assert.equal(classifyResolvePath({ paste: "url", vinFromUrl: null, vinUsed: VIN, ok: true, factoryBuildUnavailable: false }), "url_plus_vin_confirm");
    assert.equal(classifyResolvePath({ paste: "url", vinFromUrl: "2T36CRAV1TC39J403", vinUsed: VIN, ok: true, factoryBuildUnavailable: false }), "url_plus_vin_confirm");
  });
  it("vin_only, factory_pending, fail", () => {
    assert.equal(classifyResolvePath({ paste: "vin", vinFromUrl: null, vinUsed: VIN, ok: true, factoryBuildUnavailable: false }), "vin_only");
    assert.equal(classifyResolvePath({ paste: "url", vinFromUrl: VIN, vinUsed: VIN, ok: true, factoryBuildUnavailable: true }), "factory_pending");
    assert.equal(classifyResolvePath({ paste: "url", vinFromUrl: VIN, vinUsed: null, ok: false, factoryBuildUnavailable: false }), "fail");
  });
});

describe("dealerFromVdp / resolveLogEntry", () => {
  it("only the listing's own hostname or page counts as the VDP", () => {
    assert.equal(dealerFromVdp(car()), true);
    assert.equal(dealerFromVdp(car({ location: { ...car().location, dealerSource: "listing_page" } })), true);
    assert.equal(dealerFromVdp(car({ location: { ...car().location, dealerSource: "inventory" } })), false);
    assert.equal(dealerFromVdp(car({ location: { ...car().location, dealerSource: "buyer_picked" } })), false);
    assert.equal(dealerFromVdp(null), false);
  });
  it("dealerShown is never empty when dealerFromVdp is true", () => {
    const e = resolveLogEntry(car(), "url_only");
    assert.deepEqual(e, { resolvePath: "url_only", vin: VIN, dealerShown: "Route 22 Toyota", dealerFromVdp: true, dealerSource: "listing_domain" });
    assert.ok(!e.dealerFromVdp || e.dealerShown.length > 0);
  });
});

describe("factoryBuildStateLine — the honest line under a car with no factory build", () => {
  it("says the build isn't published and how long the car has sat, only for dealer-listing-only new cars", () => {
    assert.equal(factoryBuildStateLine(car({ buildConfidence: "verified_factory" })), null);
    assert.equal(factoryBuildStateLine(car({ buildConfidence: "dealer_listing_only", condition: "used" })), null);
    assert.equal(
      factoryBuildStateLine(car({ buildConfidence: "dealer_listing_only" })),
      "Factory build not published yet — details come from the VIN decode; the dealer confirms the build when they quote."
    );
    assert.match(factoryBuildStateLine(car({ buildConfidence: "dealer_listing_only", daysOnLot: 14 }))!, /· on the lot 14 days$/);
    assert.match(factoryBuildStateLine(car({ buildConfidence: "dealer_listing_only", daysOnLot: 1 }))!, /on the lot 1 day$/);
    assert.match(factoryBuildStateLine(car({ buildConfidence: "dealer_listing_only", daysOnLot: 0, lotFirstSeen: "2026-09-15" }))!, /on the lot since 2026-09-15$/);
  });
  it("an OEM's own pending note or a sticker-service outage leads instead of the generic line", () => {
    assert.match(factoryBuildStateLine(car({ buildConfidence: "dealer_listing_only", stickerPendingNote: "Hyundai posts labels a few days after listing." }))!, /^Hyundai posts labels/);
    assert.match(factoryBuildStateLine(car({ buildConfidence: "dealer_listing_only", stickerUnavailableReason: "GM's sticker service didn't answer.", daysOnLot: 3 }))!, /^GM's sticker service didn't answer\. · on the lot 3 days$/);
  });
  it("lotAgeHint alone", () => {
    assert.equal(lotAgeHint({ daysOnLot: 0 }), null);
    assert.equal(lotAgeHint({ daysOnLot: 5 }), "on the lot 5 days");
  });
});
