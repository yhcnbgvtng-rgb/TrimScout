// Clickable column headers on /search: the click cycle, what each column sorts by, the guard rails, blanks last, locked order.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SORT_KEY_BY_COLUMN, activeSort, ariaSortFor, formatSort, isSortableColumn, nextSort, parseSort, sortBlockedReason, sortByDistance, FAST_WITHOUT_MODEL, SORT_TIMEOUT_NOTE, type SortableColumn } from "./buyerSort";

describe("the click cycle: ascending, then descending, then cleared", () => {
  it("first click ascending, second descending, third clears", () => {
    let sort = "";
    sort = nextSort(sort, "price"); assert.equal(sort, "price:asc");
    sort = nextSort(sort, "price"); assert.equal(sort, "price:desc");
    sort = nextSort(sort, "price"); assert.equal(sort, "");
    sort = nextSort(sort, "price"); assert.equal(sort, "price:asc", "and round again");
  });
  it("clicking a different column starts that column at ascending, whatever the current sort was", () => {
    assert.equal(nextSort("price:desc", "mileage"), "mileage:asc");
    assert.equal(nextSort("year:asc", "make"), "make:asc");
  });
  it("every sortable column cycles the same way and maps to the box's sort key", () => {
    for (const col of Object.keys(SORT_KEY_BY_COLUMN) as SortableColumn[]) {
      const key = SORT_KEY_BY_COLUMN[col];
      const first = nextSort("", col);
      assert.deepEqual(parseSort(first), { key, dir: "asc" }, col);
      const second = nextSort(first, col);
      assert.deepEqual(parseSort(second), { key, dir: "desc" }, col);
      assert.equal(nextSort(second, col), "", col);
    }
  });
  it("Distance keeps the existing 'distance' value for ascending (the Sort menu already uses it) and 'distance:desc' for descending", () => {
    assert.equal(nextSort("", "distance"), "distance");
    assert.equal(nextSort("distance", "distance"), "distance:desc");
    assert.equal(nextSort("distance:desc", "distance"), "");
    assert.deepEqual(parseSort("distance"), { key: "distance", dir: "asc" });
  });
  it("the Sort menu's own values are understood (price low→high, mileage, 'Newest to lot')", () => {
    assert.deepEqual(activeSort("price:asc"), { column: "price", dir: "asc" });
    assert.deepEqual(activeSort("mileage:asc"), { column: "mileage", dir: "asc" });
    assert.deepEqual(activeSort("days:asc"), { column: "days", dir: "asc" });
  });
});

describe("parsing is strict (the sort is user input)", () => {
  it("rejects empty, unknown keys, bad directions and injection attempts", () => {
    for (const bad of ["", null, undefined, "nope:asc", "price:sideways", "price:asc;DROP TABLE x", "i.price:asc", "price:asc:desc", "PRICE:asc", " price:asc"]) assert.equal(parseSort(bad as string), null, String(bad));
  });
  it("formatSort round-trips", () => {
    for (const s of ["price:asc", "price:desc", "vin:asc", "contact:desc", "distance", "distance:desc"]) assert.equal(formatSort(parseSort(s)!), s);
  });
});

describe("the arrow and aria-sort", () => {
  it("only the sorted column has an arrow/aria-sort; direction follows the sort", () => {
    assert.equal(ariaSortFor("price:asc", "price"), "ascending");
    assert.equal(ariaSortFor("price:desc", "price"), "descending");
    assert.equal(ariaSortFor("price:asc", "mileage"), "none");
    assert.equal(ariaSortFor("", "price"), "none");
    assert.equal(activeSort(""), null);
  });
});

describe("columns", () => {
  it("every table column except the checkbox is sortable; the checkbox column is not", () => {
    const view = fs.readFileSync(new URL("../components/BuyerSearchView.tsx", import.meta.url), "utf8");
    const block = view.slice(view.indexOf("const TABLE_COLUMNS"), view.indexOf("const ROW_H"));
    const keys = [...block.matchAll(/\{ key: "(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(keys, ["pick", "days", "vehicleId", "vin", "year", "make", "model", "trim", "ext", "int", "mileage", "price", "dealer", "state", "contact", "listing", "distance"], "the locked column order");
    for (const k of keys) assert.equal(isSortableColumn(k), k !== "pick", k);
  });
});

describe("guard rails for slow sorts", () => {
  it("fast columns sort a whole make; every other column needs a model", () => {
    for (const col of ["dealer", "make", "vin", "contact", "distance"] as SortableColumn[]) assert.equal(sortBlockedReason(col, false, col), null, col);
    for (const col of ["price", "year", "mileage", "days", "model", "trim", "ext", "int", "state", "listing", "vehicleId"] as SortableColumn[]) {
      assert.match(sortBlockedReason(col, false, "Price") ?? "", /^Pick a model to sort by Price/, col);
      assert.equal(sortBlockedReason(col, true, "Price"), null, `${col} with a model`);
    }
    assert.deepEqual([...FAST_WITHOUT_MODEL].sort(), ["contact", "dealer", "distance", "make", "vin"]);
  });
  it("the timeout note names the column and says what to do", () => {
    assert.match(SORT_TIMEOUT_NOTE("Price"), /Sorting by Price took too long.*Narrow the search/);
  });
});

describe("Distance (no database column): blanks last in both directions, stable", () => {
  const rows = [{ id: "a", distanceMiles: 30 }, { id: "b", distanceMiles: null }, { id: "c", distanceMiles: 5 }, { id: "d", distanceMiles: null }, { id: "e", distanceMiles: 5 }];
  it("ascending: nearest first, then blanks", () => assert.deepEqual(sortByDistance(rows, "asc").map((r) => r.id), ["c", "e", "a", "b", "d"]));
  it("descending: farthest first, blanks STILL last", () => assert.deepEqual(sortByDistance(rows, "desc").map((r) => r.id), ["a", "c", "e", "b", "d"]));
  it("does not mutate its input", () => { const copy = rows.map((r) => ({ ...r })); sortByDistance(rows, "desc"); assert.deepEqual(rows, copy); });
});
