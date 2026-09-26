import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBuyerSearchParams, parsedSearchFiltersToParams, BuyerSearchParamsError } from "./buyerSearchQuery";
import type { ParsedSearchFilters } from "./searchParse";

function filters(partial: Partial<ParsedSearchFilters>): ParsedSearchFilters {
  return {
    make: null, model: null, trim: null, priceMin: null, priceMax: null, yearMin: null, yearMax: null, odometerMax: null,
    minDays: null, maxDays: null, exteriorColor: null, interiorColor: null, optionCodes: null,
    possibleDemo: null, zip: null, radiusMiles: null, ...partial,
  };
}

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

  it("allows zip alone (no radius) with no make — distance is shown, just not filtered", () => {
    const { query, zip, radiusMiles } = parseBuyerSearchParams(sp({ zip: "07601" }));
    assert.equal(zip, "07601");
    assert.equal(radiusMiles, undefined);
    assert.equal(query.make, undefined);
  });

  it("allows radiusMiles alone (no zip) — nothing to bound distance-wise without a zip anyway", () => {
    assert.doesNotThrow(() => parseBuyerSearchParams(sp({ radiusMiles: "50" })));
  });
});

describe("parseBuyerSearchParams — sort=distance", () => {
  it("is flagged via sortDistance and NOT forwarded as the box-side sort key", () => {
    const { query, sortDistance } = parseBuyerSearchParams(sp({ sort: "distance" }));
    assert.equal(sortDistance, true);
    assert.equal(query.sort, undefined);
  });

  it("passes any other sort key straight through", () => {
    const { query, sortDistance } = parseBuyerSearchParams(sp({ sort: "price:desc" }));
    assert.equal(sortDistance, false);
    assert.equal(query.sort, "price:desc");
  });
});

describe("parseBuyerSearchParams — field parsing", () => {
  it("splits, trims and drops empty entries from optionCodes", () => {
    const { query } = parseBuyerSearchParams(sp({ optionCodes: " PANO , , AWD " }));
    assert.deepEqual(query.optionCodes, ["PANO", "AWD"]);
  });

  it("is undefined (not an empty array) when optionCodes is absent", () => {
    const { query } = parseBuyerSearchParams(sp({}));
    assert.equal(query.optionCodes, undefined);
  });

  it("coerces numeric filters and caps limit at 100", () => {
    const { query } = parseBuyerSearchParams(sp({ priceMin: "20000", priceMax: "40000", limit: "5000" }));
    assert.equal(query.priceMin, 20000);
    assert.equal(query.priceMax, 40000);
    assert.equal(query.limit, 100);
  });

  it("coerces yearMin/yearMax", () => {
    const { query } = parseBuyerSearchParams(sp({ yearMin: "2023", yearMax: "2025" }));
    assert.equal(query.yearMin, 2023);
    assert.equal(query.yearMax, 2025);
  });

  it("defaults limit to 50 and offset to 0 when absent", () => {
    const { query } = parseBuyerSearchParams(sp({}));
    assert.equal(query.limit, 50);
    assert.equal(query.offset, 0);
  });
});

describe("parsedSearchFiltersToParams — Gemini's parsed filters onto the wire", () => {
  it("sets a param for every non-null filter", () => {
    const clarifications: string[] = [];
    const params = parsedSearchFiltersToParams(filters({ make: "Toyota", priceMax: 30000, optionCodes: ["PANO", "AWD"] }), clarifications);
    assert.equal(params.get("make"), "Toyota");
    assert.equal(params.get("priceMax"), "30000");
    assert.equal(params.get("optionCodes"), "PANO,AWD");
    assert.deepEqual(clarifications, []);
  });

  it("passes yearMin/yearMax through", () => {
    const clarifications: string[] = [];
    const params = parsedSearchFiltersToParams(filters({ yearMin: 2024, yearMax: 2024 }), clarifications);
    assert.equal(params.get("yearMin"), "2024");
    assert.equal(params.get("yearMax"), "2024");
  });

  it("drops radiusMiles and adds a clarification when make is absent — never a hard failure for an NL search", () => {
    const clarifications: string[] = [];
    const params = parsedSearchFiltersToParams(filters({ zip: "07601", radiusMiles: 50 }), clarifications);
    assert.equal(params.has("radiusMiles"), false);
    assert.equal(params.get("zip"), "07601");
    assert.equal(clarifications.length, 1);
  });

  it("keeps radiusMiles when make is also set", () => {
    const clarifications: string[] = [];
    const params = parsedSearchFiltersToParams(filters({ make: "Toyota", zip: "07601", radiusMiles: 50 }), clarifications);
    assert.equal(params.get("radiusMiles"), "50");
    assert.deepEqual(clarifications, []);
  });

  it("the resulting params pass parseBuyerSearchParams without throwing", () => {
    const clarifications: string[] = [];
    const params = parsedSearchFiltersToParams(filters({ zip: "07601", radiusMiles: 50 }), clarifications);
    assert.doesNotThrow(() => parseBuyerSearchParams(params));
  });
});
