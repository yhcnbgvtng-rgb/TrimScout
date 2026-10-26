import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filtersFromSearchParams, filtersToSearchParams, urlWithFilters, type UrlFilters } from "./searchUrlState";

const base: UrlFilters = { state: "", make: "", model: "", trim: "", cond: "", priceMin: "", priceMax: "", yearMin: "", yearMax: "", odometerMax: "", exteriorColor: "", interiorColor: "", optionKeys: [], possibleDemo: false, contactOnFile: false, zip: "", radiusMiles: "", sort: "", exclude: "" };

describe("search URL state", () => {
  it("round-trips every filter", () => {
    const f: UrlFilters = { ...base, state: "NJ", make: "Toyota", model: "RAV4", trim: "XLE", cond: "new", priceMin: "20000", priceMax: "40000", exteriorColor: "Cavalry Blue", optionKeys: ["PANO", "TOW"], possibleDemo: true, sort: "price:asc", exclude: "black, sport" };
    assert.deepEqual(filtersFromSearchParams(filtersToSearchParams(f), base), f);
  });
  it("an empty state is an empty query", () => {
    assert.equal(filtersToSearchParams(base).toString(), "");
  });
  it("ignores junk: bad numbers, unknown condition, a model with no make", () => {
    const f = filtersFromSearchParams(new URLSearchParams("model=RAV4&trim=XLE&priceMax=abc&cond=wholesale&optionKeys=A,B&bogus=1"), base);
    assert.equal(f.model, ""); assert.equal(f.trim, ""); assert.deepEqual(f.optionKeys, []);
    assert.equal(f.priceMax, ""); assert.equal(f.cond, "");
  });
  it("keeps options only with a model, and caps them at 8", () => {
    const keys = Array.from({ length: 12 }, (_, i) => `K${i}`).join(",");
    assert.equal(filtersFromSearchParams(new URLSearchParams(`make=Toyota&optionKeys=${keys}`), base).optionKeys.length, 0);
    assert.equal(filtersFromSearchParams(new URLSearchParams(`make=Toyota&model=RAV4&optionKeys=${keys}`), base).optionKeys.length, 8);
  });
  it("rewrites only the filter params of a URL", () => {
    const out = new URL(urlWithFilters("http://x.test/search?make=Ford&utm=1#top", { ...base, make: "Toyota" }));
    assert.equal(out.searchParams.get("make"), "Toyota"); assert.equal(out.searchParams.get("utm"), "1"); assert.equal(out.hash, "#top");
    assert.equal(new URL(urlWithFilters("http://x.test/search?make=Ford", base)).search, "");
  });
});
