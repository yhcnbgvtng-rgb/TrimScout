import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveVehicleDealer } from "./pasteResolutionServer";
import { sightingFromListings, type InventoryDealerSighting } from "./inventoryVinLookup";
import type { InventoryVehicle } from "./inventoryApi";
import type { Vehicle } from "./types";

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

// A VIN our own crawl has seen (the live dealer_inventory table, stubbed here), and one it never has.
const SEEN = "2T2HGCEZ9TC38B302";
const UNSEEN = "1FTFW1E80PFA00001";
const SIGHTING: InventoryDealerSighting = { dealerId: null, dealerName: "Lexus of Route 10", city: "Whippany", state: "NJ", lastSeen: "2026-09-16" };
const lookup = async (vin: string) => (vin === SEEN ? SIGHTING : null);
const LINK = { name: "Paul Miller BMW", city: "Wayne", state: "NJ", zip: null, source: "directory_domain" as const };

const listing = (over: Partial<InventoryVehicle>): InventoryVehicle =>
  ({ vin: SEEN, dealerId: "7486", dealerName: "Lexus of Route 10", dealerCity: "Whippany", dealerState: "NJ", lastSeenAt: "2026-09-16T22:43:50.000Z", removedAt: null, ...over }) as InventoryVehicle;

describe("sightingFromListings — the rooftop our crawl last saw the VIN at", () => {
  it("prefers the listing still in stock, then the most recently seen; store 0 carries no directory id", () => {
    const s = sightingFromListings([
      listing({ dealerId: "0", dealerName: "Some Group Site", lastSeenAt: "2026-09-16T23:00:00.000Z", removedAt: "2026-09-16T23:30:00.000Z" }),
      listing({ dealerId: "7486", lastSeenAt: "2026-09-15T22:00:00.000Z" }),
      listing({ dealerId: "9999", dealerName: "Lexus of Elsewhere", lastSeenAt: "2026-09-16T22:00:00.000Z" }),
    ]);
    assert.deepEqual(s, { dealerId: "9999", dealerName: "Lexus of Elsewhere", city: "Whippany", state: "NJ", lastSeen: "2026-09-16" });
    assert.equal(sightingFromListings([listing({ dealerId: "0" })])?.dealerId, null);
    assert.equal(sightingFromListings([]), null);
  });
});

describe("resolveVehicleDealer — the store advertising the car first, the VIN only as a fallback, never invented", () => {
  it("1. the link's store wins over the sticker's sold-to dealer; the ship-to store is kept as a note", async () => {
    const v = await resolveVehicleDealer(vehicle(UNSEEN), { dealer: LINK }, { name: "Route 23 Auto Mall", city: "Butler", state: "NJ", zip: "07405" }, lookup);
    assert.equal(v.location.dealerSource, "listing_domain");
    assert.equal(v.location.dealerName, "Paul Miller BMW");
    assert.equal(v.location.dealerConfirmed, true);
    assert.equal(v.location.factoryShipTo?.dealerName, "Route 23 Auto Mall");
    assert.equal(v.location.factoryShipTo?.state, "NJ");
  });

  it("1b. the link's store wins over an inventory sighting too", async () => {
    const v = await resolveVehicleDealer(vehicle(SEEN), { dealer: LINK }, { name: "SOME OTHER FORD", state: "TX" }, lookup);
    assert.equal(v.location.dealerSource, "listing_domain");
    assert.equal(v.location.dealerName, "Paul Miller BMW");
    assert.ok(v.location.factoryShipTo?.dealerName, "the sighting's rooftop is the note");
  });

  it("1c. same store on both sides → no note", async () => {
    const v = await resolveVehicleDealer(vehicle(UNSEEN), { dealer: LINK }, { name: "Paul Miller BMW Inc", city: "Wayne", state: "NJ" }, lookup);
    assert.equal(v.location.dealerName, "Paul Miller BMW");
    assert.equal(v.location.factoryShipTo, null);
  });

  it("2. without a link store, an inventory sighting of the VIN wins over the sticker", async () => {
    const v = await resolveVehicleDealer(vehicle(SEEN), {}, { name: "SOME OTHER FORD", state: "TX" }, lookup);
    assert.equal(v.location.dealerSource, "inventory");
    assert.ok(v.location.dealerName, "the sighting's rooftop (or its directory spelling) is named");
    assert.equal(v.location.dealerConfirmed, true);
    assert.notEqual(v.location.dealerName, "SOME OTHER FORD");
  });

  it("2b. the QA paste: a Lexus group-site link the directory can't key, no factory sold-to — the crawl's sighting names the store", async () => {
    const v = await resolveVehicleDealer(vehicle(SEEN), {}, undefined, lookup);
    assert.equal(v.location.dealerSource, "inventory");
    assert.equal(v.location.dealerName, "Lexus of Route 10");
    assert.equal(v.location.dealerConfirmed, true);
  });

  it("2c. a backend hiccup reads as never seen, never as a crash", async () => {
    const v = await resolveVehicleDealer(vehicle(SEEN), {}, undefined, async () => null);
    assert.equal(v.location.dealerSource, "unknown");
  });

  it("3. without a link store or a sighting, the sticker's sold-to dealer fills in — unconfirmed", async () => {
    const v = await resolveVehicleDealer(vehicle(UNSEEN), {}, { name: "Route 23 Auto Mall", city: "Butler", state: "NJ", zip: "07405" }, lookup);
    assert.equal(v.location.dealerSource, "window_sticker");
    assert.equal(v.location.dealerName, "Route 23 Auto Mall");
    assert.equal(v.location.dealerConfirmed, false, "a ship-to store may not be where the car sits now");
  });

  it("4. with nothing anywhere, the dealer is blank — the mapper's placeholder never ships", async () => {
    const v = await resolveVehicleDealer(vehicle(UNSEEN), {}, undefined, lookup);
    assert.equal(v.location.dealerName, "");
    assert.equal(v.location.dealerSource, "unknown");
  });
});
