// OPTIONS_PAID_ONLY: default off, per-row price > 0, "+$1,225" prices, package price on the package row, "Standard features",
// and "No paid factory options listed". Flag off must leave both screens exactly as they were.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { optionPriceText, catalogOptionLabel } from "./optionsPaidOnly";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NO_PAID_FACTORY_OPTIONS, STANDARD_FEATURES_HEADING, filterMustHaveOptions, formatOptionPrice, optionsPaidOnlyEnabled, paidOptionView,
} from "./optionsPaidOnly";
import { PaidOnlyOptions } from "../components/OfferCompareView";

const ROWS = [
  { code: "PKG-65", name: "Lighting Package", price: 650, kind: "factory" },
  { code: "OPT-23", name: "Adaptive Full LED Lights", price: 0, kind: "factory" },
  { code: "OPT-15", name: "M Carbon Roof", price: 2600, kind: "factory" },
  { code: "OPT-31", name: "Tow Hitch", price: 430, kind: "dealer" },
  { code: "FEATURE", name: "Heated Seats", price: 0, kind: "factory" },
  { code: "OPT-9", name: "Heated Seats", price: 0, kind: "factory" },
  { code: "OPT-2", name: "Tow Hitch", price: 0, kind: "factory" },
  { code: "OPT-3", name: "Tow Hitch", price: 430, kind: "factory" },
];

describe("the flag", () => {
  it("is off by default and when blank", () => {
    assert.equal(optionsPaidOnlyEnabled({}), false);
    assert.equal(optionsPaidOnlyEnabled({ OPTIONS_PAID_ONLY: "" }), false);
    assert.equal(optionsPaidOnlyEnabled({ OPTIONS_PAID_ONLY: "off" }), false);
    assert.equal(optionsPaidOnlyEnabled({ OPTIONS_PAID_ONLY: "0" }), false);
  });
  it("is on for 1 / true / yes / on", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on", " on "]) assert.equal(optionsPaidOnlyEnabled({ OPTIONS_PAID_ONLY: v }), true, v);
  });
  it("is wired into next.config.js so the client components can read it", () => {
    assert.match(fs.readFileSync(path.join(__dirname, "../next.config.js"), "utf8"), /OPTIONS_PAID_ONLY:\s*process\.env\.OPTIONS_PAID_ONLY/);
  });
});

describe("formatOptionPrice", () => {
  it("formats like +$1,225", () => {
    assert.equal(formatOptionPrice(1225), "+$1,225");
    assert.equal(formatOptionPrice(69), "+$69");
    assert.equal(formatOptionPrice(2600), "+$2,600");
    assert.equal(formatOptionPrice(1234567), "+$1,234,567");
    assert.equal(formatOptionPrice(1225.5), "+$1,225.50");
  });
});

describe("paidOptionView (flag on)", () => {
  const v = paidOptionView(ROWS);
  it("keeps only price > 0 factory rows, each with its price; the package row shows the package price", () => {
    assert.deepEqual(v.paid.map((o) => [o.name, o.priceLabel]), [["Lighting Package", "+$650"], ["M Carbon Roof", "+$2,600"], ["Tow Hitch", "+$430"]]);
  });
  it("applies the rule per row, not per label: Tow Hitch is $0 on one row and $430 on another, and the paid row stays", () => {
    assert.ok(v.paid.some((o) => o.name === "Tow Hitch"));
  });
  it("drops dealer-kind rows", () => assert.equal(v.paid.filter((o) => o.kind === "dealer").length, 0));
  it("puts $0 factory rows under standard features, one per name", () => {
    assert.deepEqual(v.standard.map((o) => o.name), ["Adaptive Full LED Lights", "Heated Seats", "Tow Hitch"]);
  });
  it("a car with no paid row says so", () => {
    const none = paidOptionView([{ name: "Heated Seats", price: 0 }, { name: "Clock" }]);
    assert.equal(none.noPaid, true);
    assert.equal(none.paid.length, 0);
    assert.equal(none.standard.length, 2);
    assert.equal(paidOptionView(null).noPaid, true);
    assert.equal(paidOptionView([]).noPaid, true);
  });
});

describe("filterMustHaveOptions", () => {
  const opts = [{ name: "A", price: 100 }, { name: "B", price: 0 }, { name: "C" }, { name: "D", price: 5, kind: "dealer" }];
  it("flag on: only paid factory rows", () => assert.deepEqual(filterMustHaveOptions(opts, true).map((o) => o.name), ["A"]));
  it("flag off: the list exactly as given", () => assert.deepEqual(filterMustHaveOptions(opts, false), opts));
});

describe("compare view list (flag on)", () => {
  const lines = [
    { code: "PKG-65", description: "Lighting Package", price: 650 },
    { code: null, description: "Adaptive Full LED Lights", price: 0 },
    { code: null, description: "M Carbon Roof", price: 2600 },
  ];
  it("shows paid rows with +$ prices and a Standard features section", () => {
    const html = renderToStaticMarkup(<PaidOnlyOptions options={lines} sharedOptions={new Set()} />);
    assert.match(html, /Lighting Package/);
    assert.match(html, /\+\$650/);
    assert.match(html, /\+\$2,600/);
    assert.ok(html.includes(STANDARD_FEATURES_HEADING));
    assert.ok(!html.includes(NO_PAID_FACTORY_OPTIONS));
    assert.ok(html.indexOf("Adaptive Full LED Lights") > html.indexOf(STANDARD_FEATURES_HEADING));
  });
  it("a car with no paid option shows the empty message and keeps standard features", () => {
    const html = renderToStaticMarkup(<PaidOnlyOptions options={[{ code: null, description: "Heated Seats", price: 0 }]} sharedOptions={new Set()} />);
    assert.ok(html.includes(NO_PAID_FACTORY_OPTIONS));
    assert.ok(html.includes(STANDARD_FEATURES_HEADING));
    assert.match(html, /Heated Seats/);
  });
});

describe("flag off leaves both screens alone", () => {
  const compare = fs.readFileSync(path.join(__dirname, "../components/OfferCompareView.tsx"), "utf8");
  const wizard = fs.readFileSync(path.join(__dirname, "../components/BiddingWizard.tsx"), "utf8");
  it("the compare view only takes the new path behind optionsPaidOnlyEnabled(), and keeps the old list as the else branch", () => {
    assert.match(compare, /const paidOnly = optionsPaidOnlyEnabled\(\)/);
    assert.match(compare, /\) : paidOnly \? \(\s*<PaidOnlyOptions/);
    assert.match(compare, /formatCurrency\(opt\.price\)/); // the original price text is still there for the flag-off branch
  });
  it("the wizard picker filters and re-formats only when the flag is on", () => {
    assert.match(wizard, /options=\{filterMustHaveOptions\(fordFilterableOptions, optionsPaidOnlyEnabled\(\)\)\}/);
    assert.match(wizard, /paidOnly \? formatOptionPrice\(opt\.price\) : formatCurrency\(opt\.price\)/);
  });
});


// ---- /search factory-options filter: price next to each option (catalog endpoint, OPTIONS_PAID_ONLY) ----
describe("paid-only catalog filter (/search)", () => {

  it("optionPriceText: one price, a range, and nothing", () => {
  assert.equal(optionPriceText(450, 450), "+$450");
  assert.equal(optionPriceText(800, 1400), "+$800–$1,400");
  assert.equal(optionPriceText(1400, 800), "+$800–$1,400");
  assert.equal(optionPriceText(undefined, undefined), "");
  assert.equal(optionPriceText(0, 0), "");
  assert.equal(optionPriceText(null, 600), "+$600");
});

  it("catalogOptionLabel: flag off is the label untouched, flag on adds the price or range", () => {
  const o = { label: "Panoramic Roof", minPrice: 900, maxPrice: 1500 };
  assert.equal(catalogOptionLabel(o, false), "Panoramic Roof");
  assert.equal(catalogOptionLabel(o, true), "Panoramic Roof (+$900–$1,500)");
  assert.equal(catalogOptionLabel({ label: "Tow Package" }, true), "Tow Package");
});

  it("BuyerSearchView: price in the label and the empty state are behind the flag; the old empty text stays for flag off", () => {
  const src = fs.readFileSync(new URL("../components/BuyerSearchView.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("catalogOptionLabel(o, paidOnly)"));
  assert.ok(src.includes('paidOnly ? NO_PAID_FACTORY_OPTIONS : "No factory options in inventory for this make/model yet."'));
});

});
