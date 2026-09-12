import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveVehicleDealer } from "./pasteResolutionServer";
import { inventoryDealerForVin, inventoryIndexSize } from "./inventoryVinLookup";
import type { Vehicle } from "./types";
import index from "../data/inventory-vin-dealers.json";

const vehicle = (vin: string): Vehicle =>
  ({
    vin,
    year: 2026,
    make: "Ford",
    model: "F-150",
    trim: "XLT",
    dealerPrice: 0,
    msrp: 0,
    location: { dealerName: "Ford dealer", city: "", state: "", distanceMiles: 0, dealerConfirmed: false },
  }) as unknown as Vehicle;

// A VIN our own crawl has seen, and one it never has.
const SEEN = Object.keys((index as { vins: Record<string, unknown> }).vins).find((v) => v.startsWith("1F"))!;
const UNSEEN = "1FTFW1E80PFA00001";
const LINK = { name: "Paul Miller BMW", city: "Wayne", state: "NJ", zip: null, source: "directory_domain" as const };

describe("inventoryDealerForVin", () => {
  it("reads the derived index, not the 84 MB snapshot", () => {
    assert.ok(inventoryIndexSize() > 20000);
    const hit = inventoryDealerForVin(SEEN.toLowerCase());
    assert.ok(hit?.dealerName);
    assert.equal(inventoryDealerForVin(UNSEEN), null);
  });
});

describe("resolveVehicleDealer — VIN first, link only as a fallback, never invented", () => {
  it("1. an inventory sighting of the VIN wins over the sticker and the link", async () => {
    const v = await resolveVehicleDealer(vehicle(SEEN), { dealer: LINK }, { name: "SOME OTHER FORD", state: "TX" });
    assert.equal(v.location.dealerSource, "inventory");
    assert.ok(v.location.dealerName, "the sighting's rooftop (or its directory spelling) is named");
    assert.equal(v.location.dealerConfirmed, true);
    assert.notEqual(v.location.dealerName, "Paul Miller BMW");
    assert.notEqual(v.location.dealerName, "SOME OTHER FORD");
  });

  it("2. the sticker's sold-to dealer wins over the link", async () => {
    const v = await resolveVehicleDealer(vehicle(UNSEEN), { dealer: LINK }, { name: "Route 23 Auto Mall", city: "Butler", state: "NJ", zip: "07405" });
    assert.equal(v.location.dealerSource, "window_sticker");
    assert.equal(v.location.dealerName, "Route 23 Auto Mall");
    assert.equal(v.location.dealerConfirmed, false, "a ship-to store may not be where the car sits now");
  });

  it("3. only with nothing from the VIN does the link's store fill in", async () => {
    const v = await resolveVehicleDealer(vehicle(UNSEEN), { dealer: LINK }, undefined);
    assert.equal(v.location.dealerSource, "listing_domain");
    assert.equal(v.location.dealerName, "Paul Miller BMW");
  });

  it("4. with nothing anywhere, the dealer is blank — the mapper's placeholder never ships", async () => {
    const v = await resolveVehicleDealer(vehicle(UNSEEN), {}, undefined);
    assert.equal(v.location.dealerName, "");
    assert.equal(v.location.dealerSource, "unknown");
  });
});
