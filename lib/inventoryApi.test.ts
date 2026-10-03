import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inventoryQueryString, adminListSort } from "./inventoryApi";

describe("inventoryQueryString — optionKeys array", () => {
  it("comma-joins an optionKeys array into a single query param", () => {
    assert.equal(inventoryQueryString({ optionKeys: ["pano", "awd"] }), "?optionKeys=pano%2Cawd");
  });

  it("omits optionKeys entirely when the array is empty", () => {
    assert.equal(inventoryQueryString({ optionKeys: [] }), "");
  });
});

describe("inventoryQueryString — new PR 2 scalar filters", () => {
  it("includes priceMin/priceMax/maxDays/colors when set", () => {
    const qs = inventoryQueryString({ priceMin: 20000, priceMax: 40000, maxDays: 30, exteriorColor: "Black", interiorColor: "Tan" });
    const params = new URLSearchParams(qs);
    assert.equal(params.get("priceMin"), "20000");
    assert.equal(params.get("priceMax"), "40000");
    assert.equal(params.get("maxDays"), "30");
    assert.equal(params.get("exteriorColor"), "Black");
    assert.equal(params.get("interiorColor"), "Tan");
  });

  it("omits undefined/empty fields", () => {
    assert.equal(inventoryQueryString({ priceMin: undefined, exteriorColor: "" }), "");
  });
});

describe("adminListSort", () => {
  const base = { inStock: true, state: ["NJ"], make: ["Porsche"] };
  it("swaps the default dealer sort for model:asc on State + Make without a Model", () => {
    assert.equal(adminListSort({ ...base, sort: "dealer:asc" }), "model:asc");
    assert.equal(adminListSort({ ...base }), "model:asc");
    assert.equal(adminListSort({ ...base, state: "NJ", make: "Porsche", sort: "dealer:asc" }), "model:asc");
  });
  it("leaves an explicitly chosen sort alone", () => {
    assert.equal(adminListSort({ ...base, sort: "price:desc" }), "price:desc");
  });
  it("leaves every other shape alone", () => {
    assert.equal(adminListSort({ ...base, model: ["911"], sort: "dealer:asc" }), "dealer:asc");
    assert.equal(adminListSort({ state: ["NJ"], inStock: true, sort: "dealer:asc" }), "dealer:asc");
    assert.equal(adminListSort({ make: ["Porsche"], inStock: true, sort: "dealer:asc" }), "dealer:asc");
    assert.equal(adminListSort({ ...base, inStock: false, sort: "dealer:asc" }), "dealer:asc");
    assert.equal(adminListSort({ ...base, dealerId: "5", sort: "dealer:asc" }), "dealer:asc");
  });
});
