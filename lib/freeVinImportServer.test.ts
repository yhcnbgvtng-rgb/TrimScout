// Live QA 2026-09-16 (seven stress VINs on production): every free import — Toyota, Lexus, Acura and
// the catch-all — came back "Dealer not found" while dealer_inventory had each car at its rooftop.
// Only the sticker routes ran resolveVehicleDealer; buildFreeImport now does it for all of them.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildFreeImport } from "./freeVinImportServer";
import type { InventoryDealerSighting } from "./inventoryVinLookup";

const ADX = "3HDSA2H70TM713712";
const SIGHTING: InventoryDealerSighting = { dealerId: null, dealerName: "Key Acura of Atlantic City", city: "Egg Harbor Township", state: "NJ", lastSeen: "2026-09-16", firstSeen: "2026-09-15", daysOnLot: 1, windowStickerUrl: null };

describe("buildFreeImport — the dealer is settled like every sticker route settles it", () => {
  const realFetch = globalThis.fetch;
  before(() => {
    // NHTSA answers for the Acura; the dealer directory is unreachable (fails soft to empty).
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("vpic.nhtsa.dot.gov")) {
        return new Response(JSON.stringify({ Results: [{ Make: "ACURA", Model: "ADX", ModelYear: "2026", Trim: "A-Spec Advance", ErrorCode: "0", ErrorText: "0 - VIN decoded clean. Check Digit (9th position) is correct" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 503 });
    }) as typeof fetch;
  });
  after(() => { globalThis.fetch = realFetch; });

  it("a bare VIN our crawl has seen imports with that rooftop and its lot age", async () => {
    const r = await buildFreeImport({ vin: ADX, pasteUrl: null, source: {}, makeLabel: "Acura", lookupSighting: async () => SIGHTING });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.vehicle.make, "Acura");
    assert.equal(r.vehicle.model, "ADX");
    assert.equal(r.vehicle.location.dealerName, "Key Acura of Atlantic City");
    assert.equal(r.vehicle.location.state, "NJ");
    assert.equal(r.vehicle.location.dealerSource, "inventory");
    assert.equal(r.vehicle.location.dealerConfirmed, true);
    assert.equal(r.vehicle.daysOnLot, 1);
    assert.equal(r.vehicle.buildConfidence, "dealer_listing_only");
    assert.equal((r.payload.vehicle as { location: { dealerName: string } }).location.dealerName, "Key Acura of Atlantic City", "the payload carries it too");
  });

  it("the link's store still wins over the sighting; with neither, the dealer is blank — never invented", async () => {
    const linked = await buildFreeImport({ vin: ADX, pasteUrl: "https://www.keyacuraofatlanticcity.com/x.htm", source: { dealer: { name: "Key Acura of Atlantic City", city: "Egg Harbor Township", state: "NJ", zip: null, source: "directory_domain" } }, makeLabel: "Acura", lookupSighting: async () => ({ ...SIGHTING, dealerName: "Some Other Acura" }) });
    assert.equal(linked.ok && linked.vehicle.location.dealerSource, "listing_domain");
    assert.equal(linked.ok && linked.vehicle.location.factoryShipTo?.dealerName, "Some Other Acura", "the other rooftop is a note, not the recipient");
    const bare = await buildFreeImport({ vin: ADX, pasteUrl: null, source: {}, makeLabel: "Acura", lookupSighting: async () => null });
    assert.equal(bare.ok && bare.vehicle.location.dealerName, "");
    assert.equal(bare.ok && bare.vehicle.location.dealerSource, "unknown");
  });
});
