import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBuyerSearchParams, BuyerSearchParamsError } from "./buyerSearchQuery";

function sp(pairs: Record<string, string>): URLSearchParams {
  return new URLSearchParams(pairs);
}

describe("parseBuyerSearchParams — the zip+radius 'requires make' guardrail", () => {
  it("throws when zip and radiusMiles are both set but make is not", () => {
    assert.throws(() => parseBuyerSearchParams(sp({ zip: "07601", radiusMiles: "50" })), BuyerSearchParamsError);
  });

  it("allows zip+radiusMiles when make is also set", () => {
    const { zip, radiusMiles } = parseBuyerSearchParams(sp({ zip: "07601", radiusMiles: "50", make: "Toyota" }));
    assert.equal(zip, "07601");
    assert.equal(radiusMiles, 50);
  });

  it("allows zip alone (no radius) with a make — distance is shown, just not filtered", () => {
    const { zip, radiusMiles } = parseBuyerSearchParams(sp({ zip: "07601", make: "Toyota" }));
    assert.equal(zip, "07601");
    assert.equal(radiusMiles, undefined);
  });

  it("gives the radius-specific message when radius is set without make", () => {
    assert.throws(() => parseBuyerSearchParams(sp({ zip: "07601", radiusMiles: "50" })), /radiusMiles requires make/);
  });
});

describe("parseBuyerSearchParams — sort=distance", () => {
  it("is flagged via sortDistance and NOT forwarded as the box-side sort key", () => {
    const { query, sortDistance } = parseBuyerSearchParams(sp({ make: "Ford", sort: "distance" }));
    assert.equal(sortDistance, true);
    assert.equal(query.sort, undefined);
  });

  it("passes any other sort key straight through", () => {
    const { query, sortDistance } = parseBuyerSearchParams(sp({ make: "Ford", sort: "price:desc" }));
    assert.equal(sortDistance, false);
    assert.equal(query.sort, "price:desc");
  });
});

describe("parseBuyerSearchParams — field parsing", () => {
  it("splits, trims and drops empty entries from optionKeys", () => {
    const { query } = parseBuyerSearchParams(sp({ make: "Ford", model: "F-150", optionKeys: " PANO , , AWD " }));
    assert.deepEqual(query.optionKeys, ["PANO", "AWD"]);
  });

  it("is undefined (not an empty array) when optionKeys is absent", () => {
    const { query } = parseBuyerSearchParams(sp({ make: "Ford" }));
    assert.equal(query.optionKeys, undefined);
  });

  it("coerces numeric filters and caps limit at 100", () => {
    const { query } = parseBuyerSearchParams(sp({ make: "Ford", priceMin: "20000", priceMax: "40000", limit: "5000" }));
    assert.equal(query.priceMin, 20000);
    assert.equal(query.priceMax, 40000);
    assert.equal(query.limit, 100);
  });

  it("coerces yearMin/yearMax", () => {
    const { query } = parseBuyerSearchParams(sp({ make: "Ford", yearMin: "2023", yearMax: "2025" }));
    assert.equal(query.yearMin, 2023);
    assert.equal(query.yearMax, 2025);
  });

  it("defaults limit to 50 and offset to 0 when absent", () => {
    const { query } = parseBuyerSearchParams(sp({ make: "Ford" }));
    assert.equal(query.limit, 50);
    assert.equal(query.offset, 0);
  });
});

describe("parseBuyerSearchParams — query gates", () => {
  it("refuses a bare search with no filters (400 copy, never reaches the box)", () => {
    assert.throws(() => parseBuyerSearchParams(sp({})), /Pick a make/);
  });

  it("refuses state-only, price-only and free-text-only searches — make is the selective filter", () => {
    assert.throws(() => parseBuyerSearchParams(sp({ state: "NJ" })), BuyerSearchParamsError);
    assert.throws(() => parseBuyerSearchParams(sp({ priceMax: "30000" })), BuyerSearchParamsError);
    assert.throws(() => parseBuyerSearchParams(sp({ q: "f150" })), BuyerSearchParamsError);
  });

  it("refuses optionKeys without make, and without a model", () => {
    assert.throws(() => parseBuyerSearchParams(sp({ optionKeys: "4wd" })), BuyerSearchParamsError);
    assert.throws(() => parseBuyerSearchParams(sp({ make: "Ford", optionKeys: "4wd" })), /Pick a model/);
  });

  it("allows make, make+model, make+state and make+model+optionKeys", () => {
    for (const p of <Array<Record<string, string>>>[{ make: "Ford" }, { make: "Ford", model: "F-150" }, { make: "Ford", state: "NJ" }, { make: "Ford", model: "F-150", optionKeys: "4wd,towing" }]) {
      assert.doesNotThrow(() => parseBuyerSearchParams(sp(p)));
    }
  });

  it("caps how many must-have options one search may carry", () => {
    const keys = Array.from({ length: 9 }, (_, i) => `k${i}`).join(",");
    assert.throws(() => parseBuyerSearchParams(sp({ make: "Ford", model: "F-150", optionKeys: keys })), /at most 8/);
  });

  it("always asks the box for a capped count, never an exact one", () => {
    assert.equal(parseBuyerSearchParams(sp({ make: "Ford" })).query.countCap, 1000);
  });
});
