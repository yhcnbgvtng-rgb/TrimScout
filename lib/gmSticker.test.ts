import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { isFordOrLincolnVin, isGmVin, looksLikeGmPaste } from "./oemWmi";
import {
  DEMO_GM_SUBJECT_VIN,
  classifyGmFetchBody,
  confirmGmMustHavesFromSticker,
  defaultMustHaveLines,
  filterableFactoryOptions,
  getGmSticker,
  gmStickerPdfUrl,
  isGmVin as isGmVinFromSticker,
  isMultiFlexLine,
  isSuperCruiseLine,
  isZ71Line,
  parseGmStickerText,
  probeGmPdfFetch,
  stickerFromGmDemoFixture,
  stickerHasMustHave,
} from "./gmSticker";
import { exteriorColorMustHaveName } from "./fordSticker";

const FIXTURE_DIR = path.join(import.meta.dirname, "testdata", "gm-stickers");
const SUBJECT = DEMO_GM_SUBJECT_VIN;
const FLEMINGTON = "1GCUKDED8TZ200011";
const ALLENTOWN = "1GCUKDED2TZ200022";
const NO_SC = "1GCUKDED7TZ200033";
const UNRELEASED = "1GCUKDED1TZ200044";
const COLORADO = "1GCPYBEK4TZ300055";
const FORD_SUBJECT = "1FMWK8JCXTGB47204";

function loadFixture(vin: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${vin}.txt`), "utf8");
}

describe("GM WMI routing", () => {
  it("detects Chevy USA 1G1 / 1GC / 1GN and Canada/Mexico 2G* / 3G*", () => {
    assert.equal(isGmVin(SUBJECT), true);
    assert.equal(isGmVin("1G1YY26U8X5100001"), true);
    assert.equal(isGmVin("1GNKRHKD0GJ123456"), true);
    assert.equal(isGmVin("2G1FB1E35H9123456"), true);
    assert.equal(isGmVin("3GCUKDED0TG123456"), true);
    assert.equal(isGmVin(FORD_SUBJECT), false);
    assert.equal(isFordOrLincolnVin(SUBJECT), false);
    assert.equal(isGmVinFromSticker(SUBJECT), true);
  });

  it("includes related GM brands that share the CWS sticker URL", () => {
    assert.equal(isGmVin("1GTU9DED0TZ123456"), true); // GMC
    assert.equal(isGmVin("1G6AA5RX0G0123456"), true); // Cadillac
    assert.equal(isGmVin("1G4ZP5SS0HU123456"), true); // Buick
  });

  it("recognizes Chevy / GM paste and CWS URLs", () => {
    assert.equal(looksLikeGmPaste(SUBJECT), true);
    assert.equal(looksLikeGmPaste(gmStickerPdfUrl(SUBJECT)), true);
    assert.equal(looksLikeGmPaste("https://www.chevrolet.com/new-inventory"), true);
    assert.equal(looksLikeGmPaste(FORD_SUBJECT), false);
  });
});

describe("GM sticker parse is not Ford's layout", () => {
  const sticker = parseGmStickerText(SUBJECT, loadFixture(SUBJECT));

  it("reads a released 2026 Silverado 1500 LT 4WD with Z71 + Multi-Flex + Super Cruise", () => {
    assert.equal(sticker.status, "released");
    assert.equal(sticker.year, 2026);
    assert.equal(sticker.make, "Chevrolet");
    assert.equal(sticker.model, "Silverado 1500");
    assert.equal(sticker.trim, "LT");
    assert.equal(sticker.drivetrain, "4WD");
    assert.match(sticker.engine || "", /5\.3L/i);
    assert.equal(stickerHasMustHave(sticker, "Z71 Off-Road Package"), true);
    assert.equal(stickerHasMustHave(sticker, "Multi-Flex Tailgate"), true);
    assert.equal(stickerHasMustHave(sticker, "Super Cruise"), true);
    assert.deepEqual(defaultMustHaveLines(sticker), []);
  });

  it("uses GM Total Vehicle Price, not Ford TOTAL MSRP", () => {
    assert.equal(sticker.msrp, 62345);
    assert.equal(sticker.basePrice, 51900);
    assert.equal(sticker.destination, 1995);
    assert.doesNotMatch(sticker.rawText, /INCLUDED ON THIS VEHICLE/i);
    assert.doesNotMatch(sticker.rawText, /EQUIPMENT GROUP\s+800A/i);
    assert.match(sticker.rawText, /TOTAL VEHICLE PRICE/i);
    assert.match(sticker.rawText, /OPTIONAL EQUIPMENT/i);
    assert.match(sticker.dealerSoldTo?.name || "", /Flemington/i);
    assert.equal(sticker.dealerSoldTo?.state, "NJ");
  });

  it("keeps must-have boxes unchecked and lists sticker options plus color", () => {
    const names = filterableFactoryOptions(sticker).map((o) => o.name);
    assert.ok(names.includes("Z71 Off-Road Package"));
    assert.ok(names.includes("Multi-Flex Tailgate"));
    assert.ok(names.includes("Super Cruise"));
    assert.ok(names.some((n) => /^Exterior color:/i.test(n)));
    assert.deepEqual(defaultMustHaveLines(sticker), []);
  });
});

describe("GM option matchers", () => {
  it("maps Z71 / Multi-Flex / Super Cruise lines", () => {
    assert.equal(isZ71Line("Z71 Off-Road Package"), true);
    assert.equal(isZ71Line("Convenience Package II"), false);
    assert.equal(isMultiFlexLine("Multi-Flex Tailgate"), true);
    assert.equal(isMultiFlexLine("QT6 Multi-Flex Tailgate"), true);
    assert.equal(isSuperCruiseLine("Super Cruise"), true);
    assert.equal(isSuperCruiseLine("Cruise Control"), false);
  });

  it("drops a lot missing Super Cruise when that line is a must-have", () => {
    const s = parseGmStickerText(NO_SC, loadFixture(NO_SC));
    assert.equal(stickerHasMustHave(s, "Z71 Off-Road Package"), true);
    assert.equal(stickerHasMustHave(s, "Multi-Flex Tailgate"), true);
    assert.equal(stickerHasMustHave(s, "Super Cruise"), false);
    const check = confirmGmMustHavesFromSticker(s, [
      "Z71 Off-Road Package",
      "Multi-Flex Tailgate",
      "Super Cruise",
    ]);
    assert.equal(check.pass, false);
    assert.ok(check.missing.includes("Super Cruise"));
  });

  it("keeps Flemington and Allentown lots that have all three demo options", () => {
    for (const vin of [FLEMINGTON, ALLENTOWN]) {
      const s = parseGmStickerText(vin, loadFixture(vin));
      assert.equal(
        confirmGmMustHavesFromSticker(s, [
          "Z71 Off-Road Package",
          "Multi-Flex Tailgate",
          "Super Cruise",
        ]).pass,
        true
      );
    }
  });

  it("treats JSON errorCode 1001 as unreleased, never a match", () => {
    const s = parseGmStickerText(UNRELEASED, loadFixture(UNRELEASED));
    assert.equal(s.status, "unreleased");
    assert.equal(confirmGmMustHavesFromSticker(s, ["Z71 Off-Road Package"]).pass, false);
  });

  it("does not treat a Colorado sticker as a Silverado 1500", () => {
    const s = parseGmStickerText(COLORADO, loadFixture(COLORADO));
    assert.equal(s.model, "Colorado");
    assert.notEqual(s.model, "Silverado 1500");
  });

  it("matches exterior color only when that color is ticked", () => {
    const s = parseGmStickerText(SUBJECT, loadFixture(SUBJECT));
    const colorLine = exteriorColorMustHaveName(s.exteriorColor || "");
    assert.equal(stickerHasMustHave(s, colorLine), true);
    const white = parseGmStickerText(ALLENTOWN, loadFixture(ALLENTOWN));
    assert.equal(stickerHasMustHave(white, colorLine), false);
  });
});

describe("GM PDF fetch classification (live probe)", () => {
  it("classifies 0-byte application/pdf as the Akamai empty body", () => {
    assert.equal(classifyGmFetchBody(new Uint8Array(), "application/pdf"), "akamai_empty");
    assert.equal(
      classifyGmFetchBody(new TextEncoder().encode("%PDF-1.7" + "x".repeat(2000))),
      "pdf"
    );
    assert.equal(
      classifyGmFetchBody(
        new TextEncoder().encode('{"errorCode":1001,"errorMessage":"No Window Sticker found for the requested VIN."}')
      ),
      "unreleased_json"
    );
  });

  it("serverless GM CWS fetch for the demo VIN is empty/denied or a real PDF — never silent", async () => {
    const probe = await probeGmPdfFetch(SUBJECT);
    assert.equal(probe.httpStatus, 200);
    assert.ok(
      probe.kind === "pdf" || probe.kind === "akamai_empty" || probe.kind === "html_denied",
      `unexpected GM fetch kind ${probe.kind} bytes=${probe.byteLength} magic=${JSON.stringify(probe.magic)}`
    );
    if (probe.kind !== "pdf") {
      assert.ok(
        probe.byteLength < 2000,
        "Akamai empty/denied bodies are tiny; a real sticker PDF is tens of KB+"
      );
    }
  });

  it("demo fixture still parses the subject VIN when live bytes are blocked", () => {
    const local = stickerFromGmDemoFixture(SUBJECT);
    assert.ok(local);
    assert.equal(local!.status, "released");
    assert.equal(stickerHasMustHave(local!, "Super Cruise"), true);
  });

  it("getGmSticker returns the demo Silverado via fixture when CWS is 0-byte", async () => {
    const s = await getGmSticker(SUBJECT);
    assert.equal(s.status, "released");
    assert.equal(s.model, "Silverado 1500");
    assert.equal(stickerHasMustHave(s, "Z71 Off-Road Package"), true);
    assert.equal(stickerHasMustHave(s, "Multi-Flex Tailgate"), true);
    assert.equal(stickerHasMustHave(s, "Super Cruise"), true);
    assert.ok(
      s.fetchSource === "fixture" || s.fetchSource === "live" || s.fetchSource === "browser" || s.fetchSource === "cache"
    );
    if (s.fetchSource === "fixture") {
      assert.match(s.note || "", /Akamai/i);
    }
  });
});
