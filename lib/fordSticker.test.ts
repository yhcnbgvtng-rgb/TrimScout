import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  confirmFordMustHaves,
  confirmFordMustHavesFromSticker,
  DEMO_SUBJECT_VIN,
  defaultMustHaveLines,
  engineFamilyFromVin,
  extractVin,
  isFordOrLincolnVin,
  isKeypadIntent,
  isKeypadLine,
  isStandardKeylessLine,
  parseFordStickerText,
  shouldExcludeByEnginePrefix,
  stickerHasMustHave,
} from "./fordSticker";

const FIXTURE_DIR = path.join(import.meta.dirname, "testdata", "ford-stickers");

function loadFixture(vin: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${vin}.txt`), "utf8");
}

const SUBJECT = DEMO_SUBJECT_VIN;
const SHORKEY = "1FMWK8JC7TGB81309";
const BATTLEFIELD = "1FMWK8JC1TGB69561";
const MALL_OF_GEORGIA = "1FMWK8JC7TGA20216";
const UNRELEASED = "1FMWK8JC2TGB72467";
const DECOY_23 = "1FMUK8JH8TGB25138";

describe("VIN extract / Ford identity", () => {
  it("extracts a raw 17-char VIN", () => {
    assert.equal(extractVin(SUBJECT), SUBJECT);
    assert.equal(extractVin(`  ${SUBJECT.toLowerCase()}  `), SUBJECT);
  });

  it("extracts a VIN from a dealer VDP URL", () => {
    const url =
      "https://www.jimshorkey.com/new-Pittsburgh-2026-Ford-Explorer-Tremor+Ultimate+Package-1FMWK8JC7TGB81309";
    assert.equal(extractVin(url), SHORKEY);
  });

  it("extracts a VIN from the Ford Direct query string", () => {
    assert.equal(
      extractVin(`https://www.windowsticker.forddirect.com/windowsticker.pdf?vin=${SUBJECT}`),
      SUBJECT
    );
  });

  it("recognizes Ford/Lincoln VINs only", () => {
    assert.equal(isFordOrLincolnVin(SUBJECT), true);
    assert.equal(isFordOrLincolnVin(DECOY_23), true);
    assert.equal(isFordOrLincolnVin("WBA33AY08RF892110"), false);
  });

  it("maps 1FMWK to 3.0 and 1FMU to 2.3 and excludes the decoy from a 3.0 hunt", () => {
    assert.equal(engineFamilyFromVin(SUBJECT), "3.0");
    assert.equal(engineFamilyFromVin(DECOY_23), "2.3");
    assert.equal(shouldExcludeByEnginePrefix(SUBJECT, DECOY_23), true);
    assert.equal(shouldExcludeByEnginePrefix(SUBJECT, SHORKEY), false);
  });
});

describe("keyless glossary rules", () => {
  it("does not treat KEYLESS ENTRY W/PUSH START as a keypad filter", () => {
    assert.equal(isStandardKeylessLine("KEYLESS ENTRY W/PUSH START"), true);
    assert.equal(isKeypadLine("KEYLESS ENTRY W/PUSH START"), false);
    assert.equal(isKeypadIntent("KEYLESS ENTRY W/PUSH START"), false);
  });

  it("maps user 'keyless entry' to the $455 pillar keypad", () => {
    assert.equal(isKeypadIntent("keyless entry"), true);
    assert.equal(isKeypadLine("KEYLESS ENTRY KEYPAD"), true);
  });
});

describe("Ford sticker parse — subject 1FMWK8JCXTGB47204", () => {
  const sticker = parseFordStickerText(SUBJECT, loadFixture(SUBJECT));

  it("is a released 2026 Explorer Tremor 3.0 with Ultimate + keypad", () => {
    assert.equal(sticker.status, "released");
    assert.equal(sticker.year, 2026);
    assert.notEqual(sticker.year, 7204);
    assert.equal(sticker.model, "Explorer");
    assert.equal(sticker.trim, "Tremor");
    assert.match(sticker.engine || "", /3\.0L/i);
    assert.equal(stickerHasMustHave(sticker, "Ultimate Package"), true);
    assert.equal(stickerHasMustHave(sticker, "Keyless Entry Keypad"), true);
    assert.deepEqual(defaultMustHaveLines(sticker), ["Ultimate Package", "Keyless Entry Keypad"]);
  });

  it("parses sticker MSRP $64,705 and sold-to Butler NJ", () => {
    assert.equal(sticker.msrp, 64705);
    assert.match(sticker.dealerSoldTo?.name || "", /Route 23/i);
    assert.equal(sticker.dealerSoldTo?.city, "Butler");
    assert.equal(sticker.dealerSoldTo?.state, "NJ");
    assert.equal(sticker.dealerSoldTo?.zip, "07405");
  });

  it("does not treat standard keyless fob as a must-have", () => {
    const check = confirmFordMustHavesFromSticker(sticker, ["Keyless Entry Keypad"]);
    assert.equal(check.pass, true);
    assert.equal(stickerHasMustHave(sticker, "KEYLESS ENTRY W/PUSH START"), true);
    // keypad intent must still be the optional $455 line, which this car has
    assert.equal(stickerHasMustHave(sticker, "keyless entry"), true);
  });
});

describe("Ford sticker parse — true positives / false positive / unreleased", () => {
  it("Jim Shorkey has Ultimate + keypad", () => {
    const s = parseFordStickerText(SHORKEY, loadFixture(SHORKEY));
    assert.equal(s.status, "released");
    assert.equal(stickerHasMustHave(s, "Ultimate Package"), true);
    assert.equal(stickerHasMustHave(s, "Keyless Entry Keypad"), true);
    assert.equal(confirmFordMustHavesFromSticker(s, ["Ultimate Package", "Keyless Entry Keypad"]).pass, true);
  });

  it("Battlefield Ford has Ultimate + keypad", () => {
    const s = parseFordStickerText(BATTLEFIELD, loadFixture(BATTLEFIELD));
    assert.equal(stickerHasMustHave(s, "Ultimate Package"), true);
    assert.equal(stickerHasMustHave(s, "Keyless Entry Keypad"), true);
  });

  it("Mall of Georgia has Ultimate but MUST drop for missing keypad", () => {
    const s = parseFordStickerText(MALL_OF_GEORGIA, loadFixture(MALL_OF_GEORGIA));
    assert.equal(stickerHasMustHave(s, "Ultimate Package"), true);
    assert.equal(stickerHasMustHave(s, "Keyless Entry Keypad"), false);
    const check = confirmFordMustHavesFromSticker(s, ["Ultimate Package", "Keyless Entry Keypad"]);
    assert.equal(check.pass, false);
    assert.ok(check.missing.includes("Keyless Entry Keypad"));
  });

  it("unreleased placeholder is never a match", () => {
    const s = parseFordStickerText(UNRELEASED, loadFixture(UNRELEASED));
    assert.equal(s.status, "unreleased");
    assert.equal(confirmFordMustHavesFromSticker(s, ["Ultimate Package"]).pass, false);
  });

  it("2.3 decoy has keypad but no Ultimate and is prefix-excluded", () => {
    const s = parseFordStickerText(DECOY_23, loadFixture(DECOY_23));
    assert.match(s.engine || "", /2\.3L/i);
    assert.equal(stickerHasMustHave(s, "Ultimate Package"), false);
    assert.equal(stickerHasMustHave(s, "Keyless Entry Keypad"), true);
    assert.equal(shouldExcludeByEnginePrefix(SUBJECT, DECOY_23), true);
  });
});

describe("live Ford Direct confirmFordMustHaves (network)", () => {
  it("subject VIN still has Ultimate + keypad on Ford Direct", async () => {
    const check = await confirmFordMustHaves(SUBJECT, ["Ultimate Package", "Keyless Entry Keypad"]);
    assert.equal(check.status, "released");
    assert.equal(check.pass, true);
  });

  it("Mall of Georgia still fails keypad on a live Ford PDF", async () => {
    const check = await confirmFordMustHaves(MALL_OF_GEORGIA, ["Ultimate Package", "Keyless Entry Keypad"]);
    assert.equal(check.status, "released");
    assert.equal(check.pass, false);
    assert.ok(check.missing.includes("Keyless Entry Keypad"));
  });
});
