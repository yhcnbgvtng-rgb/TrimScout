import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { exteriorColorMustHaveName } from "./fordSticker";
import {
  PAUL_CHEVY_VIN,
  MOCK_CATALOG_PORSCHE_VIN,
  acceptImportedVehicle,
  factoryBuildFailedError,
  factoryBuildUnavailableError,
  preferredFactoryBuildEndpoint,
  vehicleVinMatchesPaste,
} from "./pasteImport";
import { brandCodeFromMake, isFordOrLincolnVin, isGmVin, looksLikeGmPaste } from "./oemWmi";
import {
  classifyGmFetchBody,
  clearGmStickerMemoryCache,
  confirmGmMustHavesFromSticker,
  defaultMustHaveLines,
  filterableFactoryOptions,
  getGmSticker,
  gmStickerPdfUrl,
  gmStickerToVehicle,
  isMultiFlexLine,
  isSuperCruiseLine,
  isZ71Line,
  parseGmStickerText,
  stickerHasMustHave,
} from "./gmSticker";

const FIXTURE_DIR = path.join(import.meta.dirname, "testdata", "gm-stickers");
const SUBJECT = "1GCUKDED9TZ134987";
const FLEMINGTON = "1GCUKDED8TZ200011";
const ALLENTOWN = "1GCUKDED2TZ200022";
const NO_SC = "1GCUKDED7TZ200033";
const UNRELEASED = "1GCUKDED1TZ200044";
const COLORADO = "1GCPYBEK4TZ300055";
const FORD_SUBJECT = "1FMWK8JCXTGB47204";

function loadFixture(vin: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${vin}.txt`), "utf8");
}

function clearVinDiskCache(vin: string): void {
  clearGmStickerMemoryCache();
  for (const ext of ["json", "pdf"]) {
    try {
      fs.unlinkSync(path.join("/tmp", "trimscout-gm-stickers", `${vin}.${ext}`));
    } catch {
      /* miss */
    }
  }
}

describe("GM WMI routing", () => {
  it("detects Chevy USA 1G1 / 1GC / 1GN and Canada/Mexico 2G* / 3G*", () => {
    assert.equal(isGmVin(SUBJECT), true);
    assert.equal(isGmVin(PAUL_CHEVY_VIN), true);
    assert.equal(isGmVin("1G1YY26U8X5100001"), true);
    assert.equal(isGmVin("1GNKRHKD0GJ123456"), true);
    assert.equal(isGmVin("2G1FB1E35H9123456"), true);
    assert.equal(isGmVin("3GCUKDED0TG123456"), true);
    assert.equal(isGmVin(FORD_SUBJECT), false);
    assert.equal(isFordOrLincolnVin(SUBJECT), false);
    assert.equal(isFordOrLincolnVin(PAUL_CHEVY_VIN), false);
  });

  it("maps shopper make names onto deal-request brand codes", () => {
    assert.equal(brandCodeFromMake("Ford"), "ford");
    assert.equal(brandCodeFromMake("Lincoln"), "ford");
    assert.equal(brandCodeFromMake("Chevrolet"), "chevrolet");
    assert.equal(brandCodeFromMake("GMC"), "chevrolet");
    assert.equal(brandCodeFromMake("Porsche"), "porsche");
  });

  it("includes related GM brands that share the CWS build URL", () => {
    assert.equal(isGmVin("1GTU9DED0TZ123456"), true);
    assert.equal(isGmVin("1G6AA5RX0G0123456"), true);
    assert.equal(isGmVin("1G4ZP5SS0HU123456"), true);
  });

  it("recognizes Chevy / GM paste and CWS URLs", () => {
    assert.equal(looksLikeGmPaste(SUBJECT), true);
    assert.equal(looksLikeGmPaste(PAUL_CHEVY_VIN), true);
    assert.equal(looksLikeGmPaste(gmStickerPdfUrl(SUBJECT)), true);
    assert.equal(looksLikeGmPaste("https://www.chevrolet.com/new-inventory"), true);
    assert.equal(looksLikeGmPaste(FORD_SUBJECT), false);
  });
});

describe("GM factory-build parse is not Ford's layout", () => {
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
    assert.equal(sticker.vin, SUBJECT);
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

  it("keeps must-have boxes unchecked and lists factory options plus color", () => {
    const names = filterableFactoryOptions(sticker).map((o) => o.name);
    assert.ok(names.includes("Z71 Off-Road Package"));
    assert.ok(names.includes("Multi-Flex Tailgate"));
    assert.ok(names.includes("Super Cruise"));
    assert.ok(names.some((n) => /^Exterior color:/i.test(n)));
    assert.deepEqual(defaultMustHaveLines(sticker), []);
  });
});

describe("Paul Chevy VIN 2GC4KREY7T1167690", () => {
  it("parses as Chevrolet Silverado 2500HD with the pasted VIN, never a Porsche", () => {
    const s = parseGmStickerText(PAUL_CHEVY_VIN, loadFixture(PAUL_CHEVY_VIN));
    assert.equal(s.vin, PAUL_CHEVY_VIN);
    assert.notEqual(s.vin, MOCK_CATALOG_PORSCHE_VIN);
    assert.equal(s.status, "released");
    assert.equal(s.make, "Chevrolet");
    assert.equal(s.model, "Silverado 2500HD");
    assert.equal(s.trim, "LT");
    assert.equal(s.msrp, 59435);
    const vehicle = gmStickerToVehicle(s);
    assert.equal(vehicle.vin, PAUL_CHEVY_VIN);
    assert.notEqual(vehicle.vin, MOCK_CATALOG_PORSCHE_VIN);
    assert.notEqual(vehicle.make, "Porsche");
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
    assert.equal(s.vin, UNRELEASED);
    assert.equal(confirmGmMustHavesFromSticker(s, ["Z71 Off-Road Package"]).pass, false);
  });

  it("does not treat a Colorado build as a Silverado 1500", () => {
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

describe("GM fetch classification (mocked HTTP)", () => {
  it("classifies JSON 1001, empty bodies, and real-looking text by content not status", () => {
    assert.equal(classifyGmFetchBody(new Uint8Array(), "application/pdf"), "empty");
    assert.equal(
      classifyGmFetchBody(
        new TextEncoder().encode(
          '{"errorCode":1001,"errorMessage":"No Window Sticker found for the requested VIN."}'
        ),
        "application/json"
      ),
      "unreleased_json"
    );
    assert.equal(
      classifyGmFetchBody(new TextEncoder().encode(loadFixture(PAUL_CHEVY_VIN)), "text/plain"),
      "text"
    );
    const pdfMagic = new Uint8Array(600);
    pdfMagic[0] = 0x25;
    pdfMagic[1] = 0x50;
    pdfMagic[2] = 0x44;
    pdfMagic[3] = 0x46;
    assert.equal(classifyGmFetchBody(pdfMagic, "application/pdf"), "pdf");
  });

  it("getGmSticker treats HTTP 200 JSON 1001 as unreleased for the pasted VIN", async () => {
    clearVinDiskCache(PAUL_CHEVY_VIN);
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      assert.match(url, /cws\.gm\.com/);
      assert.match(url, new RegExp(PAUL_CHEVY_VIN));
      assert.doesNotMatch(url, /marketcheck|auto\.dev|forddirect/i);
      return new Response(
        JSON.stringify({
          errorCode: 1001,
          errorMessage: "No Window Sticker found for the requested VIN.",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;
    try {
      const s = await getGmSticker(PAUL_CHEVY_VIN);
      assert.equal(s.status, "unreleased");
      assert.equal(s.vin, PAUL_CHEVY_VIN);
      assert.notEqual(s.vin, MOCK_CATALOG_PORSCHE_VIN);
    } finally {
      globalThis.fetch = orig;
      clearVinDiskCache(PAUL_CHEVY_VIN);
    }
  });

  it("getGmSticker imports Paul's Chevy VIN from a GM body and never yields a Porsche", async () => {
    clearVinDiskCache(PAUL_CHEVY_VIN);
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      assert.match(url, /cws\.gm\.com/);
      assert.doesNotMatch(url, /marketcheck|auto\.dev|forddirect/i);
      return new Response(loadFixture(PAUL_CHEVY_VIN), {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }) as typeof fetch;
    try {
      const s = await getGmSticker(PAUL_CHEVY_VIN);
      assert.equal(s.status, "released");
      assert.equal(s.vin, PAUL_CHEVY_VIN);
      assert.equal(s.make, "Chevrolet");
      assert.equal(s.model, "Silverado 2500HD");
      const vehicle = gmStickerToVehicle(s);
      assert.equal(vehicle.vin, PAUL_CHEVY_VIN);
      assert.equal(acceptImportedVehicle(vehicle, PAUL_CHEVY_VIN)?.vin, PAUL_CHEVY_VIN);
      assert.equal(acceptImportedVehicle(vehicle, MOCK_CATALOG_PORSCHE_VIN), null);
    } finally {
      globalThis.fetch = orig;
      clearVinDiskCache(PAUL_CHEVY_VIN);
    }
  });

  it("getGmSticker errors naming the pasted VIN on an empty HTTP 200 PDF, with no stand-in car", async () => {
    clearVinDiskCache(PAUL_CHEVY_VIN);
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      })) as typeof fetch;
    try {
      await assert.rejects(() => getGmSticker(PAUL_CHEVY_VIN), new RegExp(PAUL_CHEVY_VIN));
    } finally {
      globalThis.fetch = orig;
      clearVinDiskCache(PAUL_CHEVY_VIN);
    }
  });
});

describe("paste import never substitutes a catalog VIN", () => {
  it("routes Paul's Chevy VIN to /api/gm-sticker", () => {
    assert.equal(preferredFactoryBuildEndpoint(PAUL_CHEVY_VIN), "/api/gm-sticker");
    assert.equal(preferredFactoryBuildEndpoint(FORD_SUBJECT), "/api/ford-sticker");
    assert.equal(preferredFactoryBuildEndpoint("WP0AB2A98SS160032"), null);
  });

  it("rejects a Porsche catalog vehicle when the shopper pasted a Chevy VIN", () => {
    const porsche = { vin: MOCK_CATALOG_PORSCHE_VIN, make: "Porsche" };
    assert.equal(acceptImportedVehicle(porsche, PAUL_CHEVY_VIN), null);
    assert.equal(vehicleVinMatchesPaste(MOCK_CATALOG_PORSCHE_VIN, PAUL_CHEVY_VIN), false);
    assert.match(factoryBuildUnavailableError(PAUL_CHEVY_VIN), new RegExp(PAUL_CHEVY_VIN));
    assert.match(factoryBuildFailedError(PAUL_CHEVY_VIN), new RegExp(PAUL_CHEVY_VIN));
    assert.doesNotMatch(factoryBuildUnavailableError(PAUL_CHEVY_VIN), /porsche/i);
  });
});
