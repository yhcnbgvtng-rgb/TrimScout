import "./testdata/blockLiveHttp";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { searchDealerListedOptions, listVehiclesWithDealerOption, UNCODED_FEATURE_PLACEHOLDER } from "./dealerOptionSearch";
import type { BoxFacetsResponse, BoxVehiclesResponse } from "./lightsailClient";

function fakeFacets(rows: Array<{ value: string; label?: string; count: number }>) {
  return async (): Promise<BoxFacetsResponse | null> => ({ facets: { optionCode: rows } });
}

describe("searchDealerListedOptions", () => {
  it("matches by a case/punctuation-insensitive substring of the facet's option name", async () => {
    const fetchFacets = fakeFacets([
      { value: "PKG-1", label: "M Sport Package", count: 42 },
      { value: "OPT-2", label: "Harman Kardon Audio", count: 10 },
    ]);
    const results = await searchDealerListedOptions("sport", "bmw", { fetchFacets });
    assert.equal(results?.length, 1);
    assert.deepEqual(results?.[0], { code: "PKG-1", name: "M Sport Package", count: 42, brand: "bmw" });
  });

  it("never returns the uncoded DealerOn placeholder bucket, even if its query somehow matched a stray label", async () => {
    const fetchFacets = fakeFacets([{ value: UNCODED_FEATURE_PLACEHOLDER, label: "Feature", count: 999 }]);
    const results = await searchDealerListedOptions("feature", "bmw", { fetchFacets });
    assert.deepEqual(results, []);
  });

  it("a facet row with no label (never seen live, but the type allows it) is skipped rather than crashing", async () => {
    const fetchFacets = fakeFacets([{ value: "OPT-3", count: 5 }]);
    const results = await searchDealerListedOptions("anything", "bmw", { fetchFacets });
    assert.deepEqual(results, []);
  });

  it("an empty query returns an empty array without calling the box at all", async () => {
    let called = false;
    const fetchFacets = async (): Promise<BoxFacetsResponse | null> => {
      called = true;
      return { facets: {} };
    };
    const results = await searchDealerListedOptions("   ", "bmw", { fetchFacets });
    assert.deepEqual(results, []);
    assert.equal(called, false);
  });

  it("returns null (not an empty array) when the box itself is unreachable, so callers never confuse the two", async () => {
    const fetchFacets = async (): Promise<BoxFacetsResponse | null> => null;
    const results = await searchDealerListedOptions("sport", "bmw", { fetchFacets });
    assert.equal(results, null);
  });
});

describe("listVehiclesWithDealerOption", () => {
  it("passes the brand and code through to fetchVehiclesFromBox as an optionCode filter", async () => {
    let capturedParams: unknown;
    const fetchVehicles = async (params: unknown): Promise<BoxVehiclesResponse | null> => {
      capturedParams = params;
      return {
        vehicles: [{ id: 1, vin: "WBA33AY09RF611293" } as never],
        pagination: { page: 1, pageSize: 50, totalCount: 1, totalPages: 1 },
        stats: { totalActive: 1, priceDrops: 0, newArrivals: 0, staleCount: 0, avgDaysOnLot: 0, dealershipsCount: 1 },
      };
    };
    const vehicles = await listVehiclesWithDealerOption("bmw", "PKG-1", {}, { fetchVehicles });
    assert.deepEqual(capturedParams, { brand: "bmw", optionCode: "PKG-1", pageSize: 50 });
    assert.equal(vehicles?.length, 1);
    assert.equal(vehicles?.[0].vin, "WBA33AY09RF611293");
  });

  it("returns null when the box is unreachable", async () => {
    const fetchVehicles = async (): Promise<BoxVehiclesResponse | null> => null;
    const vehicles = await listVehiclesWithDealerOption("bmw", "PKG-1", {}, { fetchVehicles });
    assert.equal(vehicles, null);
  });
});
