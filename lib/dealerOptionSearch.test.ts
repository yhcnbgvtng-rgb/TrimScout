import "./testdata/blockLiveHttp";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  searchDealerListedOptions,
  listVehiclesWithDealerOption,
  searchDealerFeatureText,
  listVehiclesWithDealerFeature,
  UNCODED_FEATURE_PLACEHOLDER,
} from "./dealerOptionSearch";
import { InventoryApiError, type InventoryOptionFacetValue, type InventoryVehicle } from "./inventoryApi";

function fakeFacet(type: "coded" | "feature", rows: InventoryOptionFacetValue[]) {
  return async (make: string, t: "coded" | "feature" = "coded") => {
    assert.equal(t, type);
    return { make, type: t, facet: rows };
  };
}

const unreachable = async () => {
  throw new InventoryApiError("Could not reach inventory service", 503);
};

describe("searchDealerListedOptions", () => {
  it("matches by a case/punctuation-insensitive substring of the coded facet's label", async () => {
    const fetchFacet = fakeFacet("coded", [
      { value: "PKG-1", label: "M Sport Package", count: 42 },
      { value: "OPT-2", label: "Harman Kardon Audio", count: 10 },
    ]);
    const results = await searchDealerListedOptions("sport", "bmw", { fetchFacet });
    assert.equal(results?.length, 1);
    assert.deepEqual(results?.[0], { code: "PKG-1", name: "M Sport Package", count: 42, make: "bmw" });
  });

  it("a facet row with no label (name never made it into dealer_option_names) is skipped rather than crashing", async () => {
    const fetchFacet = fakeFacet("coded", [{ value: "OPT-3", label: null, count: 5 }]);
    const results = await searchDealerListedOptions("anything", "bmw", { fetchFacet });
    assert.deepEqual(results, []);
  });

  it("an empty query returns an empty array without calling the box at all", async () => {
    let called = false;
    const fetchFacet = async () => {
      called = true;
      return { make: "bmw", type: "coded", facet: [] };
    };
    const results = await searchDealerListedOptions("   ", "bmw", { fetchFacet });
    assert.deepEqual(results, []);
    assert.equal(called, false);
  });

  it("returns null (not an empty array) when the box itself is unreachable, so callers never confuse the two", async () => {
    const results = await searchDealerListedOptions("sport", "bmw", { fetchFacet: unreachable });
    assert.equal(results, null);
  });
});

describe("listVehiclesWithDealerOption", () => {
  it("passes the make and code through to listInventory as an optionCode filter", async () => {
    let capturedParams: unknown;
    const fetchVehicles = async (params: unknown) => {
      capturedParams = params;
      return { total: 1, limit: 50, offset: 0, vehicles: [{ vin: "WBA33AY09RF611293" } as InventoryVehicle] };
    };
    const vehicles = await listVehiclesWithDealerOption("bmw", "PKG-1", {}, { fetchVehicles });
    assert.deepEqual(capturedParams, { make: "bmw", optionCode: "PKG-1", inStock: true, limit: 50 });
    assert.equal(vehicles?.length, 1);
    assert.equal(vehicles?.[0].vin, "WBA33AY09RF611293");
  });

  it("returns null when the box is unreachable", async () => {
    const vehicles = await listVehiclesWithDealerOption("bmw", "PKG-1", {}, { fetchVehicles: unreachable });
    assert.equal(vehicles, null);
  });
});

describe("searchDealerFeatureText", () => {
  it("matches by a case/punctuation-insensitive substring of the feature facet's name", async () => {
    const fetchFacet = fakeFacet("feature", [
      { value: "Panoramic Sunroof", label: "Panoramic Sunroof", count: 37 },
      { value: "Heated Seats", label: "Heated Seats", count: 12 },
    ]);
    const results = await searchDealerFeatureText("sunroof", "bmw", { fetchFacet });
    assert.equal(results?.length, 1);
    assert.deepEqual(results?.[0], { name: "Panoramic Sunroof", count: 37, make: "bmw" });
  });

  it("a facet row with no label is skipped rather than crashing", async () => {
    const fetchFacet = fakeFacet("feature", [{ value: "Heated Seats", label: null, count: 5 }]);
    const results = await searchDealerFeatureText("anything", "bmw", { fetchFacet });
    assert.deepEqual(results, []);
  });

  it("an empty query returns an empty array without calling the box at all", async () => {
    let called = false;
    const fetchFacet = async () => {
      called = true;
      return { make: "bmw", type: "feature", facet: [] };
    };
    const results = await searchDealerFeatureText("   ", "bmw", { fetchFacet });
    assert.deepEqual(results, []);
    assert.equal(called, false);
  });

  it("returns null (not an empty array) when the box itself is unreachable, so callers never confuse the two", async () => {
    const results = await searchDealerFeatureText("sunroof", "bmw", { fetchFacet: unreachable });
    assert.equal(results, null);
  });

  it("an empty feature facet (e.g. make has no DealerOn dealers) is treated as no matches, not an error", async () => {
    const fetchFacet = fakeFacet("feature", []);
    const results = await searchDealerFeatureText("sport", "bmw", { fetchFacet });
    assert.deepEqual(results, []);
  });
});

describe("listVehiclesWithDealerFeature", () => {
  it("passes the make and feature name through to listInventory as a featureText filter", async () => {
    let capturedParams: unknown;
    const fetchVehicles = async (params: unknown) => {
      capturedParams = params;
      return { total: 1, limit: 50, offset: 0, vehicles: [{ vin: "WBA33AY09RF611294" } as InventoryVehicle] };
    };
    const vehicles = await listVehiclesWithDealerFeature("bmw", "Panoramic Sunroof", {}, { fetchVehicles });
    assert.deepEqual(capturedParams, { make: "bmw", featureText: "Panoramic Sunroof", inStock: true, limit: 50 });
    assert.equal(vehicles?.length, 1);
    assert.equal(vehicles?.[0].vin, "WBA33AY09RF611294");
  });

  it("returns null when the box is unreachable", async () => {
    const vehicles = await listVehiclesWithDealerFeature("bmw", "Panoramic Sunroof", {}, { fetchVehicles: unreachable });
    assert.equal(vehicles, null);
  });
});

describe("UNCODED_FEATURE_PLACEHOLDER", () => {
  it("is the literal code the box's option facet uses to identify DealerOn free-text rows", () => {
    assert.equal(UNCODED_FEATURE_PLACEHOLDER, "FEATURE");
  });
});
