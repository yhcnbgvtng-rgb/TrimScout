import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareCells, isServerSortColumn, nextDir, parseServerSort, sortRows } from "./buyerTableSort";

describe("direction", () => {
  it("first click ascends, then flips", () => {
    assert.equal(nextDir(null), "asc");
    assert.equal(nextDir("asc"), "desc");
    assert.equal(nextDir("desc"), "asc");
  });
});

describe("server sort mapping", () => {
  it("knows which columns the box can sort", () => {
    for (const c of ["days", "year", "make", "model", "trim", "mileage", "price", "dealer"]) assert.equal(isServerSortColumn(c), true, c);
    for (const c of ["vin", "vehicleId", "ext", "int", "state", "contact", "distance", "listing", "pick"]) assert.equal(isServerSortColumn(c), false, c);
  });
  it("reads the active sort back from the query value", () => {
    assert.deepEqual(parseServerSort("price:desc"), { column: "price", dir: "desc" });
    assert.deepEqual(parseServerSort("days:asc"), { column: "days", dir: "asc" });
    assert.equal(parseServerSort("distance"), null);
    assert.equal(parseServerSort(""), null);
  });
});

describe("sortRows", () => {
  const rows = [{ id: "a", v: 30 }, { id: "b", v: null }, { id: "c", v: 5 }, { id: "d", v: 0 }, { id: "e", v: 30 }];
  it("high to low and low to high, blanks last in both, 0 is a real value", () => {
    assert.deepEqual(sortRows(rows, (r) => r.v, "asc").map((r) => r.id), ["d", "c", "a", "e", "b"]);
    assert.deepEqual(sortRows(rows, (r) => r.v, "desc").map((r) => r.id), ["a", "e", "c", "d", "b"]);
  });
  it("is stable for ties and does not mutate the input", () => {
    const copy = [...rows];
    sortRows(rows, (r) => r.v, "asc");
    assert.deepEqual(rows, copy);
  });
  it("text is case-insensitive and numeric-aware; empty strings are blanks", () => {
    const t = [{ s: "blue" }, { s: "Black" }, { s: "" }, { s: "Alpine 10" }, { s: "Alpine 9" }];
    assert.deepEqual(sortRows(t, (r) => r.s, "asc").map((r) => r.s), ["Alpine 9", "Alpine 10", "Black", "blue", ""]);
    assert.deepEqual(sortRows(t, (r) => r.s, "desc").map((r) => r.s), ["blue", "Black", "Alpine 10", "Alpine 9", ""]);
  });
  it("booleans (contact on file): Yes above No, unknown last", () => {
    const c = [{ c: false }, { c: null }, { c: true }];
    assert.deepEqual(sortRows(c, (r) => r.c, "desc").map((r) => r.c), [true, false, null]);
    assert.deepEqual(sortRows(c, (r) => r.c, "asc").map((r) => r.c), [false, true, null]);
  });
  it("compareCells treats two blanks as equal", () => assert.equal(compareCells(null, "", "asc"), 0));
});
