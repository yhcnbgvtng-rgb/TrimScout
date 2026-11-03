import test from "node:test";
import assert from "node:assert/strict";
import { FIT_MAX_PX, FIT_MIN_PX, fitColumnWidth, growOnly, maxCellPx } from "./searchColumnFit";

const base = { key: "x", headerPx: 30, sortable: false, cellPx: 20 };

test("short content is held at the minimum", () => assert.equal(fitColumnWidth(base), FIT_MIN_PX));
test("width follows the widest cell plus padding", () => assert.equal(fitColumnWidth({ ...base, cellPx: 100.2 }), 122));
test("a sortable header makes room for the arrow", () => assert.equal(fitColumnWidth({ ...base, headerPx: 90, sortable: true }), 127));
test("long text stops at the max", () => assert.equal(fitColumnWidth({ ...base, cellPx: 900 }), FIT_MAX_PX));
test("a noMax column (VIN) keeps its natural width", () => assert.equal(fitColumnWidth({ ...base, cellPx: 900, noMax: true }), 921));
test("fixed columns are not measured", () => assert.equal(fitColumnWidth({ ...base, fixedW: 40, cellPx: 900 }), 40));
test("maxCellPx measures each distinct string once", () => {
  let calls = 0;
  const w = maxCellPx(["a", "bbb", "a", "", "bbb"], (s) => { calls++; return s.length * 7; });
  assert.equal(w, 21);
  assert.equal(calls, 2);
});
test("growOnly never shrinks a column and drops no new one", () => {
  assert.deepEqual(growOnly({ a: 100, b: 90 }, { a: 80, b: 120, c: 70 }), { a: 100, b: 120, c: 70 });
  assert.deepEqual(growOnly(null, { a: 80 }), { a: 80 });
});
