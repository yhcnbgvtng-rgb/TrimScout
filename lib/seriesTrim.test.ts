// RFQ "Vehicles in this request" card showed "2026 Toyota RAV4 64 Series": vPIC leaves Trim blank on these
// RAV4s and returns Series "64 Series" (a platform code), which vinDecoder used as a trim fallback.
import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { trustedTrim } from "./trustedTrim";
import { formatReviewVehicleTitle } from "./fordCompetitionUi";
import { buildFreeImport } from "./freeVinImportServer";
import type { InventoryDealerSighting } from "./inventoryVinLookup";

const VINS = ["4T36CRAV3TU015835", "4T36CRAV2TU014286"];
const sighting = (trim: string): InventoryDealerSighting => ({ dealerId: null, dealerName: "355 Toyota", city: "Rockville", state: "MD", lastSeen: "2026-10-10", firstSeen: "2026-10-01", daysOnLot: 9, windowStickerUrl: null, trim });

describe("trustedTrim", () => {
  it("drops platform codes, keeps real trims", () => {
    for (const bad of ["64 Series", "64  series", "Series 64", "Wagon Body Style", "", "  ", null, undefined]) assert.equal(trustedTrim(bad), "", String(bad));
    for (const ok of ["XLE Premium", "SR5", "430i", "M340i", "TRD Off-Road", "A-Spec Advance"]) assert.equal(trustedTrim(ok), ok);
  });
});

describe("RFQ vehicle title", () => {
  for (const vin of VINS) {
    it(`${vin}: a stored "64 Series" trim shows no suffix`, () => {
      assert.equal(formatReviewVehicleTitle({ year: 2026, make: "Toyota", model: "RAV4", trim: "64 Series", vin }), "2026 Toyota RAV4");
    });
  }
  it("a real trim still shows", () => {
    assert.equal(formatReviewVehicleTitle({ year: 2026, make: "Toyota", model: "RAV4", trim: "XLE Premium" }), "2026 Toyota RAV4 XLE Premium");
  });
});

describe("free import of the two RAV4 VINs (vPIC: Trim blank, Series '64 Series')", () => {
  const realFetch = globalThis.fetch;
  before(() => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("vpic.nhtsa.dot.gov")) {
        return new Response(JSON.stringify({ Results: [{ Make: "TOYOTA", Model: "RAV4", ModelYear: "2026", Trim: "", Series: "64 Series", Series2: "Wagon Body Style", ErrorCode: "0", ErrorText: "0 - VIN decoded clean. Check Digit (9th position) is correct" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 503 });
    }) as typeof fetch;
  });
  after(() => { globalThis.fetch = realFetch; });

  for (const vin of VINS) {
    it(`${vin}: no trusted trim → plain "2026 Toyota RAV4"`, async () => {
      const r = await buildFreeImport({ vin, pasteUrl: null, source: {}, makeLabel: "Toyota", lookupSighting: async () => null });
      assert.equal(r.ok, true);
      if (!r.ok) return;
      assert.equal(r.vehicle.trim, "");
      assert.equal(formatReviewVehicleTitle(r.vehicle), "2026 Toyota RAV4");
    });
    it(`${vin}: dealer listing trim from our crawl is used`, async () => {
      const r = await buildFreeImport({ vin, pasteUrl: null, source: {}, makeLabel: "Toyota", lookupSighting: async () => sighting("XLE Premium") });
      assert.equal(r.ok, true);
      if (!r.ok) return;
      assert.equal(formatReviewVehicleTitle(r.vehicle), "2026 Toyota RAV4 XLE Premium");
    });
    it(`${vin}: a junk listing trim never wins`, async () => {
      const r = await buildFreeImport({ vin, pasteUrl: null, source: {}, makeLabel: "Toyota", lookupSighting: async () => sighting("") });
      assert.equal(r.ok && formatReviewVehicleTitle(r.vehicle), "2026 Toyota RAV4");
    });
  }
});
