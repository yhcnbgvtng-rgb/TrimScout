import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filtersFromSearchParams, filtersToSearchParams, urlWithFilters, type UrlFilters } from "./searchUrlState";

const base: UrlFilters = { state: "", make: "", model: "", trim: "", cond: "", priceMin: "", priceMax: "", yearMin: "", yearMax: "", odometerMax: "", exteriorColor: "", interiorColor: "", optionKeys: [], possibleDemo: false, contactOnFile: false, zip: "", radiusMiles: "", sort: "", exclude: "", odometerMin: "", bodyStyle: [], fuel: [], drivetrain: [], transmission: [], dealerIds: [], days: "", vinPattern: "" };

describe("search URL state", () => {
  it("round-trips every filter", () => {
    const f: UrlFilters = { ...base, state: "NJ", make: "Toyota", model: "RAV4", trim: "XLE", cond: "new", priceMin: "20000", priceMax: "40000", exteriorColor: "Cavalry Blue", optionKeys: ["PANO", "TOW"], possibleDemo: true, sort: "price:asc", exclude: "black, sport" };
    assert.deepEqual(filtersFromSearchParams(filtersToSearchParams(f), base), f);
  });
  it("round-trips the More-filters set as repeated params", () => {
    const f: UrlFilters = { ...base, make: "Ford", odometerMin: "10000", odometerMax: "60000", bodyStyle: ["SUV", "Crew Cab Pickup"], fuel: ["hybrid", "electric"], drivetrain: ["awd"], transmission: ["automatic"], dealerIds: ["12", "340"], days: "31-60", vinPattern: "1FT*" };
    const sp = filtersToSearchParams(f);
    assert.deepEqual(sp.getAll("dealerId"), ["12", "340"]);
    assert.deepEqual(sp.getAll("fuel"), ["hybrid", "electric"]);
    assert.deepEqual(filtersFromSearchParams(sp, base), f);
    const url = urlWithFilters("https://trimscout.com/search?utm=1#x", f);
    assert.equal(new URL(url).searchParams.getAll("bodyStyle").length, 2);
    assert.equal(new URL(url).searchParams.get("utm"), "1");
  });
  it("drops unknown or hostile More-filters values", () => {
    const sp = new URLSearchParams("make=Ford&fuel=rocket&fuel=gas&drivetrain=6x6&transmission=cvt&dealerId=abc&dealerId=7&days=999&bodyStyle=%3Cscript%3E&vinPattern=ab*i0q%24");
    const f = filtersFromSearchParams(sp, base);
    assert.deepEqual(f.fuel, ["gas"]);
    assert.deepEqual(f.drivetrain, []);
    assert.deepEqual(f.transmission, ["cvt"]);
    assert.deepEqual(f.dealerIds, ["7"]);
    assert.equal(f.days, "");
    assert.deepEqual(f.bodyStyle, ["script"]);
    assert.equal(f.vinPattern, "AB*0");
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
