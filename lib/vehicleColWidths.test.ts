// Admin Vehicles table: columns fit the rows on the page.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeColWidths, headerWidth, NUMERIC_KEYS } from "./vehicleColWidths";

const cols = [
  { key: "dealerState", label: "State" },
  { key: "dealerName", label: "Dealer", sortable: true },
  { key: "trim", label: "Trim" },
  { key: "stockNumber", label: "Stock #" },
  { key: "msrp", label: "MSRP", sortable: true },
];

describe("computeColWidths", () => {
  it("short values stay at the header width; long values grow", () => {
    const w = computeColWidths(cols, { dealerState: ["NJ", "NY"], dealerName: ["Joe Smith Toyota of Springfield"], trim: ["XLE"], stockNumber: ["A1"], msrp: ["$41,000"] });
    assert.equal(w.dealerState, headerWidth(cols[0]));
    assert.ok(w.dealerName > headerWidth(cols[1]) + 100);
  });

  it("caps at the column max so long text truncates", () => {
    const w = computeColWidths(cols, { dealerName: ["x".repeat(200)], trim: ["y".repeat(200)] });
    assert.equal(w.dealerName, 300);
    assert.equal(w.trim, 240);
  });

  it("a column blank on every row collapses to its header", () => {
    const w = computeColWidths(cols, { trim: ["", ""], msrp: [""] });
    assert.equal(w.trim, headerWidth(cols[2]));
    assert.equal(w.msrp, headerWidth(cols[4]));
  });

  it("sortable headers reserve room for the sort icon", () => {
    assert.ok(headerWidth({ key: "a", label: "Dealer", sortable: true }) > headerWidth({ key: "a", label: "Dealer" }));
  });

  it("prices and counts are right-aligned columns", () => {
    for (const k of ["price", "priceDiff", "msrp"]) assert.ok(NUMERIC_KEYS.has(k));
    assert.ok(!NUMERIC_KEYS.has("year"));
  });
});
