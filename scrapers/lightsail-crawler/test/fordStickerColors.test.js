import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeExterior, normalizeInterior, parseStickerColors, stickerUrlForVin } from "../src/fordStickerColors.js";

// "VEHICLE DESCRIPTION" blocks cut from real Ford Direct stickers (fetched 2026-10-08), 47 VINs across Mustang, F-150, Super Duty,
// Transit, Explorer, Expedition, Escape, Bronco, Bronco Sport, Ranger, Maverick and Mach-E.
const NONE = { exteriorColor: null, interiorColor: null, exteriorRaw: null, interiorRaw: null };
const FX = JSON.parse(fs.readFileSync(new URL("./fixtures_ford_sticker_descriptions.json", import.meta.url), "utf8"));

test("the seven Mustangs from the bug report", () => {
  const want = {
    "1FA6P8TH4T5136280": ["Shadow Black", "Emberglo", "Emberglo Activex Trm"],
    "1FA6P8TH3T5135685": ["Shadow Black", "Black Onyx", "Black Onyx Cloth/Vinyl Trim"],
    "1FA6P8TH2T5134897": ["Avalanche Gray", "Black Onyx", "Black Onyx Cloth Seats"],
    "1FA6P8TH8T5134676": ["Race Red", "Space Gray", "Space Gray Cloth Seats"],
    "1FA6P8GJ3T5551197": ["Shadow Black", "Black Onyx", "Black Onyx Lth-Trm Recro"],
    "1FA6P8GJ6T5552487": ["Avalanche Gray", "Black Onyx", "Black Onyx Leather-Trimmed"],
    "1FA6P8GJ1T5553496": ["Avalanche Gray", "Black Onyx", "Black Onyx Lth-Trm Recro"],
  };
  for (const [vin, [ext, int, raw]] of Object.entries(want)) {
    const r = parseStickerColors(FX[vin]);
    assert.equal(r.exteriorColor, ext, `${vin} exterior`);
    assert.equal(r.interiorColor, int, `${vin} interior`);
    assert.equal(r.interiorRaw, raw, `${vin} interior as printed is kept for audit`);
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
  const raw = (vin) => parseStickerColors(FX[vin]).interiorRaw;
  assert.equal(raw("1FMCU9NZ6TUA41819"), "Ebny Part Vnl/Clth&red Stch"); // ECVT TRANSMISSION <trim>, as printed
  assert.equal(int("1FMCU9NZ6TUA41819"), null, "an abbreviation we do not know is left blank, not half-cleaned");
  assert.equal(raw("1FMJU1J81TEA43929"), "Ultra Dark Space Gray Activ"); // 10SPD AUTO TRANS W/SLCTSHFT <trim>
  assert.equal(int("1FMJU1J81TEA43929"), "Ultra Dark Space Gray");
  assert.equal(raw("1FTEW2LP1TKF03974"), "Black Stx Cloth 40/Con/40"); // ELEC TEN-SPEED AUTO TRANS <trim>
  assert.equal(int("1FTEW2LP1TKF03974"), "Black");
  assert.equal(raw("1FT8W2BM0TEE80464"), "Medium Dark Slate Cloth"); // 10-SPEED AUTO TORQSHIFT <trim>
  assert.equal(int("1FT8W2BM0TEE80464"), "Medium Dark Slate");
  assert.equal(int("3FTTW8S30TRB60255"), "Navy Pier - Black Onyx"); // POWER-SPLIT ELECTRIC CVT <trim>
  assert.equal(int("3FMTK4SX3TMA15484"), "Prfm Gray"); // SINGLE-SPEED TRANSMISSION <trim>
});

test("47 real stickers: every exterior parses; every interior is a clean colour except the one unknown abbreviation", () => {
  const unknown = [];
  for (const [vin, text] of Object.entries(FX)) {
    const r = parseStickerColors(text);
    assert.ok(r.exteriorColor, `${vin} exterior`);
    assert.ok(r.interiorRaw, `${vin} raw interior is kept`);
    if (!r.interiorColor) { unknown.push(vin); continue; }
    assert.doesNotMatch(r.interiorColor, /\b(?:Cloth|Clth|Vinyl|Leather|Lth|Trim|Trm|Trimmed|Seats?|Sts|Activex|Active-X|Activ|Inserts|Recro|40\/Con\/40)\b/i, `${vin}: ${r.interiorColor}`);
  }
  assert.deepEqual(unknown, ["1FMCU9NZ6TUA41819"]);
});

test("normalizeInterior: trim suffixes and prefixes come off, colour names stay", () => {
  const cases = {
    "Emberglo Activex Trm": "Emberglo", "Black Onyx Cloth/Vinyl Trim": "Black Onyx", "Black Onyx Cloth Seats": "Black Onyx",
    "Black Onyx Lth-Trm Recro": "Black Onyx", "Black Onyx Leather-Trimmed": "Black Onyx", "Dark Space Gray Clth Trim S": "Dark Space Gray",
    "Cloth Gray/Black Seats": "Gray/Black", "Plaid Cloth Navy Pier Seats": "Navy Pier", "Lth-Trm/Vinyl Black Sts": "Black",
    "Onyx Miko Inserts": "Onyx", "Ebony Active-X Trim Seats": "Ebony", "BLACK ONYX ACTIVEX TRIMMED": "Black Onyx",
    "Navy Pier - Black Onyx": "Navy Pier - Black Onyx",
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(normalizeInterior(raw), want, raw);
  for (const bad of ["", "Cloth Seats", "Ebny Part Vnl/Clth&red Stch", "Activex Trm"]) assert.equal(normalizeInterior(bad), null, bad);
});

test("a sticker that is not the expected shape is a miss, never a guess", () => {
  assert.deepEqual(parseStickerColors(""), NONE);
  assert.deepEqual(parseStickerColors("This vehicle has not been released yet"), NONE);
  // exterior line without a recognisable lead-in; interior line without transmission words
  assert.deepEqual(parseStickerColors("VEHICLE DESCRIPTION\nMUSTANG\n2026 ECOBOOST COUPE EXTERIOR\nSHADOW BLACK\n2.3L ECOBOOST INTERIOR\nBLACK ONYX"), NONE);
  // barcode noise on the line
  assert.deepEqual(parseStickerColors("VEHICLE DESCRIPTION\nX\n2026 A EXTERIOR\n4-PASSENGER ƬŏƘūżŜ\n2.3L INTERIOR\n10-SPD AUTO TRANSMISSION ĬēĂĐċ").exteriorColor, null);
});

test("sticker URL is the public VIN lookup", () => {
  assert.equal(stickerUrlForVin("1fa6p8th4t5136280"), "https://www.windowsticker.forddirect.com/windowsticker.pdf?vin=1FA6P8TH4T5136280");
});

test("chassis-cab body wording is not part of the paint", () => {
  assert.equal(normalizeExterior("Chassis Cab Oxford White"), "Oxford White");
  assert.equal(normalizeExterior("Cab Race Red"), "Race Red");
  assert.equal(normalizeExterior("Oxford White"), "Oxford White");
  const t = "VEHICLE DESCRIPTION\nF-350\n2026 F350 DRW 4X4 CHASSIS CAB EXTERIOR\n2-PASSENGER CHASSIS CAB OXFORD WHITE\n6.7L POWER STROKE V8 DIESEL INTERIOR\n10-SPEED AUTO TORQSHIFT MEDIUM DARK SLATE VINYL";
  assert.equal(parseStickerColors(t).exteriorColor, "Oxford White");
});

test("more interior trim wording and attested abbreviations (values seen on NJ stickers)", () => {
  const cases = {
    "Ult Dk Spc Gry Activex Seat": "Ultra Dark Space Gray", "Ult Drk Spc Gry Cloth Seats": "Ultra Dark Space Gray",
    "Ebony Activex Seat Mtrl": "Ebony", "Lthr-Trim/Vinyl Black Sts": "Black", "Blk Perforated Activex": "Black",
    "Dark Slate Cloth 40/20/40": "Dark Slate", "Black Leather Trm 40/Con/40": "Black", "Bronze Fire Premium Trim": "Bronze Fire",
    "Ebony Roast Lea-Trim": "Ebony Roast", "Ebony Leather-Trim Seats": "Ebony", "Med Light Smoked Truffle Tr": "Medium Light Smoked Truffle",
    "Ebony/Lt Slate Activex Seat": "Ebony/Light Slate", "Baja Activex Trimmed": "Baja",
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(normalizeInterior(raw), want, raw);
  for (const bad of ["Leather Seating Surface", "Lth-Trm/Vn Smk Trf/Blk Sts", "Ebny Part Vnyl/Clth&red Sti"]) assert.equal(normalizeInterior(bad), null, bad);
});
