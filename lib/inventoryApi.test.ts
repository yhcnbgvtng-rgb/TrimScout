import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inventoryQueryString, adminListSort, searchInventory, listInventory } from "./inventoryApi";

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

describe("retailOnly — the buyer search leaves wholesale lots out, the admin list does not", () => {
  const withStubbedBox = async (fn: () => Promise<void>) => {
    const urls: string[] = [];
    const prevFetch = globalThis.fetch, prevKey = process.env.LIGHTSAIL_API_KEY;
    process.env.LIGHTSAIL_API_KEY = "test-key";
    globalThis.fetch = (async (url: string) => { urls.push(String(url)); return new Response(JSON.stringify({ total: 0, limit: 50, offset: 0, vehicles: [] }), { status: 200, headers: { "Content-Type": "application/json" } }); }) as typeof fetch;
    try { await fn(); } finally { globalThis.fetch = prevFetch; if (prevKey === undefined) delete process.env.LIGHTSAIL_API_KEY; else process.env.LIGHTSAIL_API_KEY = prevKey; }
    return urls;
  };
  it("the query string carries retailOnly=1 only when asked", () => {
    assert.equal(inventoryQueryString({ retailOnly: true }), "?retailOnly=1");
    assert.equal(inventoryQueryString({ retailOnly: false }), "");
  });
  it("searchInventory (the buyer /search call) always sends retailOnly=1 with inStock=1", async () => {
    const urls = await withStubbedBox(async () => { await searchInventory({ make: "Mercedes-Benz", state: "FL" }); });
    assert.equal(urls.length, 1);
    const p = new URL(urls[0]).searchParams;
    assert.equal(p.get("retailOnly"), "1");
    assert.equal(p.get("inStock"), "1");
    assert.equal(p.get("make"), "Mercedes-Benz");
  });
  it("listInventory (the admin sheet) does not send it", async () => {
    const urls = await withStubbedBox(async () => { await listInventory({ make: "Mercedes-Benz", inStock: true }); });
    assert.equal(new URL(urls[0]).searchParams.has("retailOnly"), false);
  });
  it("a caller cannot switch it off through searchInventory", async () => {
    const urls = await withStubbedBox(async () => { await searchInventory({ make: "Ford", ...({ retailOnly: false } as object) }); });
    assert.equal(new URL(urls[0]).searchParams.get("retailOnly"), "1");
  });
});
