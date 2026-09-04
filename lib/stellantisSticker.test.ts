import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  importPastedFactoryVehicle,
  preferredFactoryBuildEndpoint,
} from "./pasteImport";
import {
  isFordOrLincolnVin,
  isGmVin,
  isStellantisVin,
  looksLikeStellantisPaste,
} from "./oemWmi";
import {
  clearStellantisStickerMemoryCache,
  confirmStellantisMustHavesFromSticker,
  defaultMustHaveLines,
  filterableFactoryOptions,
  parseStellantisStickerText,
  stellantisFactoryOptionBreakout,
  stellantisStickerPdfUrl,
  stellantisStickerToVehicle,
  stickerHasMustHave,
} from "./stellantisSticker";

const FIXTURE_DIR = path.join(import.meta.dirname, "testdata", "stellantis-stickers");
const JEEP_WRANGLER = "1C4JJXSJ3MW678163";
const RAM_1500 = "1C6SRFHT4MN652569";
const NOT_FOUND = "2C3CDYBT7EH220279";
const FORD_SUBJECT = "1FMWK8JCXTGB47204";

function loadFixture(vin: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${vin}.txt`), "utf8");
}

function clearVinDiskCache(vin: string): void {
  clearStellantisStickerMemoryCache();
  for (const ext of ["json", "pdf"]) {
    try {
      fs.unlinkSync(path.join("/tmp", "trimscout-stellantis-stickers", `${vin}.${ext}`));
    } catch {
      /* miss */
    }
  }
}

describe("Stellantis WMI routing", () => {
  it("detects US 1C3/1C4/1C6, Mexico 3C4/3C6/3C7, Canada 2C3/2C4/2C8/2A4/2A8/2B3", () => {
    assert.equal(isStellantisVin(JEEP_WRANGLER), true);
    assert.equal(isStellantisVin(RAM_1500), true);
    assert.equal(isStellantisVin(NOT_FOUND), true);
    assert.equal(isStellantisVin("3C6TR5DT8HG123456"), true);
    assert.equal(isStellantisVin("2C8GP44L45R123456"), true);
    assert.equal(isStellantisVin(FORD_SUBJECT), false);
    assert.equal(isStellantisVin("WP0AB2A98SS160032"), false, "Porsche VIN must not collide");
    assert.equal(isGmVin(JEEP_WRANGLER), false);
    assert.equal(isFordOrLincolnVin(JEEP_WRANGLER), false);
  });

  it("recognizes Jeep/Ram/Dodge/Chrysler paste text and the sticker URL", () => {
    assert.equal(looksLikeStellantisPaste(JEEP_WRANGLER), true);
    assert.equal(looksLikeStellantisPaste(stellantisStickerPdfUrl(JEEP_WRANGLER)), true);
    assert.equal(looksLikeStellantisPaste("https://www.jeep.com/wrangler"), true);
    assert.equal(looksLikeStellantisPaste("https://www.ramtrucks.com/1500"), true);
    assert.equal(looksLikeStellantisPaste("Check out this Dodge Charger"), true);
    assert.equal(looksLikeStellantisPaste(FORD_SUBJECT), false);
  });

  it("preferredFactoryBuildEndpoint routes each OEM correctly, including the new Stellantis branch", () => {
    assert.equal(preferredFactoryBuildEndpoint(JEEP_WRANGLER), "/api/stellantis-sticker");
    assert.equal(preferredFactoryBuildEndpoint(RAM_1500), "/api/stellantis-sticker");
    assert.equal(preferredFactoryBuildEndpoint(FORD_SUBJECT), "/api/ford-sticker");
    // Porsche has its own (listing-feed-backed) route now — see lib/porscheSticker.ts.
    assert.equal(preferredFactoryBuildEndpoint("WP0AB2A98SS160032"), "/api/porsche-sticker");
  });
});

describe("Stellantis factory-build parse — real Jeep Wrangler sticker", () => {
  const sticker = parseStellantisStickerText(JEEP_WRANGLER, loadFixture(JEEP_WRANGLER));

  it("reads a released 2021 Jeep Wrangler Unlimited Rubicon 392, 4WD", () => {
    assert.equal(sticker.status, "released");
    assert.equal(sticker.year, 2021);
    assert.equal(sticker.make, "Jeep");
    assert.equal(sticker.model, "Wrangler");
    assert.equal(sticker.trim, "Unlimited Rubicon 392");
    assert.equal(sticker.drivetrain, "4WD");
    assert.match(sticker.engine || "", /6\.4L V8 HEMI/i);
    assert.match(sticker.transmission || "", /8.Speed Automatic/i);
  });

  it("strips the label's own echoed suffix from colors (colorsMatch is exact-equality, not substring)", () => {
    assert.equal(sticker.exteriorColor, "Sting–Gray Clear–Coat");
    assert.equal(sticker.interiorColor, "Black");
    assert.doesNotMatch(sticker.exteriorColor || "", /Exterior Paint/i);
    assert.doesNotMatch(sticker.interiorColor || "", /Interior Color/i);
  });

  it("derives optionsPrice from msrp - basePrice - destination (this template prints no TOTAL OPTIONS subtotal)", () => {
    assert.equal(sticker.basePrice, 73500);
    assert.equal(sticker.destination, 1495);
    assert.equal(sticker.msrp, 76280);
    assert.equal(sticker.optionsPrice, 1285);
    assert.equal(
      Math.round((sticker.basePrice! + sticker.optionsPrice! + sticker.destination!) * 100) / 100,
      sticker.msrp,
      "sanity check: the parsed total actually equals base + options + destination"
    );
  });

  it("parses the real priced options (a $350 Trailer-Tow Package among them), never the section headers as fake options", () => {
    const names = sticker.options.map((o) => o.name);
    assert.ok(names.some((n) => /Trailer.{0,3}Tow Package/i.test(n)));
    const tow = sticker.options.find((o) => /Trailer.{0,3}Tow Package/i.test(o.name));
    assert.equal(tow?.price, 350);
    assert.ok(!names.some((n) => /OPTIONAL EQUIPMENT/i.test(n)));
    assert.ok(!names.some((n) => /^Functional\/Safety Features$/i.test(n)));
  });

  it("standard equipment is captured and its own sub-headers are filtered out", () => {
    assert.ok(sticker.standardEquipment.length > 10);
    assert.ok(sticker.standardEquipment.includes("LED Lighting Group"));
    assert.ok(!sticker.standardEquipment.some((l) => /^(FUNCTIONAL\/SAFETY FEATURES|INTERIOR FEATURES|EXTERIOR FEATURES)$/i.test(l)));
  });
});

describe("Stellantis factory-build parse — real Ram 1500 sticker (different template instance, same format)", () => {
  const sticker = parseStellantisStickerText(RAM_1500, loadFixture(RAM_1500));

  it("reads a released 2021 Ram 1500 Limited, 4x4", () => {
    assert.equal(sticker.status, "released");
    assert.equal(sticker.year, 2021);
    assert.equal(sticker.make, "Ram");
    assert.equal(sticker.model, "Ram 1500");
    assert.match(sticker.trim || "", /Limited/i);
    assert.equal(sticker.drivetrain, "4X4");
    assert.match(sticker.engine || "", /5\.7L V8 HEMI/i);
  });

  it("prices check out: basePrice + optionsPrice + destination === msrp", () => {
    assert.equal(sticker.basePrice, 59900);
    assert.equal(sticker.destination, 1695);
    assert.equal(sticker.msrp, 73645);
    assert.equal(
      Math.round((sticker.basePrice! + sticker.optionsPrice! + sticker.destination!) * 100) / 100,
      sticker.msrp
    );
  });

  it("has many real priced options, e.g. a $1,495 Dual-Pane Panoramic Sunroof", () => {
    assert.ok(sticker.options.length > 10);
    const sunroof = sticker.options.find((o) => /Panoramic Sunroof/i.test(o.name));
    assert.equal(sunroof?.price, 1495);
  });
});

describe("Stellantis 'no window sticker for this VIN' response", () => {
  it("is detected as unreleased from the real confirmed response text, not invented as an error", () => {
    const sticker = parseStellantisStickerText(NOT_FOUND, loadFixture(NOT_FOUND));
    assert.equal(sticker.status, "unreleased");
    assert.equal(sticker.msrp, null);
    assert.equal(sticker.options.length, 0);
    assert.match(sticker.note || "", /not yet been released/i);
  });

  it("confirmStellantisMustHavesFromSticker never passes an unreleased sticker", () => {
    const sticker = parseStellantisStickerText(NOT_FOUND, loadFixture(NOT_FOUND));
    const check = confirmStellantisMustHavesFromSticker(sticker, ["Trailer-Tow Package"]);
    assert.equal(check.pass, false);
    assert.deepEqual(check.missing, ["Trailer-Tow Package"]);
  });
});

describe("Stellantis must-have matching and factory option breakout", () => {
  const sticker = parseStellantisStickerText(JEEP_WRANGLER, loadFixture(JEEP_WRANGLER));

  it("matches a real optional-equipment line, case/wording-insensitively", () => {
    assert.equal(stickerHasMustHave(sticker, "Trailer-Tow Package"), true);
    assert.equal(stickerHasMustHave(sticker, "Trailer Tow"), true);
    assert.equal(stickerHasMustHave(sticker, "Integrated Off-Road Camera"), true);
  });

  it("does not match standard (non-optional) equipment as if it were a paid must-have", () => {
    // Leather-Trimmed Bucket Seats is standard on this build, not an
    // optional line — must-have matching only checks sticker.options, same
    // convention as the Ford/GM modules.
    assert.equal(stickerHasMustHave(sticker, "Leather-Trimmed Bucket Seats"), false);
  });

  it("does not invent a match for something genuinely absent", () => {
    assert.equal(stickerHasMustHave(sticker, "Panoramic Sunroof"), false);
  });

  it("filterableFactoryOptions includes color must-have lines plus real priced options", () => {
    const names = filterableFactoryOptions(sticker).map((o) => o.name);
    assert.ok(names.some((n) => /^Exterior color:/i.test(n)));
    assert.ok(names.some((n) => /Trailer.{0,3}Tow Package/i.test(n)));
    assert.deepEqual(defaultMustHaveLines(sticker), []);
  });

  it("stellantisFactoryOptionBreakout mirrors the shared shopper-facing shape and is empty for an unreleased sticker", () => {
    const breakout = stellantisFactoryOptionBreakout(sticker);
    assert.ok(breakout.length > 0);
    for (const line of breakout) {
      assert.ok("code" in line && "description" in line && "price" in line && "isPackageChild" in line);
    }
    const unreleased = parseStellantisStickerText(NOT_FOUND, loadFixture(NOT_FOUND));
    assert.deepEqual(stellantisFactoryOptionBreakout(unreleased), []);
  });
});

describe("stellantisStickerToVehicle", () => {
  it("never invents a dealer name when SHIP TO/SOLD TO print blank (confirmed on both real fixtures)", () => {
    const sticker = parseStellantisStickerText(JEEP_WRANGLER, loadFixture(JEEP_WRANGLER));
    assert.equal(sticker.dealerSoldTo, undefined);
    const vehicle = stellantisStickerToVehicle(sticker, null, null, null);
    assert.equal(vehicle.location.dealerName, "Unknown dealer");
    assert.equal(vehicle.location.dealerConfirmed, false);
    assert.doesNotMatch(vehicle.location.dealerName, /jeep dealer/i, "never invent an OEM-generic dealer name");
  });

  it("prefers a live current-dealer lookup over the (absent) sticker fallback", () => {
    const sticker = parseStellantisStickerText(JEEP_WRANGLER, loadFixture(JEEP_WRANGLER));
    const currentDealer = {
      dealerName: "Space Chrysler Jeep Dodge Ram",
      dealerStreet: "100 Route 46",
      dealerCity: "Parsippany",
      dealerState: "NJ",
      dealerZip: "07054",
      dealerPhone: "973-555-0100",
      vdpUrl: "https://www.spacecjdr.com/vdp",
    };
    const vehicle = stellantisStickerToVehicle(sticker, null, null, currentDealer);
    assert.equal(vehicle.location.dealerName, "Space Chrysler Jeep Dodge Ram");
    assert.equal(vehicle.location.dealerConfirmed, true);
    assert.equal(vehicle.dealerUrl, "https://www.spacecjdr.com/vdp");
  });

  it("does not guess a bodyType — leaves it blank rather than assume SUV/Truck across four brands", () => {
    const sticker = parseStellantisStickerText(JEEP_WRANGLER, loadFixture(JEEP_WRANGLER));
    const vehicle = stellantisStickerToVehicle(sticker, null, null, null);
    assert.equal(vehicle.bodyType, "");
    assert.equal(vehicle.make, "Jeep");
  });
});

describe("paste import routes a Stellantis VIN to /api/stellantis-sticker", () => {
  it("importPastedFactoryVehicle keeps the pasted Jeep VIN", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      assert.match(String(input), /\/api\/stellantis-sticker/);
      return new Response(
        JSON.stringify({
          vin: JEEP_WRANGLER,
          vehicle: {
            vin: JEEP_WRANGLER,
            year: 2021,
            make: "Jeep",
            model: "Wrangler",
            trim: "Rubicon",
          },
          sticker: { status: "released", msrp: 76280 },
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const result = await importPastedFactoryVehicle(JEEP_WRANGLER, fetchImpl);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.vehicle.vin, JEEP_WRANGLER);
      assert.equal(result.oem, "stellantis");
    }
  });

  it("falls back to Stellantis when a generic dealer-URL paste tries Ford first and Ford's route resolves a Stellantis VIN", async () => {
    // A dealer URL with no brand keyword and no bare VIN substring makes
    // preferredFactoryBuildEndpoint return null, so importPastedFactoryVehicle
    // defaults to trying /api/ford-sticker first — the same "unknown URL,
    // guess Ford, then correct from what the route itself resolves" path
    // this generalized fallback logic now covers for any third OEM.
    const raw = "https://www.somegenericdealer.example/inventory/listing-12345";
    assert.equal(preferredFactoryBuildEndpoint(raw), null, "test setup: paste must not pre-resolve");
    const calledEndpoints: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calledEndpoints.push(url);
      if (url.includes("/api/ford-sticker")) {
        return new Response(
          JSON.stringify({ handled: false, notFord: true, vin: JEEP_WRANGLER }),
          { status: 200 }
        );
      }
      if (url.includes("/api/stellantis-sticker")) {
        return new Response(
          JSON.stringify({
            vin: JEEP_WRANGLER,
            vehicle: { vin: JEEP_WRANGLER, year: 2021, make: "Jeep", model: "Wrangler" },
            sticker: { status: "released", msrp: 76280 },
          }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected URL ${url}`);
    }) as typeof fetch;
    const result = await importPastedFactoryVehicle(raw, fetchImpl);
    assert.deepEqual(calledEndpoints, ["/api/ford-sticker", "/api/stellantis-sticker"]);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.vehicle.vin, JEEP_WRANGLER);
      assert.equal(result.oem, "stellantis");
    }
  });
});
