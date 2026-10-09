import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeTransmission, normalizeTransmissionStrict } from "../src/transmission.js";
import { parseStickerColors } from "../src/fordStickerColors.js";

const FX = JSON.parse(fs.readFileSync(new URL("./fixtures_ford_sticker_descriptions.json", import.meta.url), "utf8"));

test("the spellings from the brief collapse to one", () => {
  for (const raw of ["10-Speed Automatic Transmission", "10-Speed A/T", "10-Speed Automatic w/OD", "10-Speed Shiftable Automatic", "10 SPEED AUTOMATIC", "10-spd auto"]) {
    assert.equal(normalizeTransmission(raw), "10-Speed Automatic", raw);
  }
  assert.equal(normalizeTransmission("7 speed manual"), "7-Speed Manual");
  assert.equal(normalizeTransmission("6-Spd Manual w/OD"), "6-Speed Manual");
  assert.equal(normalizeTransmission("Ten-Speed Automatic"), "10-Speed Automatic");
});

test("CVT variants become CVT", () => {
  for (const raw of ["CVT", "Xtronic CVT", "eCVT", "ECVT TRANSMISSION", "Continuously Variable Transmission", "POWER-SPLIT ELECTRIC CVT", "8-Speed CVT"]) {
    assert.equal(normalizeTransmission(raw), "CVT", raw);
  }
});

test("bare Automatic / Manual stay as they are", () => {
  assert.equal(normalizeTransmission("Automatic"), "Automatic");
  assert.equal(normalizeTransmission("Manual"), "Manual");
  assert.equal(normalizeTransmission("AUTOMATIC"), "Automatic");
  assert.equal(normalizeTransmission("Automatic Transmission"), "Automatic");
});

test("idempotent: a canonical value maps to itself", () => {
  for (const v of ["10-Speed Automatic", "7-Speed Manual", "CVT", "Automatic", "Manual", "Single-Speed", "7-Speed Dual Clutch"]) {
    assert.equal(normalizeTransmission(v), v);
  }
});

test("a manual that mentions overdrive stays manual; an automatic with a manual mode stays automatic", () => {
  assert.equal(normalizeTransmission("6-Speed Manual w/OD"), "6-Speed Manual");
  assert.equal(normalizeTransmission("8-Speed Automatic with Manual Shift Mode"), "8-Speed Automatic");
  assert.equal(normalizeTransmission("6-Speed Automated Manual"), "6-Speed Automated Manual");
});

test("lenient keeps what it does not understand; strict returns null; empty is null", () => {
  assert.equal(normalizeTransmission("Electric Motor"), "Electric Motor");
  assert.equal(normalizeTransmissionStrict("Electric Motor"), null);
  assert.equal(normalizeTransmission("10-Speed"), "10-Speed"); // a speed count with no type is not guessed into Automatic
  assert.equal(normalizeTransmissionStrict("10-Speed"), null);
  assert.equal(normalizeTransmission("  "), null);
  assert.equal(normalizeTransmission(null), null);
  assert.equal(normalizeTransmission(undefined), null);
  assert.equal(normalizeTransmissionStrict("10-Speed Automatic"), "10-Speed Automatic");
});

test("a bare '7S' is only a speed count on a dual-clutch line", () => {
  assert.equal(normalizeTransmission("TREMEC® 7S DUAL CLUTCH TRAN"), "7-Speed Dual Clutch");
  assert.equal(normalizeTransmissionStrict("7S"), null);
});

test("Ford sticker transmission wordings from 47 real stickers", () => {
  const got = {};
  for (const text of Object.values(FX)) {
    const r = parseStickerColors(text);
    got[r.transmissionRaw] = r.transmission;
  }
  assert.deepEqual(got, {
    "TREMEC® 7S DUAL CLUTCH TRAN": "7-Speed Dual Clutch",
    "10-SPD AUTO TRANSMISSION": "10-Speed Automatic",
    "10-SPEED AUTO TRANSMISSION": "10-Speed Automatic",
    "10-SPEED AUTO TORQSHIFT": "10-Speed Automatic",
    "10-SPEED AUTO TORQSHIFT-G": "10-Speed Automatic",
    "10SPD AUTO TRANS W/SLCTSHFT": "10-Speed Automatic",
    "ELEC TEN-SPEED AUTO TRANS": "10-Speed Automatic",
    "8-SPD AUTO TRANSMISSION": "8-Speed Automatic",
    "ECVT TRANSMISSION": "CVT",
    "POWER-SPLIT ELECTRIC CVT": "CVT",
    "SINGLE-SPEED TRANSMISSION": "Single-Speed",
    "10-SPEED TRANSMISSION": null, // type not printed: left blank rather than guessed
  });
});

test("a sticker without the block has no transmission", () => {
  const r = parseStickerColors("nothing here");
  assert.equal(r.transmission, null);
  assert.equal(r.transmissionRaw, null);
});
