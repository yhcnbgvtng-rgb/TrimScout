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

describe("resolveVehicleDealer — the store advertising the car first, the VIN only as a fallback, never invented", () => {
  it("1. the link's store wins over the sticker's sold-to dealer; the ship-to store is kept as a note", async () => {
    const v = await resolveVehicleDealer(vehicle(UNSEEN), { dealer: LINK }, { name: "Route 23 Auto Mall", city: "Butler", state: "NJ", zip: "07405" });
    assert.equal(v.location.dealerSource, "listing_domain");
    assert.equal(v.location.dealerName, "Paul Miller BMW");
    assert.equal(v.location.dealerConfirmed, true);
    assert.equal(v.location.factoryShipTo?.dealerName, "Route 23 Auto Mall");
    assert.equal(v.location.factoryShipTo?.state, "NJ");
  });

  it("1b. the link's store wins over an inventory sighting too", async () => {
    const v = await resolveVehicleDealer(vehicle(SEEN), { dealer: LINK }, { name: "SOME OTHER FORD", state: "TX" });
    assert.equal(v.location.dealerSource, "listing_domain");
    assert.equal(v.location.dealerName, "Paul Miller BMW");
    assert.ok(v.location.factoryShipTo?.dealerName, "the sighting's rooftop is the note");
  });

  it("1c. same store on both sides → no note", async () => {
    const v = await resolveVehicleDealer(vehicle(UNSEEN), { dealer: LINK }, { name: "Paul Miller BMW Inc", city: "Wayne", state: "NJ" });
    assert.equal(v.location.dealerName, "Paul Miller BMW");
    assert.equal(v.location.factoryShipTo, null);
  });

  it("2. without a link store, an inventory sighting of the VIN wins over the sticker", async () => {
    const v = await resolveVehicleDealer(vehicle(SEEN), {}, { name: "SOME OTHER FORD", state: "TX" });
    assert.equal(v.location.dealerSource, "inventory");
    assert.ok(v.location.dealerName, "the sighting's rooftop (or its directory spelling) is named");
    assert.equal(v.location.dealerConfirmed, true);
    assert.notEqual(v.location.dealerName, "SOME OTHER FORD");
  });

  it("3. without a link store or a sighting, the sticker's sold-to dealer fills in — unconfirmed", async () => {
    const v = await resolveVehicleDealer(vehicle(UNSEEN), {}, { name: "Route 23 Auto Mall", city: "Butler", state: "NJ", zip: "07405" });
    assert.equal(v.location.dealerSource, "window_sticker");
    assert.equal(v.location.dealerName, "Route 23 Auto Mall");
    assert.equal(v.location.dealerConfirmed, false, "a ship-to store may not be where the car sits now");
  });

  it("4. with nothing anywhere, the dealer is blank — the mapper's placeholder never ships", async () => {
    const v = await resolveVehicleDealer(vehicle(UNSEEN), {}, undefined);
    assert.equal(v.location.dealerName, "");
    assert.equal(v.location.dealerSource, "unknown");
  });
});
