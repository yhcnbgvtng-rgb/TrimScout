import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  PORSCHE_ORDER_CODES,
  exteriorColorNameFor,
  isPorscheVehicle,
  porscheColorName,
  porscheExteriorColorName,
} from "./porscheColors";
import { PORSCHE_PAINT_CODES } from "./porscheColorCodes.generated";

const MACAN = "WP1AA2A53TLB07942";
const CAYENNE = "WP1AA2AY0TDA03090";
const FORD = "1FMWK8JCXTGB47204";

describe("porscheExteriorColorName", () => {
  it("names the doubled order code the dealer feed sends, whatever the case", () => {
    // Every one of these was seen live in the Paul Miller Porsche feed (2026-08/09).
    assert.equal(porscheExteriorColorName("0q0q"), "White");
    assert.equal(porscheExteriorColorName("A1a1"), "Black");
    assert.equal(porscheExteriorColorName("3h3h"), "Chalk");
    assert.equal(porscheExteriorColorName("2T2T"), "Jet Black Metallic");
    assert.equal(porscheExteriorColorName("0e0e"), "Chromite Black Metallic");
    assert.equal(porscheExteriorColorName("1h1h"), "Vanadium Grey Metallic");
    assert.equal(porscheExteriorColorName("F0F0"), "Dolomite Silver Metallic");
    assert.equal(porscheExteriorColorName("2h2h"), "Volcano Grey Metallic");
    assert.equal(porscheExteriorColorName("N4n4"), "Oak Green Metallic Neo");
    assert.equal(porscheExteriorColorName("O1O1"), "Lugano Blue");
    assert.equal(porscheExteriorColorName("9W9W"), "Napali Blue Metallic");
    assert.equal(porscheExteriorColorName("0T0T"), "Pale Blue Metallic");
    assert.equal(porscheExteriorColorName("8989"), "Paint to Sample");
  });

  it("names a bare order code or a full paint code", () => {
    assert.equal(porscheExteriorColorName("0Q"), "White");
    assert.equal(porscheExteriorColorName(" g7 "), "Ice Grey Metallic");
    assert.equal(porscheExteriorColorName("M9A"), "Chalk");
    assert.equal(porscheExteriorColorName("C9X"), "Jet Black Metallic");
    assert.equal(porscheExteriorColorName("M5C"), "Miami Blue");
    assert.equal(porscheExteriorColorName("39E"), "Riviera Blue");
    assert.equal(porscheColorName("84A"), "Guards Red");
  });

  it("leaves a real color name alone, including short ones that could pass for codes", () => {
    for (const name of ["Chalk", "Carrara White Metallic", "Black", "Red", "Tan", "Ice", "Paint to Sample", "Gentian Blue"]) {
      assert.equal(porscheExteriorColorName(name), name);
    }
    assert.equal(porscheExteriorColorName("  Jet  Black Metallic "), "Jet Black Metallic", "whitespace is tidied");
  });

  it("never invents a name for an unknown code — says which code it is, or passes it through", () => {
    assert.equal(porscheExteriorColorName("ZZ9ZZ9"), "ZZ9ZZ9", "not a code shape we recognize");
    assert.equal(porscheExteriorColorName("7Q7Q"), "Porsche paint code 7Q", "doubled, digit, unknown");
    assert.equal(porscheExteriorColorName("7Q"), "Porsche paint code 7Q");
    assert.equal(porscheExteriorColorName("000000"), "000000", "a junk feed value, not a code");
    assert.equal(porscheExteriorColorName(""), null);
    assert.equal(porscheExteriorColorName("   "), null);
    assert.equal(porscheExteriorColorName(null), null);
    assert.equal(porscheExteriorColorName(undefined), null);
  });

  it("the configurator's 2026 order codes are all present and the two tables agree where they overlap", () => {
    const configurator: Record<string, { name: string }> = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "data", "porsche_order_codes_configurator_2026.json"), "utf8")
    );
    for (const [code, entry] of Object.entries(configurator)) {
      assert.equal(PORSCHE_ORDER_CODES[code], entry.name, `order code ${code}`);
    }
    for (const code of Object.keys(PORSCHE_ORDER_CODES)) {
      if (code.length >= 3 && PORSCHE_PAINT_CODES[code]) {
        assert.equal(PORSCHE_PAINT_CODES[code], PORSCHE_ORDER_CODES[code], `paint code ${code}`);
      }
    }
    assert.ok(Object.keys(PORSCHE_PAINT_CODES).length > 700, "the generated paint-code table is populated");
  });
});

describe("exteriorColorNameFor", () => {
  it("only touches Porsches — by VIN or by make", () => {
    assert.equal(isPorscheVehicle({ vin: MACAN }), true);
    assert.equal(isPorscheVehicle({ vin: CAYENNE, make: "" }), true);
    assert.equal(isPorscheVehicle({ make: "Porsche" }), true);
    assert.equal(isPorscheVehicle({ make: "porsche" }), true);
    assert.equal(isPorscheVehicle({ vin: FORD, make: "Ford" }), false);
    assert.equal(isPorscheVehicle({}), false);
    assert.equal(exteriorColorNameFor({ vin: MACAN }, "0q0q"), "White");
    assert.equal(exteriorColorNameFor({ make: "Porsche" }, "0e0e"), "Chromite Black Metallic");
    assert.equal(exteriorColorNameFor({ vin: FORD, make: "Ford" }, "0q0q"), "0q0q", "a Ford's value is not ours to reinterpret");
    assert.equal(exteriorColorNameFor({ vin: FORD }, " Star White "), "Star White");
    assert.equal(exteriorColorNameFor({ vin: FORD }, ""), null);
    assert.equal(exteriorColorNameFor({ vin: FORD }, null), null);
  });
});
