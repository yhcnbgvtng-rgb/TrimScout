import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanColorName, normalizeColorFacets, rawsForColor } from "./colorFacets";
import { isColorCode } from "./colorCode";

describe("isColorCode: letter-only and 6-character codes", () => {
  it("flags KAD, PSC, UM, BK and WA8555", () => {
    for (const c of ["KAD", "PSC", "UM", "BK", "WA8555", "490vdb", "A1B2C3"]) assert.equal(isColorCode(c), true, c);
  });
  it("leaves real names, including capitalised short words", () => {
    for (const c of ["Red", "RED", "TAN", "Tan", "Black", "Alpine White", "Blue", "Gray"]) assert.equal(isColorCode(c), false, c);
  });
});

describe("cleanColorName", () => {
  it("strips leading and parenthetical paint codes", () => {
    assert.equal(cleanColorName("0300 Alpine White"), "Alpine White");
    assert.equal(cleanColorName("Mineral White (A96)"), "Mineral White");
    assert.equal(cleanColorName("(P0WT) Glacier White"), "Glacier White");
    assert.equal(cleanColorName("WA8555 Glacier White"), "Glacier White");
  });
  it("drops code-only and junk values", () => {
    for (const j of ["BK", "KAD", "490vdb", "XDRIVE", "2007 Bmw 3 Series 328Xi", "", "  ", null, "WA8555"]) assert.equal(cleanColorName(j as string | null), null, String(j));
  });
  it("title-cases", () => {
    assert.equal(cleanColorName("ALPINE WHITE"), "Alpine White");
    assert.equal(cleanColorName("black sapphire metallic"), "Black Sapphire Metallic");
  });
});

describe("normalizeColorFacets", () => {
  const raws = ["0300 Alpine White", "Alpine White", "ALPINE WHITE", "Alpine Whi", "BK", "XDRIVE", "490vdb", "2007 Bmw 3 Series 328Xi", "Black", "Black Sapphire Metallic", "Red", "Redline"];
  const f = normalizeColorFacets(raws);
  it("merges duplicates and truncations, keeps distinct colours", () => {
    assert.deepEqual(f.values, ["Alpine White", "Black", "Black Sapphire Metallic", "Red", "Redline"]);
  });
  it("remembers every raw value behind a merged colour so filtering still finds every car", () => {
    assert.deepEqual(rawsForColor(f, "Alpine White").sort(), ["0300 Alpine White", "ALPINE WHITE", "Alpine Whi", "Alpine White"]);
    assert.deepEqual(rawsForColor(f, "Black"), ["Black"]);
  });
  it("passes through a value that is not a known clean value", () => {
    assert.deepEqual(rawsForColor(f, "Unlisted Raw"), ["Unlisted Raw"]);
    assert.deepEqual(rawsForColor(null, "X"), ["X"]);
  });
});
