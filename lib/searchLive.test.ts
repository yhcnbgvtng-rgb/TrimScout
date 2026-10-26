import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanExcludeWord, facetCount, hasNonFacetFilter, isExcluded, needsServerCount, parseExclude, sliderMoney, type FacetLists, type LiveFilterShape } from "./searchLive";

const empty: LiveFilterShape = { state: "", make: "", model: "", trim: "", cond: "", priceMin: "", priceMax: "", yearMin: "", yearMax: "", odometerMax: "", exteriorColor: "", interiorColor: "", optionKeys: [], possibleDemo: false, contactOnFile: false, zip: "", radiusMiles: "" };
const facets: FacetLists = {
  states: [{ value: "NJ", count: 40 }],
  makes: [{ value: "Toyota", count: 100 }, { value: "Ford", count: 60 }],
  models: [{ value: "RAV4", count: 30 }],
  trims: [{ value: "XLE", count: 12 }],
};

describe("live count source", () => {
  it("uses the deepest picked facet level, or the whole inventory with nothing picked", () => {
    assert.equal(facetCount(empty, facets), 160);
    assert.equal(facetCount({ ...empty, state: "NJ" }, facets), 40);
    assert.equal(facetCount({ ...empty, make: "Toyota" }, facets), 100);
    assert.equal(facetCount({ ...empty, make: "Toyota", model: "RAV4" }, facets), 30);
    assert.equal(facetCount({ ...empty, make: "Toyota", model: "RAV4", trim: "XLE" }, facets), 12);
  });
  it("waits (null) when the picked value is not in its list yet", () => {
    assert.equal(facetCount({ ...empty, make: "Honda" }, facets), null);
    assert.equal(facetCount(empty, { ...facets, makes: [] }), null);
  });
  it("asks the box only for filters the facets cannot see, and only with a make (options need a model)", () => {
    assert.equal(hasNonFacetFilter({ ...empty, make: "Toyota" }), false);
    assert.equal(needsServerCount({ ...empty, make: "Toyota", cond: "new" }), true);
    assert.equal(needsServerCount({ ...empty, cond: "new" }), false);
    assert.equal(needsServerCount({ ...empty, make: "Toyota", optionKeys: ["PANO"] }), false);
    assert.equal(needsServerCount({ ...empty, make: "Toyota", model: "RAV4", optionKeys: ["PANO"] }), true);
    assert.equal(needsServerCount({ ...empty, make: "Toyota", priceMax: "40000" }), true);
  });
});

describe("keyword exclude", () => {
  it("parses, lowercases, de-duplicates and caps", () => {
    assert.deepEqual(parseExclude("Black, sport ;BLACK\n  hybrid  "), ["black", "sport", "hybrid"]);
    assert.equal(parseExclude(Array.from({ length: 30 }, (_, i) => `w${i}`).join(",")).length, 5);
    assert.deepEqual(parseExclude("  , ,"), []);
  });
  it("cleans words the way the box does: no wildcards or quotes, 2-24 characters", () => {
    assert.deepEqual(parseExclude("100%_x\\, a, O'Neil, " + "x".repeat(30)), ["100 x", "o neil"]);
    assert.equal(cleanExcludeWord("%%"), null);
  });
  it("matches year, make, model, trim and colours; no terms excludes nothing", () => {
    const car = { year: 2026, make: "Toyota", model: "RAV4", trim: "XSE Hybrid", exteriorColor: "Cavalry Blue", interiorColor: "Black" };
    assert.equal(isExcluded(car, []), false);
    assert.equal(isExcluded(car, ["hybrid"]), true);
    assert.equal(isExcluded(car, ["black"]), true);
    assert.equal(isExcluded(car, ["red"]), false);
  });
});

describe("price slider readout", () => {
  it("shortens thousands and marks the open top end", () => {
    assert.equal(sliderMoney(0), "$0");
    assert.equal(sliderMoney(32000), "$32k");
    assert.equal(sliderMoney(150000, true), "$150k+");
  });
});
