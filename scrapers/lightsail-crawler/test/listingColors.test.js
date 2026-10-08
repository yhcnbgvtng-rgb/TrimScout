import { test } from "node:test";
import assert from "node:assert/strict";
import { readLabeledColors, fillColorsFromLabels } from "../src/listingColors.js";

// Verbatim from three live NJ Ford VDPs, 2026-10-08.
const spec = (ext, int) => `<ul><li class="info__item info__item--color"><div class="info__details"> <span class="info__label">Exterior Color</span> <span class="info__value info__value--color" title="${ext}"> ${ext} </span> </div> </li> <li class="info__item info__item--color info__item--interior"> <div class="info__details"> <span class="info__label">Interior Color</span> <span class="info__value info__value--color" title="${int}"> ${int} </span> </div> </li></ul>`;

test("reads both labelled colours (Larson / Mahwah / Point Pleasant markup)", () => {
  assert.deepEqual(readLabeledColors(spec("Avalanche Gray", "Black Onyx")), { exteriorColor: "Avalanche Gray", interiorColor: "Black Onyx" });
  assert.deepEqual(readLabeledColors(spec("G1 Shadow Black", "Gw Alcantra Recaro Black Onyx")), { exteriorColor: "G1 Shadow Black", interiorColor: "Gw Alcantra Recaro Black Onyx" });
  assert.deepEqual(readLabeledColors(spec("Avalanche Gray", "Black Onyx W/Gray Accents")).interiorColor, "Black Onyx W/Gray Accents");
});

test("a page without the labelled fields, or with a placeholder value, gives null — nothing invented", () => {
  assert.deepEqual(readLabeledColors("<html><body>no colours here</body></html>"), { exteriorColor: null, interiorColor: null });
  assert.deepEqual(readLabeledColors(spec("N/A", "Unknown")), { exteriorColor: null, interiorColor: null });
  assert.deepEqual(readLabeledColors(""), { exteriorColor: null, interiorColor: null });
});

test("fills blanks only and never replaces a value another strategy found", () => {
  const html = spec("Avalanche Gray", "Black Onyx");
  const a = fillColorsFromLabels({ vin: "1FA6P8GJ1T5553496", exteriorColor: null, interiorColor: null }, html);
  assert.equal(a.exteriorColor, "Avalanche Gray");
  assert.equal(a.interiorColor, "Black Onyx");
  const b = fillColorsFromLabels({ vin: "1FA6P8GJ1T5553496", exteriorColor: "Race Red", interiorColor: null }, html);
  assert.equal(b.exteriorColor, "Race Red");
  assert.equal(b.interiorColor, "Black Onyx");
  assert.equal(fillColorsFromLabels(null, html), null);
});
