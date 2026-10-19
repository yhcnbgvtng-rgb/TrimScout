import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { paidOnlyEnabled, positivePrice, paidSql, paidFacetCounts, maxPrice } from "../src/optionsPaidOnlyServer.js";
import { optionRowsFromOptions, buyerOptionCatalog } from "../src/inventoryOptionRows.js";
import { diffOptionSets, groupExistingOptionRows } from "../src/inventoryOptionsDiff.js";
import { createSummaryAccumulator, summaryToQueryRows } from "../src/catalogSummary.js";

const rows = (options, withPrice = true) => optionRowsFromOptions(options, { withPrice, junkRules: null }).rows;
const byKey = (rs) => Object.fromEntries(rs.map((r) => [r.key, r]));

test("flag parsing: off unless explicitly on", () => {
  for (const v of [undefined, "", "0", "false", "off", "no", "banana"]) assert.equal(paidOnlyEnabled({ OPTIONS_PAID_ONLY: v }), false, String(v));
  for (const v of ["1", "true", "TRUE", "yes", "on", " On "]) assert.equal(paidOnlyEnabled({ OPTIONS_PAID_ONLY: v }), true, v);
  assert.equal(paidOnlyEnabled({}), false);
});

test("positivePrice: only a price above 0 counts", () => {
  assert.equal(positivePrice(1225), 1225);
  assert.equal(positivePrice("$1,225"), 1225);
  assert.equal(positivePrice(0), null);
  assert.equal(positivePrice("$0"), null);
  assert.equal(positivePrice(-5), null);
  assert.equal(positivePrice(null), null);
  assert.equal(positivePrice(undefined), null);
  assert.equal(positivePrice(NaN), null);
  assert.equal(positivePrice("call"), null);
  assert.equal(maxPrice(null, 500), 500);
  assert.equal(maxPrice(0, null), 0);
});

test("a label paid on one car and $0 on another is decided per row, not per label", () => {
  const carA = rows([{ name: "Panoramic Roof", price: 1500 }]);
  const carB = rows([{ name: "Panoramic Roof", price: 0 }]);
  const carC = rows([{ name: "Panoramic Roof", price: 900 }]);
  assert.equal(carA[0].price, 1500);
  assert.equal(carB[0].price, null);
  const counts = paidFacetCounts([carA, carB, carC]);
  assert.equal(counts.length, 1);
  assert.equal(counts[0].n, 2); // the $0 car is not counted, the label is not dropped
  assert.equal(counts[0].minPrice, 900);
  assert.equal(counts[0].maxPrice, 1500);
});

test("a label that is $0 on every car never appears", () => {
  const counts = paidFacetCounts([rows([{ name: "Floor Mats", price: 0 }]), rows([{ name: "Floor Mats", price: 0 }])]);
  assert.deepEqual(counts, []);
});

test("a row with no stored price (not backfilled) is not counted as paid", () => {
  assert.deepEqual(paidFacetCounts([[{ key: "tow package", label: "Tow Package", price: null }, { key: "tow package", label: "Tow Package" }]]), []);
});

test("two lines of one key on one car keep the paid one; a joined list gets no price", () => {
  assert.equal(rows([{ name: "Tow Package", price: 0 }, { name: "Tow Package", price: 650 }])[0].price, 650);
  const joined = rows([{ name: "Heated Seats | Heated Steering Wheel", price: 800 }]);
  assert.ok(joined.every((r) => r.price == null));
});

test("flag off: rows have exactly the shape they always had", () => {
  const off = rows([{ name: "Panoramic Roof", price: 1500 }], false);
  assert.deepEqual(Object.keys(off[0]).sort(), ["code", "key", "label"]);
});

test("SQL fragments: empty when off, per-row price test when on", () => {
  assert.deepEqual(paidSql(false), { where: "", select: "" });
  const on = paidSql(true);
  assert.equal(on.where, " AND o.price > 0");
  assert.match(on.select, /MIN\(o\.price\) AS min_price, MAX\(o\.price\) AS max_price/);
});

test("deals_api_server: flag-off rebuild/insert/select text is the original, the paid text is gated", () => {
  const src = fs.readFileSync(new URL("../src/deals_api_server.js", import.meta.url), "utf8");
  assert.match(src, /const PAID_ONLY = paidOnlyEnabled\(\);/);
  assert.ok(src.includes('else await pool.query("INSERT INTO dealer_inventory_options (vin, dealer_id, canonical_key, label, code) VALUES ? ON DUPLICATE KEY UPDATE label = VALUES(label), code = VALUES(code)"'));
  assert.ok(src.includes("${paid.where}"), "rebuild adds the per-row price test through paidSql");
  assert.ok(src.includes('if (PAID_ONLY) {\n    // Nullable columns'), "DDL only runs with the flag on");
  assert.ok(src.includes('SELECT vin, dealer_id, canonical_key, label, code${PAID_ONLY ? ", price" : ""}'));
});

test("diff: a changed price rewrites the car only when prices are compared", () => {
  const existing = groupExistingOptionRows([{ vin: "V", dealer_id: 1, canonical_key: "roof", label: "Roof", code: null, price: null }]);
  const desired = [{ pair: "V|1", rows: [{ key: "roof", label: "Roof", code: null, price: 1500 }] }];
  assert.deepEqual(diffOptionSets(desired, existing).changed, []); // flag off: price never compared
  assert.deepEqual(diffOptionSets(desired, existing, { comparePrice: true }).changed, ["V|1"]);
  const same = groupExistingOptionRows([{ vin: "V", dealer_id: 1, canonical_key: "roof", label: "Roof", code: null, price: 1500 }]);
  assert.deepEqual(diffOptionSets(desired, same, { comparePrice: true }).changed, []);
});

test("summary accumulator keeps min/max price across makes and only adds them when asked", () => {
  const acc = createSummaryAccumulator();
  acc.addOptions([{ canonical_key: "roof", label: "Roof", n: 30, min_price: 900, max_price: 1500 }]);
  acc.addOptions([{ canonical_key: "roof", label: "Roof", n: 10, min_price: 700, max_price: 1200 }]);
  assert.deepEqual(acc.result({ minVehicles: 25, paidPrices: true }).optionRows, [["roof", "Roof", 40, 700, 1500]]);
  assert.deepEqual(acc.result({ minVehicles: 25 }).optionRows, [["roof", "Roof", 40]]);
  const q = summaryToQueryRows({ options: [{ canonical_key: "roof", label: "Roof", vehicle_count: 40, min_price: 700, max_price: 1500 }], colors: [] });
  assert.equal(q.optionRows[0].min_price, 700);
  assert.deepEqual(summaryToQueryRows({ options: [{ canonical_key: "roof", label: "Roof", vehicle_count: 40 }], colors: [] }).optionRows[0], { canonical_key: "roof", label: "Roof", vehicleCount: 40 });
});

test("catalog endpoint output: price range only when the rebuild stored one", () => {
  const withPrice = buyerOptionCatalog([{ canonical_key: "panoramic roof", label: "Panoramic Roof", vehicleCount: 50, min_price: 900, max_price: 1500 }]);
  assert.equal(withPrice[0].minPrice, 900);
  assert.equal(withPrice[0].maxPrice, 1500);
  const without = buyerOptionCatalog([{ canonical_key: "panoramic roof", label: "Panoramic Roof", vehicleCount: 50 }]);
  assert.deepEqual(Object.keys(without[0]).sort(), ["key", "label", "vehicleCount"]);
});

test("empty paid set: the endpoint returns no options (the UI shows its empty state)", () => {
  assert.deepEqual(buyerOptionCatalog([]), []);
});
