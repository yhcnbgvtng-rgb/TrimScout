import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { optionRowsFromOptions, normalizeOptionKey } from "../src/inventoryOptionRows.js";
import { normalizeModelForWrite, isMazdaAccessoryName, mazdaPaint, dropMazdaRow, prepareMazdaOptions, prepareMazdaVehicle } from "../src/mazdaPaidOptions.js";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/mazda_paid_options.json", import.meta.url), "utf8"));
const car = (n) => fixture.cars[n - 1];
const rowsFor = (c) => optionRowsFromOptions(prepareMazdaOptions(c.options), { withPrice: true, junkRules: null }).rows;
const labels = (rs) => rs.map((r) => r.label).sort();

test("fixture VINs are masked", () => {
  for (const c of fixture.cars) assert.match(c.vin, /^JM1X{9}\d{5}$/);
});

test("accessories are dropped, factory package kept", () => {
  const rs = rowsFor(car(1));
  assert.deepEqual(labels(rs), ["Machine Gray Paint", "Preferred Package"]);
  assert.equal(rs.find((r) => r.label === "Preferred Package").price, 1400);
});

test("every accessory in the dry run's top 20 is recognised by name alone", () => {
  for (const n of ["Cargo Tray", "Cargo Package", "Cargo Net", "Cargo Mat", "Carpet Cargo Mat", "Black Lug Nuts and Black Wheel Locks", "Black Lug Nuts & Black Wheel Locks", "Splash Guards", "Door Sill Plates", "Cargo Cover"]) {
    assert.equal(isMazdaAccessoryName(n), true, n);
  }
});

test("paint labels merge to one row per colour with one price; & and and are the same", () => {
  const rs = rowsFor(car(2)).filter((r) => /Paint$/.test(r.label));
  assert.equal(rs.length, 1); // three spellings of Soul Red Crystal, one row, one price
  assert.equal(rs[0].price, 595);
  assert.equal(normalizeOptionKey(rs[0].label), rs[0].key);
});

test("Weather Package: dropped by default, kept only when the feed says factory", () => {
  assert.equal(dropMazdaRow("Weather Package", undefined), true);
  assert.equal(dropMazdaRow("Weather Package", "dealer"), true);
  assert.equal(dropMazdaRow("Weather Package", "factory"), false);
  assert.equal(dropMazdaRow("All-Weather Liner Package", undefined), false); // not an accessory name we list: left to the other rules
});

test("colour variants collapse: Paint, Paint Charge, Metallic, Premium Paint Charge", () => {
  const rs = rowsFor(car(3));
  assert.deepEqual(labels(rs), ["Polymetal Gray Paint", "Rhodium White Paint", "Snowflake White Pearl Mica Paint"]);
  assert.equal(rs.find((r) => r.label === "Rhodium White Paint").price, 595);
  assert.equal(rs.find((r) => r.label === "Snowflake White Pearl Mica Paint").price, 395);
  const key = (l) => mazdaPaint(l).key;
  assert.equal(key("Machine Gray Metallic Paint Charge"), key("Machine Gray Metallic"));
  assert.equal(key("Machine Gray Metallic Paint"), key("Machine Gray Metallic"));
  assert.equal(mazdaPaint("Black & White Metallic Paint").key, mazdaPaint("Black and White Metallic Paint Charge").key);
});

test("kind:'dealer' drops the row, except paint", () => {
  const rs = rowsFor(car(2));
  assert.deepEqual(labels(rs), ["Soul Red Crystal Paint", "Weather Package"]);
  assert.equal(rs.find((r) => r.label === "Soul Red Crystal Paint").price, 595);
  assert.equal(dropMazdaRow("Fancy Spoiler", "dealer"), true);
  assert.equal(dropMazdaRow("Fancy Spoiler", "factory"), false);
  assert.equal(dropMazdaRow("Fancy Spoiler", undefined), false);
});

test("non-paint names are not mistaken for paint", () => {
  for (const n of ["Premium Paint Charge", "Paint Charge", "Metallic", "Premium Package", "Preferred Package", "Rhodium White Premium"]) assert.equal(mazdaPaint(n), null, n);
});

test("other makes and flag-off vehicles are untouched; policy-covered cars keep their options", () => {
  const opts = [{ name: "Cargo Tray", price: 150, kind: "dealer" }, { name: "Machine Gray Metallic Paint Charge", price: 595 }];
  const none = { models: new Map() };
  const toyota = { make: "Toyota", model: "Mazda CX-5", options: opts };
  assert.equal(prepareMazdaVehicle(toyota, { make: "Toyota", allowlist: none, paidOnly: true }).options, opts);
  assert.equal(toyota.model, "Mazda CX-5");
  const off = prepareMazdaVehicle({ model: "Mazda CX-5", options: opts }, { make: "Mazda", allowlist: none, paidOnly: false });
  assert.equal(off.options, opts); // flag off: options as given
  assert.equal(off.model, "CX-5"); // model name is fixed either way
  const on = prepareMazdaVehicle({ model: "Mazda CX-5", options: opts }, { make: "Mazda", allowlist: none, paidOnly: true });
  assert.deepEqual(on.options.map((o) => o.name), ["Machine Gray Paint"]);
  assert.equal(opts[1].name, "Machine Gray Metallic Paint Charge"); // input not mutated
});

test("a joined list is left alone", () => {
  const joined = { name: "Cargo Tray; Cargo Net", price: 0 };
  assert.deepEqual(prepareMazdaOptions([joined]), [joined]);
});

test("model names: Mazda prefix removed, other makes and bare 'Mazda' unchanged", () => {
  assert.equal(normalizeModelForWrite({ make: "Mazda", model: "Mazda CX-5" }), "CX-5");
  assert.equal(normalizeModelForWrite({ make: "Mazda", model: "  mazda   MX-5 " }), "MX-5");
  assert.equal(normalizeModelForWrite({ make: "Mazda", model: "CX-5" }), "CX-5");
  assert.equal(normalizeModelForWrite({ make: "Mazda", model: "Mazda3 Sedan" }), "Mazda3 Sedan");
  assert.equal(normalizeModelForWrite({ make: "Mazda", model: "Mazda" }), "Mazda");
  assert.equal(normalizeModelForWrite({ make: "Toyota", model: "Mazda CX-5" }), "Mazda CX-5");
});
