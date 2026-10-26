// The new facet data on /search: condition and colour counts on chips, the price sparkline, and the "Leave out" words sent to the box.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FacetChips } from "../components/search/FacetChips";
import { PriceRange } from "../components/search/PriceRange";
import { filtersToQueryString } from "../components/BuyerSearchView";
import { parseBuyerSearchParams } from "./buyerSearchQuery";
import { inventoryQueryString } from "./inventoryApi";
import { hasNonFacetFilter, needsServerCount } from "./searchLive";

const none = () => {};
const base = { state: "", make: "Toyota", model: "", trim: "", cond: "", priceMin: "", priceMax: "", yearMin: "", yearMax: "", odometerMax: "", exteriorColor: "", interiorColor: "", optionKeys: [], possibleDemo: false, contactOnFile: false, zip: "", radiusMiles: "", sort: "", exclude: "" };

describe("chips carry the box's counts", () => {
  it("shows a number on each chip that has one, hides a zero-count chip, and shows none for a chip without a count", () => {
    const html = renderToStaticMarkup(<FacetChips label="Condition" selected={[]} onToggle={none}
      chips={[{ value: "new", label: "New", count: 1200 }, { value: "used", label: "Used", count: 0 }, { value: "cpo", label: "Certified" }]} />);
    assert.match(html, />New<\/span><span[^>]*>1,200</);
    assert.doesNotMatch(html, />Used</);
    assert.match(html, />Certified</);
  });
});

describe("price sparkline", () => {
  const counts = Array.from({ length: 31 }, (_, i) => (i === 6 ? 40 : i === 7 ? 20 : 0));
  it("draws one bar per non-empty bucket, bright inside the picked range and dim outside", () => {
    const html = renderToStaticMarkup(<PriceRange min="30000" max="40000" histogram={counts} onChange={none} />);
    assert.match(html, /data-testid="price-sparkline"/);
    assert.equal((html.match(/<rect/g) || []).length, 31);
    assert.equal((html.match(/fill-brand-500/g) || []).length, 2); // buckets 6 ($30-35k) and 7 ($35-40k) are inside; the rest are not
  });
  it("draws nothing without a histogram (an older box)", () => {
    assert.doesNotMatch(renderToStaticMarkup(<PriceRange min="" max="" onChange={none} />), /price-sparkline/);
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
