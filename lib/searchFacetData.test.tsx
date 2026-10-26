// The new facet data on /search: condition and colour counts on chips, the price sparkline, and the "Leave out" words sent to the box.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ColumnFilterPanel, type ListRow } from "../components/search/ColumnFilterPanel";
import { filtersToQueryString } from "../components/BuyerSearchView";
import { parseBuyerSearchParams } from "./buyerSearchQuery";
import { inventoryQueryString } from "./inventoryApi";
import { hasNonFacetFilter, needsServerCount } from "./searchLive";

const none = () => {};
const base = { state: "", make: "Toyota", model: "", trim: "", cond: "", priceMin: "", priceMax: "", yearMin: "", yearMax: "", odometerMax: "", exteriorColor: "", interiorColor: "", optionKeys: [], possibleDemo: false, contactOnFile: false, zip: "", radiusMiles: "", sort: "", exclude: "", odometerMin: "", bodyStyle: [], fuel: [], drivetrain: [], transmission: [], dealerIds: [], daysMin: "", daysMax: "", vinPattern: "" };

describe("column filter lists carry the box's counts", () => {
  const list = (rows: ListRow[], extra = {}) => renderToStaticMarkup(<ColumnFilterPanel label="Condition" panel={{ kind: "list", rows, picked: [], onChange: none, empty: "none", ...extra }} />);
  it("shows a number on each row that has one, hides a zero-count row, and shows none for a row without a count", () => {
    const html = list([{ value: "new", label: "New", count: 1200 }, { value: "used", label: "Used", count: 0 }, { value: "cpo", label: "Certified" }]);
    assert.match(html, />New<\/span><span[^>]*>1,200</);
    assert.doesNotMatch(html, />Used</);
    assert.match(html, />Certified</);
  });
  it("keeps a picked row even at zero, so it can be unticked", () => {
    assert.match(list([{ value: "used", label: "Used", count: 0 }], { picked: ["used"] }), />Used</);
  });
  it("hides every count while they are pending", () => {
    assert.doesNotMatch(list([{ value: "new", label: "New", count: 1200 }], { pending: true }), /1,200/);
  });
});

describe("range histogram", () => {
  const counts = Array.from({ length: 31 }, (_, i) => (i === 6 ? 40 : i === 7 ? 20 : 0));
  const range = (hist?: number[]) => renderToStaticMarkup(<ColumnFilterPanel label="Price" panel={{ kind: "range", min: "30000", max: "40000", onChange: none, track: { min: 0, max: 150000, step: 1000 }, unit: "money", hist }} />);
  it("draws one bar per bucket", () => {
    const html = range(counts);
    assert.match(html, /data-testid="range-hist"/);
    assert.equal((html.match(/bg-brand-500\/30/g) || []).length, 31);
  });
  it("draws nothing without a histogram (an older box)", () => {
    assert.doesNotMatch(range(), /range-hist/);
  });
});

describe("Leave-out words go to the box as repeated exclude= params", () => {
  it("only with a make, cleaned and capped, never in the URL's comma form", () => {
    const sp = new URLSearchParams(filtersToQueryString({ ...base, exclude: "Black, sport hybrid, 100%" }, { limit: 1 }));
    assert.deepEqual(sp.getAll("exclude"), ["black", "sport hybrid", "100"]);
    assert.equal(new URLSearchParams(filtersToQueryString({ ...base, make: "", exclude: "black" })).has("exclude"), false);
  });
  it("makes the headline count a server count", () => {
    assert.equal(hasNonFacetFilter({ ...base, exclude: "black" }), true);
    assert.equal(needsServerCount({ ...base, exclude: "black" }), true);
    assert.equal(needsServerCount({ ...base, exclude: "" }), false);
  });
  it("the search route parses them and forwards them as repeated params", () => {
    const parsed = parseBuyerSearchParams(new URLSearchParams("make=Toyota&exclude=Black&exclude=x&exclude=sport%25"));
    assert.deepEqual(parsed.query.exclude, ["black", "sport"]);
    const qs = new URLSearchParams(inventoryQueryString({ make: "Toyota", exclude: ["black", "sport"] }));
    assert.deepEqual(qs.getAll("exclude"), ["black", "sport"]);
    assert.equal(parseBuyerSearchParams(new URLSearchParams("make=Toyota")).query.exclude, undefined);
  });
});
