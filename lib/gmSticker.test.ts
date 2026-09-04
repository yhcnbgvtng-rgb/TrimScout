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
  importPastedFactoryVehicle,
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
  gmFactoryOptionBreakout,
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

  it("recognizes GM's non-North-American WMI blocks for current models — each confirmed against a real VIN (Cadillac Escalade/Lyriq, Buick Enclave/Encore GX/Envision)", () => {
    assert.equal(isGmVin("1GYS4BKLXRR139717"), true, "Cadillac Escalade (1GY)");
    assert.equal(isGmVin("1GYKPTRKXRZ116206"), true, "Cadillac Lyriq (1GY)");
    assert.equal(isGmVin("5GAEVAKW9RJ101917"), true, "Buick Enclave (5GA)");
    assert.equal(isGmVin("KL4AMBS20RB006959"), true, "Buick Encore GX, GM Korea (KL4)");
    assert.equal(isGmVin("LRBFZPE49RD017775"), true, "Buick Envision, GM China/SAIC-GM (LRB)");
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

  it("gmStickerToVehicle prefers the live current dealer over the sticker's factory ship-to dealer", () => {
    const withoutLiveDealer = gmStickerToVehicle(sticker, null, null, null);
    assert.equal(withoutLiveDealer.location.dealerName, "Ditschman Flemington Chevrolet");
    assert.equal(withoutLiveDealer.location.city, "Flemington");
    assert.equal(withoutLiveDealer.location.state, "NJ");
    assert.equal(withoutLiveDealer.location.dealerConfirmed, false);

    const liveDealer = {
      dealerName: "Allentown Chevrolet",
      dealerStreet: "1 Main St",
      dealerCity: "Allentown",
      dealerState: "PA",
      dealerZip: "18101",
      dealerPhone: "610-555-0100",
      vdpUrl: "https://www.allentownchevy.example/vdp",
    };
    const withLiveDealer = gmStickerToVehicle(sticker, null, null, liveDealer);
    assert.equal(withLiveDealer.location.dealerName, "Allentown Chevrolet");
    assert.equal(withLiveDealer.location.city, "Allentown");
    assert.equal(withLiveDealer.location.state, "PA");
    assert.equal(withLiveDealer.location.dealerConfirmed, true);
    assert.equal(withLiveDealer.dealerUrl, "https://www.allentownchevy.example/vdp");
  });

  it("keeps must-have boxes unchecked and lists factory options plus color", () => {
    const names = filterableFactoryOptions(sticker).map((o) => o.name);
    assert.ok(names.includes("Z71 Off-Road Package"));
    assert.ok(names.includes("Multi-Flex Tailgate"));
    assert.ok(names.includes("Super Cruise"));
    assert.ok(names.some((n) => /^Exterior color:/i.test(n)));
    assert.deepEqual(defaultMustHaveLines(sticker), []);
  });

  it("gmFactoryOptionBreakout mirrors Ford's shopper-facing shape (code/description/price/isPackageChild)", () => {
    const breakout = gmFactoryOptionBreakout(sticker);
    assert.ok(breakout.length > 0);
    for (const line of breakout) {
      assert.ok("code" in line && "description" in line && "price" in line && "isPackageChild" in line);
    }
    const names = breakout.map((o) => o.description);
    assert.ok(names.includes("Z71 Off-Road Package"));
    assert.ok(names.includes("Multi-Flex Tailgate"));
    assert.ok(names.includes("Super Cruise"));
    // rpo becomes code, never invented
    const withRpo = breakout.find((o) => o.description === "Z71 Off-Road Package");
    assert.ok(withRpo?.code === null || typeof withRpo?.code === "string");
  });

  it("gmFactoryOptionBreakout is empty for an unreleased sticker", () => {
    const s = parseGmStickerText(UNRELEASED, loadFixture(UNRELEASED));
    assert.deepEqual(gmFactoryOptionBreakout(s), []);
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

  it("importPastedFactoryVehicle drops a catalog Porsche returned for a Chevy paste", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      assert.match(String(input), /\/api\/gm-sticker/);
      return new Response(
        JSON.stringify({
          vin: PAUL_CHEVY_VIN,
          vehicle: { vin: MOCK_CATALOG_PORSCHE_VIN, make: "Porsche", model: "911" },
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const result = await importPastedFactoryVehicle(PAUL_CHEVY_VIN, fetchImpl);
    assert.equal(result.ok, false);
  });

  it("importPastedFactoryVehicle keeps the pasted Chevy VIN", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      assert.match(String(input), /\/api\/gm-sticker/);
      return new Response(
        JSON.stringify({
          vin: PAUL_CHEVY_VIN,
          vehicle: {
            vin: PAUL_CHEVY_VIN,
            year: 2026,
            make: "Chevrolet",
            model: "Silverado",
            trim: "LT",
          },
          sticker: { status: "released", msrp: 52000 },
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const result = await importPastedFactoryVehicle(PAUL_CHEVY_VIN, fetchImpl);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.vehicle.vin, PAUL_CHEVY_VIN);
      assert.equal(result.oem, "gm");
    }
  });
});

describe("newer GM sticker template — labeled header, footnoted total, trailing trim", () => {
  // Real sticker text fetched live from GM's CWS service (VIN swapped for a
  // fixture VIN). GM has since reissued the original test VIN's sticker in
  // this newer format — "TRANSMISSION: 10-SPEED AUTO" (label before value,
  // reversed from the older template), "STANDARD VEHICLE PRICE" instead of
  // "BASE PRICE", "TOTAL VEHICLE PRICE* $X" with a footnote marker before
  // the amount, and the trim word trailing the year/model headline instead
  // of on its own line. All four previously fell through to null/undefined.
  const NEWER_TEMPLATE = "1GCUKDED4TZ200066";

  it("parses trim from the trailing word of the headline line", () => {
    const s = parseGmStickerText(NEWER_TEMPLATE, loadFixture(NEWER_TEMPLATE));
    assert.equal(s.year, 2026);
    assert.equal(s.model, "Silverado 1500");
    assert.equal(s.trim, "LT");
  });

  it("parses a label-before-value transmission line, not the country-of-origin TRANSMISSION: line", () => {
    const s = parseGmStickerText(NEWER_TEMPLATE, loadFixture(NEWER_TEMPLATE));
    assert.match(s.transmission || "", /10-SPEED AUTO/i);
    assert.doesNotMatch(s.transmission || "", /UNITED STATES/i);
  });

  it("parses STANDARD VEHICLE PRICE as basePrice and the footnoted TOTAL VEHICLE PRICE* as msrp", () => {
    const s = parseGmStickerText(NEWER_TEMPLATE, loadFixture(NEWER_TEMPLATE));
    assert.equal(s.basePrice, 53600);
    assert.equal(s.optionsPrice, 1990);
    assert.equal(s.destination, 2595);
    assert.equal(s.msrp, 58185);
    assert.equal(
      Math.round((s.basePrice! + s.optionsPrice! + s.destination!) * 100) / 100,
      s.msrp,
      "sanity check: the parsed total actually equals base + options + destination"
    );
  });

  it("still parses exterior/interior color and engine from the labeled header", () => {
    const s = parseGmStickerText(NEWER_TEMPLATE, loadFixture(NEWER_TEMPLATE));
    assert.equal(s.exteriorColor, "Riptide Blue Metallic");
    assert.equal(s.interiorColor, "Jet Black");
    assert.match(s.engine || "", /5\.3L ECOTEC3 V8/i);
  });

  it("parses the options list under the new 'OPTIONS INSTALLED BY THE MANUFACTURER' header, not the old 'OPTIONAL EQUIPMENT' one", () => {
    const s = parseGmStickerText(NEWER_TEMPLATE, loadFixture(NEWER_TEMPLATE));
    // Was empty before the fix: the old parser only recognized "OPTIONAL
    // EQUIPMENT" as the section start, which this template never prints.
    assert.ok(s.options.length > 0, "options must not come back empty for this template");
    const names = s.options.map((o) => o.name);
    assert.ok(names.some((n) => /RIPTIDE BLUE METALLIC/i.test(n)));
    const paintOption = s.options.find((o) => /RIPTIDE BLUE METALLIC/i.test(o.name));
    assert.equal(paintOption?.price, 395);
    // The instructional header lines themselves must never appear as options.
    assert.ok(!names.some((n) => /OPTIONS INSTALLED BY THE MANUFACTURER/i.test(n)));
    assert.ok(!names.some((n) => /^STANDARD EQUIPMENT SHOWN/i.test(n)));
    // The trailing price-summary lines must not leak in as fake options.
    assert.ok(!names.some((n) => /^TOTAL (OPTIONS|VEHICLE)/i.test(n)));
  });

  it("breaks out a priced option (a paint upcharge here) for the must-have checklist — same section-boundary bug the user hit on a wheels option", () => {
    // Confirmed live against the exact VIN the user reported
    // (1GCPKKEKXTZ461947): its "20\" ALUMINUM WHEELS W/ GRAZEN 800.00" line
    // was silently dropped by the same bug this fixture exercises — the
    // options section never got sliced out at all, so nothing after the
    // header showed up as a must-have option, priced or not.
    const s = parseGmStickerText(NEWER_TEMPLATE, loadFixture(NEWER_TEMPLATE));
    const breakout = gmFactoryOptionBreakout(s);
    assert.ok(breakout.length > 0);
    const paint = breakout.find((o) => /RIPTIDE BLUE METALLIC/i.test(o.description));
    assert.equal(paint?.price, 395);
    assert.ok(breakout.some((o) => /ALUMINUM WHEELS/i.test(o.description)));
  });

  it("the exact VIN reported by the user (1GCPKKEKXTZ461947): $800 wheels shows up, price is confirmed, not 'unconfirmed'", () => {
    const vin = "1GCPKKEKXTZ461947";
    const s = parseGmStickerText(vin, loadFixture(vin));
    assert.equal(s.status, "released");
    assert.equal(s.trim, "LT");
    assert.equal(s.basePrice, 51000);
    assert.equal(s.optionsPrice, 800);
    assert.equal(s.destination, 2795);
    assert.equal(s.msrp, 54595, "msrp must be a real number, not null/'unconfirmed'");
    const breakout = gmFactoryOptionBreakout(s);
    const wheels = breakout.find((o) => /ALUMINUM WHEELS/i.test(o.description));
    assert.ok(wheels, "the 20\" aluminum wheels option must appear in the must-have checklist");
    assert.equal(wheels?.price, 800);
  });

  it("standardEquipment is not truncated by real body copy mentioning 'WARRANTY' — confirmed the old bare WARRANTY\\b end marker cut this block short on both real fixtures using this template", () => {
    const s = parseGmStickerText(NEWER_TEMPLATE, loadFixture(NEWER_TEMPLATE));
    assert.ok(
      s.standardEquipment.length > 20,
      `expected a real standard-equipment list, got only ${s.standardEquipment.length} lines`
    );
  });
});

describe("Cadillac on the newer GM sticker template (real CT5 fixture — same template as the two Silverados above, no brand word before the model)", () => {
  const CT5 = "1G6DN5RK1R0104159";

  it("reads a released 2024 Cadillac CT5 Premium Luxury — brand already worked, year/model/trim did not until this fixture surfaced the gap", () => {
    const s = parseGmStickerText(CT5, loadFixture(CT5));
    assert.equal(s.status, "released");
    assert.equal(s.make, "Cadillac");
    assert.equal(s.year, 2024);
    assert.equal(s.model, "CT5", "a short alphanumeric nameplate like CT5 must not be title-cased into 'Ct5'");
    assert.equal(s.trim, "Premium Luxury");
  });

  it("prices reconcile: basePrice + optionsPrice + destination === msrp", () => {
    const s = parseGmStickerText(CT5, loadFixture(CT5));
    assert.equal(s.basePrice, 42895);
    assert.equal(s.optionsPrice, 7515);
    assert.equal(s.destination, 1395);
    assert.equal(s.msrp, 51805);
    assert.equal(
      Math.round((s.basePrice! + s.optionsPrice! + s.destination!) * 100) / 100,
      s.msrp,
      "sanity check: the parsed total actually equals base + options + destination"
    );
  });

  it("parses real priced options without corrupting unrelated adjacent lines into each other", () => {
    const s = parseGmStickerText(CT5, loadFixture(CT5));
    const byName = (re: RegExp) => s.options.find((o) => re.test(o.name));
    assert.equal(byName(/^PARKING PACKAGE:?$/i)?.price, 1790);
    assert.equal(byName(/^ULTRAVIEW SUNROOF$/i)?.price, 1450);
    assert.equal(byName(/^NAVIGATION AND BOSE PREMIUM$/i)?.price, 1350);
    assert.equal(byName(/^RADIANT RED TINTCOAT$/i)?.price, 1225, "the paint charge must not get fused onto the preceding Bose speaker description");
    assert.equal(byName(/^TECHNOLOGY PACKAGE:?$/i)?.price, 1100);
    assert.equal(byName(/^LIGHTING PACKAGE:?$/i)?.price, 600);
    const sumOfPriced = s.options.reduce((sum, o) => sum + (o.price || 0), 0);
    assert.equal(sumOfPriced, s.optionsPrice, "every real priced line must be captured exactly once, with no double-counting from bad joins");
  });

  it("no longer fabricates an rpo code from an ordinary word starting a line (e.g. 'REAR CAMERA MIRROR')", () => {
    const s = parseGmStickerText(CT5, loadFixture(CT5));
    const cameraMirror = s.options.find((o) => /CAMERA MIRROR/i.test(o.name));
    assert.equal(cameraMirror?.name, "REAR CAMERA MIRROR");
    assert.equal(cameraMirror?.rpo, undefined);
  });

  it("joins a PDF-wrapped bulleted continuation into one option instead of a bogus standalone fragment", () => {
    const s = parseGmStickerText(CT5, loadFixture(CT5));
    const names = s.options.map((o) => o.name);
    assert.ok(names.some((n) => /Automatic Parking Assist With Braking/i.test(n)));
    assert.ok(!names.includes("Braking"), "the wrapped continuation must not appear as its own bogus option");
  });

  it("standardEquipment is a real list, not the ~6-line truncation the WARRANTY-in-body-copy bug produced", () => {
    const s = parseGmStickerText(CT5, loadFixture(CT5));
    assert.ok(s.standardEquipment.length > 20, `expected a real standard-equipment list, got only ${s.standardEquipment.length} lines`);
    assert.ok(s.standardEquipment.some((l) => /ADAPTIVE CRUISE CONTROL/i.test(l)), "must reach past the OWNER BENEFITS subsection into PERFORMANCE/LUXURY & CONVENIENCE");
  });

  it("gmStickerToVehicle produces a usable Vehicle — never year 0 / blank model for a brand GM already routes correctly", () => {
    const s = parseGmStickerText(CT5, loadFixture(CT5));
    const vehicle = gmStickerToVehicle(s, null, null, null);
    assert.equal(vehicle.make, "Cadillac");
    assert.equal(vehicle.year, 2024);
    assert.equal(vehicle.model, "CT5");
    assert.equal(vehicle.trim, "Premium Luxury");
    assert.equal(vehicle.msrp, 51805);
  });
});

describe("all four GM brands, confirmed live on real fixtures (Chevrolet already covered above; GMC's Sierra/Acadia/Yukon share 1GK with the Hummer EV sub-brand, tested separately below since its own nameplate needed a dedicated fix)", () => {
  const ESCALADE = "1GYS4BKLXRR139717";
  const LYRIQ = "1GYKPTRKXRZ116206";
  const ENCLAVE = "5GAEVAKW9RJ101917";
  const ENCORE_GX = "KL4AMBS20RB006959";
  const ENVISION = "LRBFZPE49RD017775";
  const HUMMER_EV = "1GKB0RDC6RU100924";

  it("Cadillac Escalade (1GY WMI, previously unrecognized) parses correctly, including a negative CREDIT line item", () => {
    const s = parseGmStickerText(ESCALADE, loadFixture(ESCALADE));
    assert.equal(s.status, "released");
    assert.equal(s.make, "Cadillac");
    assert.equal(s.year, 2024);
    assert.equal(s.model, "Escalade");
    assert.equal(s.basePrice, 96195);
    assert.equal(s.destination, 1995);
    assert.equal(s.msrp, 99365);
    // "CREDIT - NOT EQUIPPED WITH 2ND ROW EXPRESS-UP WINDOW CONTROL -50.00"
    // — the leading "-" on the amount previously failed to parse at all,
    // silently dropping the credit instead of subtracting it.
    const credit = s.options.find((o) => /CREDIT/i.test(o.name));
    assert.equal(credit?.price, -50);
    const sumOfPriced = s.options.reduce((sum, o) => sum + (o.price || 0), 0);
    assert.equal(sumOfPriced, s.optionsPrice, "the negative credit must be subtracted, not dropped");
  });

  it("Cadillac Lyriq (1GY WMI, the EV) parses model/trim correctly — 'Sport' must not get absorbed into the model name", () => {
    const s = parseGmStickerText(LYRIQ, loadFixture(LYRIQ));
    assert.equal(s.status, "released");
    assert.equal(s.make, "Cadillac");
    assert.equal(s.model, "Lyriq", "not 'Lyriq Sport' — Sport is part of the trim, not the model");
    assert.equal(s.trim, "Sport 1");
    assert.equal(
      Math.round((s.basePrice! + s.optionsPrice! + s.destination!) * 100) / 100,
      s.msrp
    );
  });

  it("Buick Enclave (5GA WMI, previously unrecognized) parses correctly", () => {
    const s = parseGmStickerText(ENCLAVE, loadFixture(ENCLAVE));
    assert.equal(s.status, "released");
    assert.equal(s.make, "Buick");
    assert.equal(s.model, "Enclave");
    assert.match(s.trim || "", /Essence/i);
    assert.equal(
      Math.round((s.basePrice! + s.optionsPrice! + s.destination!) * 100) / 100,
      s.msrp
    );
  });

  it("Buick Encore GX (KL4 WMI, GM Korea — previously unrecognized) parses correctly", () => {
    const s = parseGmStickerText(ENCORE_GX, loadFixture(ENCORE_GX));
    assert.equal(s.status, "released");
    assert.equal(s.make, "Buick");
    assert.match(s.model || "", /Encore/i);
    assert.equal(
      Math.round((s.basePrice! + s.optionsPrice! + s.destination!) * 100) / 100,
      s.msrp
    );
  });

  it("Buick Envision (LRB WMI, GM China/SAIC-GM — previously unrecognized) parses model/trim correctly — 'Sport' must not get absorbed into the model name here either", () => {
    const s = parseGmStickerText(ENVISION, loadFixture(ENVISION));
    assert.equal(s.status, "released");
    assert.equal(s.make, "Buick");
    assert.equal(s.model, "Envision", "not 'Envision Sport' — Sport Touring (ST) is the trim");
    assert.match(s.trim || "", /Sport Touring/i);
    assert.equal(
      Math.round((s.basePrice! + s.optionsPrice! + s.destination!) * 100) / 100,
      s.msrp
    );
  });

  it("GMC Hummer EV (1GK WMI — already routed correctly, but year/model/trim silently failed until 'HUMMER EV' was added as a recognized nameplate)", () => {
    const s = parseGmStickerText(HUMMER_EV, loadFixture(HUMMER_EV));
    assert.equal(s.status, "released");
    // Before the fix, `make` only survived by luck (a "www.gmc.com" link
    // elsewhere in the text, unrelated to the actual headline parse) and
    // came back title-cased wrong as "Gmc" — both are asserted here.
    assert.equal(s.make, "GMC", "GMC is an acronym — must not get mangled into 'Gmc'");
    assert.equal(s.year, 2024);
    assert.equal(s.model, "Hummer EV", "not just 'Hummer' — EV is part of the nameplate, not the trim");
    assert.equal(
      Math.round((s.basePrice! + s.optionsPrice! + s.destination!) * 100) / 100,
      s.msrp
    );
  });

  it("every real fixture's priced options sum to exactly the sticker's own optionsPrice — the strongest available check against silent option-parsing corruption", () => {
    for (const vin of [ESCALADE, LYRIQ, ENCLAVE, ENCORE_GX, ENVISION, HUMMER_EV, "1G6DN5RK1R0104159"]) {
      const s = parseGmStickerText(vin, loadFixture(vin));
      const sumOfPriced = s.options.reduce((sum, o) => sum + (o.price || 0), 0);
      assert.equal(sumOfPriced, s.optionsPrice, `${vin}: sum of priced options must equal optionsPrice exactly`);
    }
  });

  it("comparablesEndpointForVin-equivalent routing: isGmVin is true for every brand's WMI, so all of them reach /api/gm-sticker and /api/gm-comparables with no other code changes needed", () => {
    for (const vin of [ESCALADE, LYRIQ, ENCLAVE, ENCORE_GX, ENVISION, HUMMER_EV]) {
      assert.equal(isGmVin(vin), true, vin);
    }
  });
});
