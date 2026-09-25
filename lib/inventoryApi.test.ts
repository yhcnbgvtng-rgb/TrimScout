import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inventoryQueryString } from "./inventoryApi";

describe("inventoryQueryString — optionCodes array", () => {
  it("comma-joins an optionCodes array into a single query param", () => {
    assert.equal(inventoryQueryString({ optionCodes: ["PANO", "AWD"] }), "?optionCodes=PANO%2CAWD");
  });

  it("omits optionCodes entirely when the array is empty", () => {
    assert.equal(inventoryQueryString({ optionCodes: [] }), "");
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
