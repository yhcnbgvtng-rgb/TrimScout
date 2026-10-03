import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_FILTERS, activeFilterCount, buildVehicleQuery, cascadeCleared, effectiveSort, facetKey, facetParams, filtersEqual, hasAnyFilter, loadAllFilters, pruneToOptions, type VehicleFilters } from "./vehicleFilters";

const f = (over: Partial<VehicleFilters>): VehicleFilters => ({ ...EMPTY_FILTERS, ...over });
const sort = { key: "dealer", dir: "asc" } as const;

describe("buildVehicleQuery", () => {
  it("repeats multi-select keys (OR within a field) and keeps trims with commas intact", () => {
    const p = buildVehicleQuery(f({ states: ["FL", "GA"], makes: ["Ford"], trims: ["XLT, 4x4", "Lariat"], conds: ["new", "cpo"] }), sort);
    assert.deepEqual(p.getAll("state"), ["FL", "GA"]);
    assert.deepEqual(p.getAll("make"), ["Ford"]);
    assert.deepEqual(p.getAll("trim"), ["XLT, 4x4", "Lariat"]);
    assert.deepEqual(p.getAll("cond"), ["new", "cpo"]);
    assert.equal(p.get("inStock"), "1");
    assert.equal(p.get("sort"), "dealer:asc");
  });
  it("drops the in-stock gate while Sold is selected (a sold car is never in stock)", () => {
    const p = buildVehicleQuery(f({ movement: "removed" }), sort);
    assert.equal(p.get("removed"), "1");
    assert.equal(p.has("inStock"), false);
  });
  it("maps the movement choices to the box params", () => {
    assert.equal(buildVehicleQuery(f({ movement: "arrivals" }), sort).get("changeType"), "NEW_ARRIVAL");
    assert.equal(buildVehicleQuery(f({ movement: "drops" }), sort).get("priceChange"), "drop");
    assert.equal(buildVehicleQuery(f({ movement: "increases" }), sort).get("priceChange"), "increase");
  });
  it("sends no row filters for the bare default", () => {
    const p = buildVehicleQuery(EMPTY_FILTERS, sort);
    assert.deepEqual([...p.keys()].sort(), ["inStock", "sort"]);
  });
  it("trims the search text and ignores a zero/blank days filter", () => {
    const p = buildVehicleQuery(f({ q: "  1FT  ", minDays: "0" }), sort);
    assert.equal(p.get("q"), "1FT");
    assert.equal(p.has("minDays"), false);
    assert.equal(buildVehicleQuery(f({ minDays: "30" }), sort).get("minDays"), "30");
  });
});

describe("apply gate bookkeeping", () => {
  it("the empty default has no filter; changing any field makes it a filter", () => {
    assert.equal(hasAnyFilter(EMPTY_FILTERS), false);
    assert.equal(hasAnyFilter(f({ states: ["NJ"] })), true);
    assert.equal(hasAnyFilter(f({ inStock: false })), true);
    assert.equal(hasAnyFilter(f({ q: "   " })), false, "whitespace-only search is not a filter");
  });
  it("filtersEqual ignores click order inside a multi-select", () => {
    assert.equal(filtersEqual(f({ makes: ["Ford", "Kia"] }), f({ makes: ["Kia", "Ford"] })), true);
    assert.equal(filtersEqual(f({ makes: ["Ford"] }), f({ makes: ["Ford", "Kia"] })), false);
  });
  it("Load all drops every filter but keeps the In-stock checkbox", () => {
    const all = loadAllFilters(f({ states: ["FL"], makes: ["Ford"], q: "x", inStock: false }));
    assert.deepEqual(all, { ...EMPTY_FILTERS, inStock: false });
    assert.equal(loadAllFilters(f({ states: ["FL"] })).inStock, true);
  });
  it("counts distinct active filters, not selected values", () => {
    assert.equal(activeFilterCount(EMPTY_FILTERS), 0);
    assert.equal(activeFilterCount(f({ states: ["FL", "GA", "NJ"], makes: ["Ford"], inStock: false })), 3);
  });
});

describe("facet scoping", () => {
  it("scopes by states, makes and (only with a make) models", () => {
    const p = facetParams(f({ states: ["FL", "GA"], makes: ["Ford"], models: ["F-150"] }));
    assert.equal(p.get("facets"), "1");
    assert.deepEqual(p.getAll("state"), ["FL", "GA"]);
    assert.deepEqual(p.getAll("model"), ["F-150"]);
    assert.deepEqual(facetParams(f({ models: ["F-150"] })).getAll("model"), [], "a model without a make scopes nothing");
  });
  it("key ignores click order and non-facet filters, but changes with the selection", () => {
    assert.equal(facetKey(f({ states: ["GA", "FL"] })), facetKey(f({ states: ["FL", "GA"], conds: ["new"], q: "abc" })));
    assert.notEqual(facetKey(f({ states: ["FL"] })), facetKey(f({ states: ["FL", "GA"] })));
  });
});

describe("cascade + prune", () => {
  it("emptying make clears model and trim; emptying model clears trim", () => {
    assert.deepEqual(cascadeCleared(f({ models: ["F-150"], trims: ["XLT"] })).models, []);
    const c = cascadeCleared(f({ makes: ["Ford"], trims: ["XLT"] }));
    assert.deepEqual(c.trims, []);
    assert.deepEqual(cascadeCleared(f({ makes: ["Ford"], models: ["F-150"], trims: ["XLT"] })).trims, ["XLT"]);
  });
  it("pruneToOptions keeps the same object when nothing is dropped", () => {
    const x = f({ models: ["F-150"], trims: ["XLT"] });
    assert.equal(pruneToOptions(x, ["F-150", "Bronco"], ["XLT"]), x);
    assert.deepEqual(pruneToOptions(x, ["Bronco"], ["XLT"]).models, []);
  });
});

describe("effectiveSort — filter-aware default (in-stock State+Make without a Model → sort=model)", () => {
  it("State+Make (single or multi) in stock with no Model defaults to model:asc", () => {
    assert.equal(buildVehicleQuery(f({ states: ["NJ"], makes: ["Porsche"] }), null).get("sort"), "model:asc");
    assert.equal(buildVehicleQuery(f({ states: ["NJ", "NY"], makes: ["Porsche", "Audi"] }), null).get("sort"), "model:asc");
  });
  it("keeps dealer:asc for State-only (model sort measured slower), no state, a Model, not-in-stock, or Sold", () => {
    assert.equal(buildVehicleQuery(f({ states: ["NJ", "NY"] }), null).get("sort"), "dealer:asc");
    assert.equal(buildVehicleQuery(f({ makes: ["Ford"] }), null).get("sort"), "dealer:asc");
    assert.equal(buildVehicleQuery(f({ states: ["NJ"], makes: ["Ford"], models: ["F-150"] }), null).get("sort"), "dealer:asc");
    assert.equal(buildVehicleQuery(f({ states: ["NJ"], makes: ["Ford"], inStock: false }), null).get("sort"), "dealer:asc");
    assert.equal(buildVehicleQuery(f({ states: ["NJ"], makes: ["Ford"], movement: "removed" }), null).get("sort"), "dealer:asc");
    assert.equal(buildVehicleQuery(EMPTY_FILTERS, null).get("sort"), "dealer:asc");
  });
  it("an explicit sort choice always wins over the default", () => {
    assert.equal(buildVehicleQuery(f({ states: ["NJ"], makes: ["Ford"] }), { key: "price", dir: "desc" }).get("sort"), "price:desc");
    assert.equal(buildVehicleQuery(f({ states: ["NJ"], makes: ["Ford"] }), { key: "dealer", dir: "asc" }).get("sort"), "dealer:asc");
  });
});
