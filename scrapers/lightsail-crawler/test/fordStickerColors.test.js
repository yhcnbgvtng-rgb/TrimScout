import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseStickerColors, stickerUrlForVin } from "../src/fordStickerColors.js";

// "VEHICLE DESCRIPTION" blocks cut from real Ford Direct stickers (fetched 2026-10-08), 47 VINs across Mustang, F-150, Super Duty,
// Transit, Explorer, Expedition, Escape, Bronco, Bronco Sport, Ranger, Maverick and Mach-E.
const FX = JSON.parse(fs.readFileSync(new URL("./fixtures_ford_sticker_descriptions.json", import.meta.url), "utf8"));

test("the seven Mustangs from the bug report", () => {
  const want = {
    "1FA6P8TH4T5136280": ["Shadow Black", "Emberglo Activex Trm"],
    "1FA6P8TH3T5135685": ["Shadow Black", "Black Onyx Cloth/Vinyl Trim"],
    "1FA6P8TH2T5134897": ["Avalanche Gray", "Black Onyx Cloth Seats"],
    "1FA6P8TH8T5134676": ["Race Red", "Space Gray Cloth Seats"],
    "1FA6P8GJ3T5551197": ["Shadow Black", "Black Onyx Lth-Trm Recro"],
    "1FA6P8GJ6T5552487": ["Avalanche Gray", "Black Onyx Leather-Trimmed"],
    "1FA6P8GJ1T5553496": ["Avalanche Gray", "Black Onyx Lth-Trm Recro"],
  };
  for (const [vin, [ext, int]] of Object.entries(want)) {
    const r = parseStickerColors(FX[vin]);
    assert.equal(r.exteriorColor, ext, `${vin} exterior`);
    assert.equal(r.interiorColor, int, `${vin} interior`);
  }
});

test("paint comes out clean for every lead-in shape (passengers, sports car, wheelbase, WB/STYLESIDE, trim-passenger)", () => {
  const ext = (vin) => parseStickerColors(FX[vin]).exteriorColor;
  assert.equal(ext("1FMCU9GN4TUA05685"), "Agate Black Metallic"); // 106.7" WHEELBASE <paint>
  assert.equal(ext("1FT8W2BMXTEE84067"), "Argon Blue Metallic"); // XLT 160" WB STYLESIDE <paint>
  assert.equal(ext("1FBAX2C82TKA72828"), "Oxford White"); // XL TRIM 148" WB <paint>
  assert.equal(ext("1FTBR1C80TKB20296"), "Oxford White"); // 2 PASSENGER 148" WB <paint>
  assert.equal(ext("1FMDE7BH8TLB54534"), "Shadow Black"); // BIG BEND - 5 PASSENGER <paint>
  assert.equal(ext("1FMJU1J81TEA43929"), "Star White Met Tri-Coat"); // ACTIVE 8-PASSENGER <paint>, as Ford prints it
  assert.equal(ext("3FMTK4SX5TMA14708"), "Desert Sand"); // 5-PASSENGER <paint>
});

test("interior comes out after every transmission wording", () => {
  const int = (vin) => parseStickerColors(FX[vin]).interiorColor;
  assert.equal(int("1FMCU9NZ6TUA41819"), "Ebny Part Vnl/Clth&red Stch"); // ECVT TRANSMISSION <trim>, as printed
  assert.equal(int("1FMJU1J81TEA43929"), "Ultra Dark Space Gray Activ"); // 10SPD AUTO TRANS W/SLCTSHFT <trim>
  assert.equal(int("1FTEW2LP1TKF03974"), "Black Stx Cloth 40/Con/40"); // ELEC TEN-SPEED AUTO TRANS <trim>
  assert.equal(int("1FT8W2BM0TEE80464"), "Medium Dark Slate Cloth"); // 10-SPEED AUTO TORQSHIFT <trim>
  assert.equal(int("3FTTW8S30TRB60255"), "Navy Pier - Black Onyx"); // POWER-SPLIT ELECTRIC CVT <trim>
  assert.equal(int("3FMTK4SX3TMA15484"), "Prfm Gray Activex Trimmed"); // SINGLE-SPEED TRANSMISSION <trim>
});

test("every real sticker in the sample parses to both colours", () => {
  for (const [vin, text] of Object.entries(FX)) {
    const r = parseStickerColors(text);
    assert.ok(r.exteriorColor, `${vin} exterior`);
    assert.ok(r.interiorColor, `${vin} interior`);
  }
});

test("a sticker that is not the expected shape is a miss, never a guess", () => {
  assert.deepEqual(parseStickerColors(""), { exteriorColor: null, interiorColor: null });
  assert.deepEqual(parseStickerColors("This vehicle has not been released yet"), { exteriorColor: null, interiorColor: null });
  // exterior line without a recognisable lead-in; interior line without transmission words
  assert.deepEqual(parseStickerColors("VEHICLE DESCRIPTION\nMUSTANG\n2026 ECOBOOST COUPE EXTERIOR\nSHADOW BLACK\n2.3L ECOBOOST INTERIOR\nBLACK ONYX"), { exteriorColor: null, interiorColor: null });
  // barcode noise on the line
  assert.deepEqual(parseStickerColors("VEHICLE DESCRIPTION\nX\n2026 A EXTERIOR\n4-PASSENGER ƬŏƘūżŜ\n2.3L INTERIOR\n10-SPD AUTO TRANSMISSION ĬēĂĐċ").exteriorColor, null);
});

test("sticker URL is the public VIN lookup", () => {
  assert.equal(stickerUrlForVin("1fa6p8th4t5136280"), "https://www.windowsticker.forddirect.com/windowsticker.pdf?vin=1FA6P8TH4T5136280");
});
