import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jsonLdNodes, readJsonLdColors, fillColorsFromJsonLd } from "../src/jsonLdColors.js";
import { fillColorsFromLabels } from "../src/listingColors.js";

const VIN = "1FMJK1MG1VEA00001";
const sample = readFileSync(new URL("./fixtures/dealeron_vdp_color_sample.html", import.meta.url), "utf8");
const ld = (obj, attrs = 'type="application/ld+json"') => `<script ${attrs}>${JSON.stringify(obj)}</script>`;

test("DealerOn page: exterior comes from the sibling Product block, not the colourless Vehicle block", () => {
  assert.equal(jsonLdNodes(sample).length, 3);
  assert.deepEqual(readJsonLdColors(sample, { vin: VIN }), { exteriorColor: "Glacier Gray Metallic Tri-Coat", interiorColor: null });
});

test("a different car's Product block on the same page is never used", () => {
  const html = ld({ "@type": "Vehicle", name: "A", vehicleIdentificationNumber: VIN }) + ld({ "@type": "Product", name: "B", color: "Oxford White", sku: "X9" });
  assert.deepEqual(readJsonLdColors(html, { vin: VIN }), { exteriorColor: null, interiorColor: null });
});

test("vehicle plus labelled spec list gives both colours (JSON-LD exterior, page-HTML interior)", () => {
  const v = { vin: VIN, stockNumber: null, exteriorColor: null, interiorColor: null };
  fillColorsFromJsonLd(v, sample);
  fillColorsFromLabels(v, sample);
  assert.equal(v.exteriorColor, "Glacier Gray Metallic Tri-Coat");
  assert.equal(v.interiorColor, "Black Onyx");
});

test("never overwrites a non-blank value", () => {
  const v = { vin: VIN, exteriorColor: "Race Red", interiorColor: "Ebony" };
  fillColorsFromJsonLd(v, ld({ "@type": "Vehicle", vehicleIdentificationNumber: VIN, color: "Blue", vehicleInteriorColor: "Tan" }));
  assert.deepEqual([v.exteriorColor, v.interiorColor], ["Race Red", "Ebony"]);
  const w = { vin: VIN, exteriorColor: "Race Red", interiorColor: null };
  fillColorsFromJsonLd(w, ld({ "@type": "Vehicle", vehicleIdentificationNumber: VIN, color: "Blue", vehicleInteriorColor: "Tan" }));
  assert.deepEqual([w.exteriorColor, w.interiorColor], ["Race Red", "Tan"]);
});

test("generic: any block carrying the VIN works - @graph, array, single-quoted and reordered script attributes", () => {
  const graph = ld({ "@context": "x", "@graph": [{ "@type": "AutoDealer", name: "D" }, { "@type": ["Car", "Product"], vehicleIdentificationNumber: VIN, color: "Silver", vehicleInteriorColor: "Black" }] });
  assert.deepEqual(readJsonLdColors(graph, { vin: VIN }), { exteriorColor: "Silver", interiorColor: "Black" });
  const arr = `<script data-x="1" type='application/ld+json'>${JSON.stringify([{ "@type": "Product", vehicleIdentificationNumber: VIN, color: { "@type": "Thing", name: "Pearl" } }])}</script>`;
  assert.equal(readJsonLdColors(arr, { vin: VIN }).exteriorColor, "Pearl");
});

test("list page: ItemList entries are matched per VIN, so each car gets its own colour", () => {
  const OTHER = "1FMJK1MG1VEA00002";
  const list = ld({ "@type": "ItemList", itemListElement: [
    { "@type": "ListItem", position: 1, item: { "@type": "Car", vehicleIdentificationNumber: VIN, color: "Glacier Gray", vehicleInteriorColor: "Black Onyx" } },
    { "@type": "ListItem", position: 2, item: { "@type": "Car", vehicleIdentificationNumber: OTHER, color: "Oxford White" } },
  ] });
  assert.deepEqual(readJsonLdColors(list, { vin: VIN }), { exteriorColor: "Glacier Gray", interiorColor: "Black Onyx" });
  assert.deepEqual(readJsonLdColors(list, { vin: OTHER }), { exteriorColor: "Oxford White", interiorColor: null });
});

test("stock-number match works when the Vehicle block has none of its own colour and the caller knows the stock number", () => {
  const html = ld({ "@type": "Vehicle", vehicleIdentificationNumber: VIN, name: "N1" }) + ld({ "@type": "Product", name: "other wording", sku: "H0001", color: "Gray" });
  assert.equal(readJsonLdColors(html, { vin: VIN, stock: "h0001" }).exteriorColor, "Gray");
  assert.equal(readJsonLdColors(html, { vin: VIN, stock: "ZZZ" }).exteriorColor, null);
});

test("disagreeing blocks, placeholders and non-colour text give null (no guess)", () => {
  const two = ld({ "@type": "Vehicle", vehicleIdentificationNumber: VIN, color: "Red" }) + ld({ "@type": "Product", vehicleIdentificationNumber: VIN, color: "Blue" });
  assert.equal(readJsonLdColors(two, { vin: VIN }).exteriorColor, null);
  assert.equal(readJsonLdColors(ld({ "@type": "Vehicle", vehicleIdentificationNumber: VIN, color: "N/A", vehicleInteriorColor: "<script>x</script>" }), { vin: VIN }).exteriorColor, null);
  assert.deepEqual(readJsonLdColors("<html>no ld</html>", { vin: VIN }), { exteriorColor: null, interiorColor: null });
  assert.deepEqual(readJsonLdColors('<script type="application/ld+json">{bad</script>', { vin: VIN }), { exteriorColor: null, interiorColor: null });
  assert.deepEqual(readJsonLdColors(sample, {}), { exteriorColor: null, interiorColor: null });
});

test("CRAWLER_JSONLD_COLORS=false turns the fill off", () => {
  process.env.CRAWLER_JSONLD_COLORS = "false";
  try {
    const v = { vin: VIN, exteriorColor: null, interiorColor: null };
    fillColorsFromJsonLd(v, sample);
    assert.equal(v.exteriorColor, null);
  } finally {
    delete process.env.CRAWLER_JSONLD_COLORS;
  }
  assert.equal(fillColorsFromJsonLd(null, sample), null);
});
