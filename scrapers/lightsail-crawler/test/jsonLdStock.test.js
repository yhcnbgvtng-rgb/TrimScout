import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readJsonLdStock, fillStockFromJsonLd } from "../src/jsonLdStock.js";
import { readJsonLdColors, fillColorsFromJsonLd } from "../src/jsonLdColors.js";
import { findVehicleLd } from "../src/porscheSchemaOrgFields.js";

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const dealerOn = fx("dealeron_vdp_color_sample.html");
const velocity = fx("team_velocity_graph_vdp_sample.html");
const dealerCom = fx("dealercom_flat_car_vdp_sample.html");
const DEALERON_VIN = "1FMJK1MG1VEA00001";
const TV_VIN = "2T3EXAMPLEVIN0001";
const DC_VIN = "4T1EXAMPLEVIN0002";
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

// The exact block scan extractSchemaOrgVehicle() runs in standalone.js.
function strategy2Blocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((b) => JSON.parse(b[1]));
}

test("DealerOn: stock number comes from the Product block's sku (the Vehicle block has none)", () => {
  assert.equal(readJsonLdStock(dealerOn, { vin: DEALERON_VIN }), "H0001");
});

test("Team Velocity: the @graph Vehicle is found by the schema.org strategy and carries sku / colours / price", () => {
  const blocks = strategy2Blocks(velocity);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]["@type"], undefined, "top-level object has no @type - the pre-#353 check could never match");
  assert.equal(findVehicleLd(blocks[0], { graph: false }), null, "old top-level-only behaviour (CRAWLER_SCHEMA_GRAPH=false) misses it");
  const car = findVehicleLd(blocks[0]);
  assert.equal(car.vehicleIdentificationNumber, TV_VIN);
  assert.equal(car.offers.price, "35599");
  assert.equal(readJsonLdStock(velocity, { vin: TV_VIN }), "TC45J091");
  assert.deepEqual(readJsonLdColors(velocity, { vin: TV_VIN }), { exteriorColor: "Meteor Shower", interiorColor: "Black fabric" });
});

test("Dealer.com-style flat Car: sku read, and the unrelated Product tile's sku is not used", () => {
  assert.equal(readJsonLdStock(dealerCom, { vin: DC_VIN }), "T26-0412");
  assert.equal(findVehicleLd(strategy2Blocks(dealerCom)[0]).vehicleIdentificationNumber, DC_VIN);
});

test("fills a blank only and never replaces a stock number another strategy found", () => {
  const blank = fillStockFromJsonLd({ vin: TV_VIN, stockNumber: null }, velocity);
  assert.equal(blank.stockNumber, "TC45J091");
  assert.equal(fillStockFromJsonLd({ vin: TV_VIN, stockNumber: "  " }, velocity).stockNumber, "TC45J091");
  assert.equal(fillStockFromJsonLd({ vin: TV_VIN, stockNumber: "DDC-77" }, velocity).stockNumber, "DDC-77");
  assert.equal(fillStockFromJsonLd(null, velocity), null);
  assert.equal(fillStockFromJsonLd({ stockNumber: null }, velocity).stockNumber, null, "no VIN, no match");
});

test("productID (the VIN on Team Velocity), a VIN-shaped sku, placeholders and URLs are never taken as a stock number", () => {
  const vin = "1FMJK1MG1VEA00009";
  assert.equal(readJsonLdStock(ld({ "@type": "Vehicle", vehicleIdentificationNumber: vin, productID: "ABC123" }), { vin }), null);
  assert.equal(readJsonLdStock(ld({ "@type": "Vehicle", vehicleIdentificationNumber: vin, sku: vin }), { vin }), null);
  assert.equal(readJsonLdStock(ld({ "@type": "Vehicle", vehicleIdentificationNumber: vin, sku: "1FMJK1MG1VEA00010" }), { vin }), null);
  assert.equal(readJsonLdStock(ld({ "@type": "Vehicle", vehicleIdentificationNumber: vin, sku: "N/A" }), { vin }), null);
  assert.equal(readJsonLdStock(ld({ "@type": "Vehicle", vehicleIdentificationNumber: vin, sku: "https://x.test/a" }), { vin }), null);
  assert.equal(readJsonLdStock(ld({ "@type": "Vehicle", vehicleIdentificationNumber: vin, stockNumber: 48213 }), { vin }), "48213");
});

test("matching nodes that disagree give null; a re-cased duplicate agrees", () => {
  const vin = "1FMJK1MG1VEA00009";
  const two = ld({ "@type": "Vehicle", vehicleIdentificationNumber: vin, sku: "A100" }) + ld({ "@type": "Product", vehicleIdentificationNumber: vin, sku: "B200" });
  assert.equal(readJsonLdStock(two, { vin }), null);
  const same = ld({ "@type": "Vehicle", vehicleIdentificationNumber: vin, sku: "a100" }) + ld({ "@type": "Product", vehicleIdentificationNumber: vin, sku: "A100" });
  assert.equal(readJsonLdStock(same, { vin }), "a100");
});

test("no JSON-LD, bad JSON, or no VIN gives null", () => {
  assert.equal(readJsonLdStock("<html></html>", { vin: TV_VIN }), null);
  assert.equal(readJsonLdStock('<script type="application/ld+json">{bad</script>', { vin: TV_VIN }), null);
  assert.equal(readJsonLdStock(velocity, {}), null);
});

test("CRAWLER_JSONLD_STOCK=false turns the stock fill off; CRAWLER_JSONLD_COLORS is independent", () => {
  process.env.CRAWLER_JSONLD_STOCK = "false";
  try {
    assert.equal(fillStockFromJsonLd({ vin: TV_VIN, stockNumber: null }, velocity).stockNumber, null);
    assert.equal(fillColorsFromJsonLd({ vin: TV_VIN, exteriorColor: null, interiorColor: null }, velocity).exteriorColor, "Meteor Shower");
  } finally {
    delete process.env.CRAWLER_JSONLD_STOCK;
  }
});
