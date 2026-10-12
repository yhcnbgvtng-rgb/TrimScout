import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyRows, namedCaseReport, renderReport } from "../lib/junkPriceReport.mjs";

const row = (o) => ({ vin: "V" + Math.random().toString(36).slice(2, 8), dealer_id: 1, dealer_name: "Some Dealer", state: "CA", year: 2026, msrp: null, old_price: null, ...o });
const ROWS = [
  row({ vin: "PAL", dealer_name: "Hyundai of Downtown LA", make: "Hyundai", model: "Palisade", price: 1_250_000, msrp: 52_000 }),
  row({ vin: "IO9", dealer_name: "Hyundai of Downtown LA", make: "Hyundai", model: "IONIQ 9", price: 1_620_000 }),
  row({ vin: "BRS", state: "PA", make: "Ford", model: "Bronco Sport", price: 3_600_000 }),
  row({ vin: "EXP", state: "OH", make: "Ford", model: "Explorer", price: 660_740, msrp: 66_074 }),
  row({ vin: "PRV", make: "Prevost", model: "H3-45", price: 3_500_000 }),
  row({ vin: "OK1", make: "Porsche", model: "911 GT3 RS", price: 410_000 }),
  row({ vin: "OK2", make: "Ford", model: "F-250", price: 98_000, msrp: 90_000 }),
];

test("the dry run flags exactly the junk rows and leaves real expensive cars alone", () => {
  const r = classifyRows(ROWS);
  assert.deepEqual(r.flagged.map((f) => f.vin), ["BRS", "PRV", "IO9", "PAL", "EXP"], "highest price first");
  assert.equal(r.scanned, 7);
  assert.equal(r.byReason["over-make-ceiling"], 3, "Bronco Sport, Prevost, IONIQ 9 have no MSRP to compare with");
  assert.equal(r.byReason["over-5x-msrp"], 2, "Palisade (msrp 52k) and Explorer (msrp 66k) are caught by the ratio first");
  assert.equal(r.byMake.Hyundai, 2);
});

test("every reported case is found, and a missed one is called out", () => {
  const r = classifyRows(ROWS);
  const named = namedCaseReport(r.flagged, ROWS);
  assert.ok(named.every((n) => n.flagged === 1 && n.missed === 0), JSON.stringify(named));
  const missed = namedCaseReport([], ROWS);
  assert.ok(missed.every((n) => n.flagged === 0 && n.missed === 1));
  assert.match(renderReport(r, named, { inStock: 1_400_000, minPrice: 75_000 }), /Rows the guard would reject: 5/);
});

test("the script is read-only by construction", () => {
  const src = readFileSync(new URL("./2026-10-12-junk-price-dry-run.mjs", import.meta.url), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.match(src, /DB_READER_USER/);
  assert.doesNotMatch(src, /DB_WRITER/);
  assert.match(src, /SET SESSION TRANSACTION READ ONLY/);
  assert.match(src, /max_statement_time=\$\{CAP_SECONDS\}/);
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|REPLACE)\b\s+(INTO|FROM|TABLE|dealer_inventory)/i);
  assert.doesNotMatch(src, /GET_LOCK|sync.?lock|pm2|systemctl/i);
});
