import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crossReferenceStickerDealer, dealerNameTokens, searchDirectoryDealerships } from "./dealerSearch";

const ROWS = [
  { dealerName: "Howell, INC.", city: "Summit", state: "MS", zipCode: "39666" },
  { dealerName: "Friendship Chevrolet GMC of Forest City", city: "Forest City", state: "NC", zipCode: "28043" },
  { dealerName: "Route 23 Auto Mall", city: "Butler", state: "NJ", zipCode: "07405" },
  { dealerName: "Bachrodt BMW", city: "Rockford", state: "IL", zipCode: "61112" },
  { dealerName: "Bachrodt Buick GMC", city: "Rockford", state: "IL", zipCode: "61112" },
  { dealerName: "Capitol Chevrolet", city: "Austin", state: "TX", zipCode: "78745" },
  { dealerName: "Capitol Chevrolet", city: "Montgomery", state: "AL", zipCode: "36117" },
];

describe("dealerNameTokens", () => {
  it("keeps the distinctive words and drops brand and filler", () => {
    assert.deepEqual(dealerNameTokens("Friendship Chevrolet GMC of Forest City"), ["friendship", "forest", "city"]);
    assert.deepEqual(dealerNameTokens("Howell, INC."), ["howell"]);
    assert.deepEqual(dealerNameTokens("Route 23 Auto Mall"), ["route", "23", "mall"]);
  });
});

describe("searchDirectoryDealerships", () => {
  it("finds a store from an abbreviated name", () => {
    const hits = searchDirectoryDealerships(ROWS, "Howell GMC");
    assert.equal(hits[0]?.row.dealerName, "Howell, INC.");
  });
  it("ranks an exact name first and uses the state to split a chain", () => {
    const hits = searchDirectoryDealerships(ROWS, "Capitol Chevrolet", { state: "AL" });
    assert.equal(hits[0]?.row.city, "Montgomery");
    assert.equal(hits[1]?.row.city, "Austin");
  });
  it("returns nothing for a brand word alone or an unknown store", () => {
    assert.deepEqual(searchDirectoryDealerships(ROWS, "GMC"), []);
    assert.deepEqual(searchDirectoryDealerships(ROWS, "Zephyr Motors"), []);
    assert.deepEqual(searchDirectoryDealerships(ROWS, ""), []);
  });
});

describe("crossReferenceStickerDealer", () => {
  it("matches a sticker's sold-to block by name and state", () => {
    const row = crossReferenceStickerDealer(ROWS, { name: "ROUTE 23 AUTO MALL", city: "BUTLER", state: "NJ", zip: "07405" });
    assert.equal(row?.dealerName, "Route 23 Auto Mall");
  });
  it("accepts a clear fuzzy winner in the sticker's state", () => {
    const row = crossReferenceStickerDealer(ROWS, { name: "FRIENDSHIP CHEV GMC", city: "FOREST CITY", state: "NC" });
    assert.equal(row?.dealerName, "Friendship Chevrolet GMC of Forest City");
  });
  it("refuses when two rooftops are too close to call", () => {
    // "Bachrodt" alone fits two Rockford stores equally.
    assert.equal(crossReferenceStickerDealer(ROWS, { name: "BACHRODT", city: "ROCKFORD", state: "IL" }), null);
  });
  it("refuses a match in the wrong state and an empty block", () => {
    assert.equal(crossReferenceStickerDealer(ROWS, { name: "Howell", city: "Summit", state: "TX" }), null);
    assert.equal(crossReferenceStickerDealer(ROWS, { name: "" }), null);
    assert.equal(crossReferenceStickerDealer(ROWS, null), null);
  });
});
