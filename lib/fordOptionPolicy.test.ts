import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyFordOptionPolicy, type MustHaveOption } from "./fordOptionPolicy";
import { cleanOptionNames, mustHaveSummary, stripNonPrinting } from "./mustHaveOptions";

// 1FTFW1L53TKE33634 — a 2026 F-150 XL. The raw sticker lines are what the buyer used to see.
const VIN = "1FTFW1L53TKE33634";
const XL = { make: "Ford", model: "F-150", year: 2026, trim: "XL" };
const line = (name: string, price: number | null = null): MustHaveOption => ({ name, code: null, description: name, price, source: "sticker" });
const RAW = [
  line("50 STATE EMISSIONS"),
  line("XL SERIES"),
  line("3.31 RATIO REGULAR AXLE"),
  line("CONN PKG: 1 YR INCL W/FORD APP"),
  line("▒▒ BLACK VINYL 40/CONSOLE/40 ▒"),
  line("Argon Blue Metallic", 395),
  line("5.0L V8 w/ Auto Start-Stop", 2595),
  line("Bedliner – Tough Bed Spray-In", 62),
  line("XL High (103A)", 1195),
];

describe(`Ford must-have list for ${VIN} (2026 F-150 XL)`, () => {
  const out = applyFordOptionPolicy(XL, RAW);
  const names = out.map((o) => o.name);

  it("keeps only paid packages, options, paint and powertrain, under policy names and prices", () => {
    assert.deepEqual(names.slice().sort(), ["5.0L V8 w/ Auto Start-Stop", "Argon Blue Metallic", "Bedliner – Tough Bed Spray-In", "XL High (103A)"].sort());
    assert.equal(out.find((o) => o.name === "XL High (103A)")!.price, 1195);
    assert.equal(out.find((o) => o.name === "Argon Blue Metallic")!.price, 395);
  });

  it("drops emissions, series names, unpriced axle ratios, subscriptions and standard items", () => {
    for (const junk of ["50 STATE EMISSIONS", "XL SERIES", "3.31 RATIO REGULAR AXLE", "CONN PKG: 1 YR INCL W/FORD APP"]) {
      assert.ok(!names.some((n) => n.toUpperCase().includes(junk.split(":")[0])), junk);
    }
    assert.ok(!names.some((n) => /BLACK VINYL/i.test(n)), "standard seat trim");
  });

  it("leaves no non-printing glyphs", () => {
    for (const n of names) assert.equal(n, stripNonPrinting(n));
    assert.ok(!names.join("").includes("▒"));
  });

  it("an untrusted trim gets no options (policy rule 6)", () => {
    assert.deepEqual(applyFordOptionPolicy({ ...XL, trim: "Mystery" }, RAW), []);
  });

  it("no policy (other model/year/make): the current list, glyphs stripped", () => {
    for (const v of [{ ...XL, model: "Explorer" }, { ...XL, year: 2025 }, { ...XL, make: "Lincoln" }]) {
      const r = applyFordOptionPolicy(v, RAW);
      assert.equal(r.length, RAW.length);
      assert.ok(r.some((o) => o.name === "50 STATE EMISSIONS"), "unfiltered");
      assert.ok(!r.map((o) => o.name).join("").includes("▒"));
      assert.ok(r.some((o) => o.name === "BLACK VINYL 40/CONSOLE/40"));
    }
  });
});

describe("helpers", () => {
  it("stripNonPrinting removes block glyphs, control and replacement chars", () => {
    assert.equal(stripNonPrinting("A▒▒B\u0007 C�"), "A B C");
  });
  it("cleanOptionNames drops blanks and repeats", () => {
    assert.deepEqual(cleanOptionNames([{ name: "▒" }, { name: "X" }, { name: "x" }]).map((o) => o.name), ["X"]);
  });
  it("summary pluralizes", () => {
    assert.equal(mustHaveSummary(1), "1 must-have selected");
    assert.equal(mustHaveSummary(3), "3 must-haves selected");
  });
});
