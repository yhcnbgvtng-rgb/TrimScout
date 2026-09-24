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
const SIGHTING: InventoryDealerSighting = { dealerId: null, dealerName: "Lexus of Route 10", city: "Whippany", state: "NJ", lastSeen: "2026-09-16", firstSeen: "2026-09-10", daysOnLot: 6, windowStickerUrl: null };
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
    assert.deepEqual(s, { dealerId: "9999", dealerName: "Lexus of Elsewhere", city: "Whippany", state: "NJ", lastSeen: "2026-09-16", firstSeen: null, daysOnLot: null, windowStickerUrl: null });
    // Lot age: the feed's own figure first, else counted from the crawl's first sighting.
    assert.equal(sightingFromListings([listing({ daysOnLot: 12, crawlFirstSeen: "2026-09-01T00:00:00.000Z" })])?.daysOnLot, 12);
    const counted = sightingFromListings([listing({ daysOnLot: 0, crawlFirstSeen: "2026-09-10T00:00:00.000Z" })]);
    assert.equal(counted?.daysOnLot, 6);
    assert.equal(counted?.firstSeen, "2026-09-10");
    assert.equal(sightingFromListings([listing({ dealerId: "0" })])?.dealerId, null);
    assert.equal(sightingFromListings([]), null);
  });

  it("carries the crawl's captured window-sticker link through — the real, dealer-specific URL, not a VIN-only guess", () => {
    const withSticker = sightingFromListings([listing({ windowStickerUrl: "https://www.windowsticker.forddirect.com/windowsticker.pdf?vin=2T2HGCEZ9TC38B302&dealerId=12345" })]);
    assert.equal(withSticker?.windowStickerUrl, "https://www.windowsticker.forddirect.com/windowsticker.pdf?vin=2T2HGCEZ9TC38B302&dealerId=12345");
    assert.equal(sightingFromListings([listing({})])?.windowStickerUrl, null, "no captured link is null, not undefined");
  });
});

describe("resolveVehicleDealer — dealer-attach priority locked 2026-09-20: VDP domain first, sticker/inventory only to narrow an ambiguous or absent domain match, never to override a unique one", () => {
  it("1. ACCEPTANCE — unique VDP domain wins over the sticker's sold-to dealer; the ship-to store is kept as a note, never the recipient", async () => {
    const v = await resolveVehicleDealer(vehicle(UNSEEN), { dealer: LINK }, { name: "Route 23 Auto Mall", city: "Butler", state: "NJ", zip: "07405" }, lookup);
    assert.equal(v.location.dealerSource, "listing_domain");
    assert.equal(v.location.dealerName, "Paul Miller BMW");
    assert.equal(v.location.dealerConfirmed, true);
    assert.equal(v.location.factoryShipTo?.dealerName, "Route 23 Auto Mall");
    assert.equal(v.location.factoryShipTo?.state, "NJ");
  });

  it("1b. ACCEPTANCE — a unique VDP domain wins over an inventory sighting too", async () => {
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

  it("1d. a shared multi-rooftop domain (huntauto.com: Hunt Ford + Hunt Chrysler) never reaches the domain branch — the caller passes no `listing` for an ambiguous match, so a published sticker resolves it instead, dealerSource=window_sticker", async () => {
    // The ambiguity itself is resolved upstream (lib/deskResolve.ts's "ambiguous"
    // status): this function only ever sees resolved.dealer when a match was
    // unique. Simulating the ambiguous case is simply omitting `dealer`.
    const v = await resolveVehicleDealer(vehicle(UNSEEN), {}, { name: "Hunt Ford Inc", city: "Franklin", state: "KY" }, lookup);
    assert.equal(v.location.dealerSource, "window_sticker");
    assert.equal(v.location.dealerName, "Hunt Ford Inc");
    assert.equal(v.location.dealerConfirmed, false);
  });

  it("2. ACCEPTANCE — no domain match: the sticker's sold-to dealer now wins over an inventory sighting (locked priority reversal, 2026-09-20)", async () => {
    const v = await resolveVehicleDealer(vehicle(SEEN), {}, { name: "SOME OTHER FORD", state: "TX" }, lookup);
    assert.equal(v.location.dealerSource, "window_sticker");
    assert.equal(v.location.dealerName, "SOME OTHER FORD");
    assert.equal(v.location.dealerConfirmed, false);
  });

  it("2b. the QA paste: a Lexus group-site link the directory can't key, no factory sold-to — the crawl's sighting names the store", async () => {
    const v = await resolveVehicleDealer(vehicle(SEEN), {}, undefined, lookup);
    assert.equal(v.location.dealerSource, "inventory");
    assert.equal(v.location.dealerName, "Lexus of Route 10");
    assert.equal(v.location.dealerConfirmed, true);
    assert.equal(v.daysOnLot, 6, "lot age rides along from the crawl");
    assert.equal(v.lotFirstSeen, "2026-09-10");
  });

  it("2d. lot age from the crawl is counted from first-seen when the feed had no figure, and never overrides a sticker's own", async () => {
    const counted = await resolveVehicleDealer(vehicle(SEEN), {}, undefined, async () => ({ ...SIGHTING, daysOnLot: 0 }));
    assert.equal(counted.daysOnLot, 0);
    const own = await resolveVehicleDealer({ ...vehicle(SEEN), daysOnLot: 40 }, {}, undefined, lookup);
    assert.equal(own.daysOnLot, 40);
  });

  it("2c. a backend hiccup reads as never seen, never as a crash", async () => {
    const v = await resolveVehicleDealer(vehicle(SEEN), {}, undefined, async () => null);
    assert.equal(v.location.dealerSource, "unknown");
  });

  it("3. ACCEPTANCE — sticker-only after a pending build publishes: no domain, no sighting, the sticker's sold-to dealer fills in — unconfirmed", async () => {
    const v = await resolveVehicleDealer(vehicle(UNSEEN), {}, { name: "Route 23 Auto Mall", city: "Butler", state: "NJ", zip: "07405" }, lookup);
    assert.equal(v.location.dealerSource, "window_sticker");
    assert.equal(v.location.dealerName, "Route 23 Auto Mall");
    assert.equal(v.location.dealerConfirmed, false, "a ship-to store may not be where the car sits now");
  });

  it("4. ACCEPTANCE — ambiguous/absent domain and no sticker: the dealer is blank (no false single match) — the mapper's placeholder never ships", async () => {
    const v = await resolveVehicleDealer(vehicle(UNSEEN), {}, undefined, lookup);
    assert.equal(v.location.dealerName, "");
    assert.equal(v.location.dealerSource, "unknown");
  });
});
