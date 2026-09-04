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
  isGenesisVin,
  isGmVin,
  looksLikeGenesisPaste,
} from "./oemWmi";
import {
  classifyGenesisFetchBody,
  clearGenesisStickerMemoryCache,
  confirmGenesisMustHavesFromSticker,
  defaultMustHaveLines,
  filterableFactoryOptions,
  genesisFactoryOptionBreakout,
  genesisStickerFromFetchedBytes,
  genesisStickerPdfUrl,
  genesisStickerToVehicle,
  parseGenesisStickerText,
  stickerHasMustHave,
} from "./genesisSticker";

const FIXTURE_DIR = path.join(import.meta.dirname, "testdata", "genesis-stickers");
const G90 = "KMTFC4SD2RU039916";
const G80 = "KMTGA4SC4PU151020";
const FORD_SUBJECT = "1FMWK8JCXTGB47204";

function loadFixture(vin: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${vin}.txt`), "utf8");
}

function clearVinDiskCache(vin: string): void {
  clearGenesisStickerMemoryCache();
  for (const ext of ["json", "pdf"]) {
    try {
      fs.unlinkSync(path.join("/tmp", "trimscout-genesis-stickers", `${vin}.${ext}`));
    } catch {
      /* miss */
    }
  }
}

describe("Genesis WMI routing", () => {
  it("detects KMG/KMT/KMU (Ulsan, Korea) and 5NM (Alabama)", () => {
    assert.equal(isGenesisVin(G90), true);
    assert.equal(isGenesisVin(G80), true);
    assert.equal(isGenesisVin("5NMJBCAE5PH123456"), true);
    assert.equal(isGenesisVin(FORD_SUBJECT), false);
    assert.equal(isGenesisVin("WP0AB2A98SS160032"), false, "Porsche VIN must not collide");
    assert.equal(isGmVin(G90), false);
    assert.equal(isFordOrLincolnVin(G90), false);
  });

  it("recognizes genesis.com paste text and the sticker URL", () => {
    assert.equal(looksLikeGenesisPaste(G90), true);
    assert.equal(looksLikeGenesisPaste(genesisStickerPdfUrl(G90)), true);
    assert.equal(looksLikeGenesisPaste("https://www.genesis.com/us/en/gv80"), true);
    assert.equal(looksLikeGenesisPaste("Check out this Genesis G80"), true);
    assert.equal(looksLikeGenesisPaste(FORD_SUBJECT), false);
  });

  it("preferredFactoryBuildEndpoint routes each OEM correctly, including the new Genesis branch", () => {
    assert.equal(preferredFactoryBuildEndpoint(G90), "/api/genesis-sticker");
    assert.equal(preferredFactoryBuildEndpoint(G80), "/api/genesis-sticker");
    assert.equal(preferredFactoryBuildEndpoint(FORD_SUBJECT), "/api/ford-sticker");
    // Porsche has its own (listing-feed-backed) route now — see lib/porscheSticker.ts.
    assert.equal(preferredFactoryBuildEndpoint("WP0AB2A98SS160032"), "/api/porsche-sticker");
  });
});

describe("Genesis factory-build parse — real G90 sticker (no separate trim printed)", () => {
  const sticker = parseGenesisStickerText(G90, loadFixture(G90));

  it("reads a released 2024 Genesis G90 3.5T E-Supercharger, AWD", () => {
    assert.equal(sticker.status, "released");
    assert.equal(sticker.year, 2024);
    assert.equal(sticker.make, "Genesis");
    assert.equal(sticker.model, "G90");
    assert.equal(sticker.drivetrain, "AWD");
    assert.match(sticker.engine || "", /3\.5L V6 T-GDI/i);
    assert.match(sticker.engine || "", /409 HP/i, "engine bullet wraps across two physical lines — must not be truncated mid-parenthetical");
    assert.match(sticker.transmission || "", /8.speed Automatic/i);
  });

  it("has no separate trim on this sticker — a real state, not a parse failure", () => {
    assert.ok(!sticker.trim, "G90's headline has no trim word at all, confirmed on the real fixture");
  });

  it("colors parse cleanly, label-then-newline-then-value", () => {
    assert.equal(sticker.exteriorColor, "Verbier White");
    assert.equal(sticker.interiorColor, "Black / Bordeaux");
  });

  it("sums real itemized option prices for optionsPrice (unlike Stellantis, every option here carries a real price)", () => {
    assert.equal(sticker.basePrice, 99500);
    assert.equal(sticker.destination, 1250);
    assert.equal(sticker.msrp, 102950);
    assert.equal(sticker.optionsPrice, 2200);
    assert.equal(
      Math.round((sticker.basePrice! + sticker.optionsPrice! + sticker.destination!) * 100) / 100,
      sticker.msrp,
      "sanity check: the parsed total actually equals base + options + destination"
    );
  });

  it("parses the real priced options, stripped of their leading bullet and asterisk", () => {
    const names = sticker.options.map((o) => o.name);
    assert.ok(names.some((n) => /Verbier White/i.test(n)));
    const paint = sticker.options.find((o) => /Verbier White/i.test(o.name));
    assert.equal(paint?.price, 1500);
    assert.ok(!names.some((n) => n.startsWith("*")), "leading asterisk must be stripped from option names");
  });

  it("has a real, populated dealer (SOLD TO) — unlike Stellantis, which always prints blank", () => {
    assert.deepEqual(sticker.dealerSoldTo, {
      name: "GENESIS OF LAGUNA NIGUEL",
      address: "28432 CAMINO CAPISTRANO",
      city: "LAGUNA NIGUEL",
      state: "CA",
      zip: "92677",
      source: "sticker",
    });
  });

  it("standard equipment is captured and its own sub-headers are filtered out", () => {
    assert.ok(sticker.standardEquipment.length > 10);
    assert.ok(sticker.standardEquipment.some((l) => /Forward Collision-Avoidance Assist/i.test(l)));
    assert.ok(!sticker.standardEquipment.some((l) => /^(ADVANCED SAFETY TECHNOLOGY|POWERTRAIN TECHNOLOGY|COMFORT & CONVENIENCE)$/i.test(l)));
  });
});

describe("Genesis factory-build parse — real G80 sticker (package headers with unpriced children)", () => {
  const sticker = parseGenesisStickerText(G80, loadFixture(G80));

  it("reads a released 2023 Genesis G80 AWD 2.5T Sport Prestige", () => {
    assert.equal(sticker.status, "released");
    assert.equal(sticker.year, 2023);
    assert.equal(sticker.make, "Genesis");
    assert.equal(sticker.model, "G80");
    assert.equal(sticker.trim, "Sport Prestige");
    assert.equal(sticker.drivetrain, "AWD");
    assert.match(sticker.engine || "", /2\.5L I4 T-GDI/i, "single-line engine bullet must not regress under the multi-line-join logic");
    assert.match(sticker.transmission || "", /8.Speed Automatic/i);
  });

  it("prices check out: basePrice + optionsPrice + destination === msrp", () => {
    assert.equal(sticker.basePrice, 52650);
    assert.equal(sticker.destination, 1095);
    assert.equal(sticker.msrp, 64790);
    assert.equal(sticker.optionsPrice, 11045);
    assert.equal(
      Math.round((sticker.basePrice! + sticker.optionsPrice! + sticker.destination!) * 100) / 100,
      sticker.msrp
    );
  });

  it("distinguishes a priced package header from its unpriced child bullets", () => {
    const advanced = sticker.options.find((o) => /^Advanced Package$/i.test(o.name));
    assert.equal(advanced?.price, 4700);
    assert.equal(advanced?.isPackageChild, false);
    const sportPrestige = sticker.options.find((o) => /^Sport Prestige Package$/i.test(o.name));
    assert.equal(sportPrestige?.price, 5500);
    assert.equal(sportPrestige?.isPackageChild, false);
    const child = sticker.options.find((o) => /Panoramic Sunroof/i.test(o.name));
    assert.equal(child?.price, null);
    assert.equal(child?.isPackageChild, true);
  });

  it("Accessories bullets after a package reset to standalone priced items, not package children", () => {
    const mudguards = sticker.options.find((o) => /^Mudguards$/i.test(o.name));
    assert.equal(mudguards?.price, 140);
    assert.equal(mudguards?.isPackageChild, false);
  });

  it("has a real, populated dealer (SOLD TO)", () => {
    assert.deepEqual(sticker.dealerSoldTo, {
      name: "GENESIS OF CHERRY HILL",
      address: "500 W. ROUTE 70",
      city: "MARLTON",
      state: "NJ",
      zip: "08053",
      source: "sticker",
    });
  });
});

describe("Genesis 'no factory build for this VIN' response", () => {
  it("classifies an empty HTTP 200 body as the not-found signal — simpler than every other OEM, no PDF to parse", () => {
    const kind = classifyGenesisFetchBody(new Uint8Array(0));
    assert.equal(kind, "empty");
  });

  it("genesisStickerFromFetchedBytes turns an empty body into an unreleased sticker, never an invented error", () => {
    const result = genesisStickerFromFetchedBytes(G90, new Uint8Array(0));
    assert.equal(result.kind, "empty");
    assert.equal(result.sticker?.status, "unreleased");
    assert.equal(result.sticker?.msrp, null);
    assert.equal(result.sticker?.options.length, 0);
  });

  it("confirmGenesisMustHavesFromSticker never passes an unreleased sticker", () => {
    const unreleased = genesisStickerFromFetchedBytes(G90, new Uint8Array(0)).sticker!;
    const check = confirmGenesisMustHavesFromSticker(unreleased, ["Panoramic Sunroof"]);
    assert.equal(check.pass, false);
    assert.deepEqual(check.missing, ["Panoramic Sunroof"]);
  });
});

describe("Genesis must-have matching and factory option breakout", () => {
  const sticker = parseGenesisStickerText(G80, loadFixture(G80));

  it("matches a real optional-equipment line, case/wording-insensitively", () => {
    assert.equal(stickerHasMustHave(sticker, "Advanced Package"), true);
    assert.equal(stickerHasMustHave(sticker, "Panoramic Sunroof"), true);
  });

  it("does not match standard (non-optional) equipment as if it were a paid must-have", () => {
    assert.equal(stickerHasMustHave(sticker, "Heated Front & Rear Seats"), false);
  });

  it("does not invent a match for something genuinely absent", () => {
    assert.equal(stickerHasMustHave(sticker, "Massage Function"), false);
  });

  it("filterableFactoryOptions includes color must-have lines plus real priced options", () => {
    const names = filterableFactoryOptions(sticker).map((o) => o.name);
    assert.ok(names.some((n) => /^Exterior color:/i.test(n)));
    assert.ok(names.some((n) => /^Advanced Package$/i.test(n)));
    assert.deepEqual(defaultMustHaveLines(sticker), []);
  });

  it("genesisFactoryOptionBreakout mirrors the shared shopper-facing shape and is empty for an unreleased sticker", () => {
    const breakout = genesisFactoryOptionBreakout(sticker);
    assert.ok(breakout.length > 0);
    for (const line of breakout) {
      assert.ok("code" in line && "description" in line && "price" in line && "isPackageChild" in line);
    }
    const unreleased = genesisStickerFromFetchedBytes(G90, new Uint8Array(0)).sticker!;
    assert.deepEqual(genesisFactoryOptionBreakout(unreleased), []);
  });
});

describe("genesisStickerToVehicle", () => {
  it("prefers the real sticker dealer over the generic default when SOLD TO is populated (unlike Stellantis)", () => {
    const sticker = parseGenesisStickerText(G80, loadFixture(G80));
    const vehicle = genesisStickerToVehicle(sticker, null, null, null);
    assert.equal(vehicle.location.dealerName, "GENESIS OF CHERRY HILL");
    assert.equal(vehicle.location.dealerConfirmed, false, "sticker-sourced dealer is not a confirmed live listing");
  });

  it("prefers a live current-dealer lookup over the sticker's own dealer", () => {
    const sticker = parseGenesisStickerText(G80, loadFixture(G80));
    const currentDealer = {
      dealerName: "Genesis of Cherry Hill",
      dealerStreet: "500 W. Route 70",
      dealerCity: "Marlton",
      dealerState: "NJ",
      dealerZip: "08053",
      dealerPhone: "856-555-0100",
      vdpUrl: "https://www.genesisofcherryhill.com/vdp",
    };
    const vehicle = genesisStickerToVehicle(sticker, null, null, currentDealer);
    assert.equal(vehicle.location.dealerName, "Genesis of Cherry Hill");
    assert.equal(vehicle.location.dealerConfirmed, true);
    assert.equal(vehicle.dealerUrl, "https://www.genesisofcherryhill.com/vdp");
  });

  it("does not guess a bodyType — Genesis spans sedans and SUVs, never assume which", () => {
    const sticker = parseGenesisStickerText(G80, loadFixture(G80));
    const vehicle = genesisStickerToVehicle(sticker, null, null, null);
    assert.equal(vehicle.bodyType, "");
    assert.equal(vehicle.make, "Genesis");
  });
});

describe("paste import routes a Genesis VIN to /api/genesis-sticker", () => {
  it("importPastedFactoryVehicle keeps the pasted G90 VIN", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      assert.match(String(input), /\/api\/genesis-sticker/);
      return new Response(
        JSON.stringify({
          vin: G90,
          vehicle: {
            vin: G90,
            year: 2024,
            make: "Genesis",
            model: "G90",
          },
          sticker: { status: "released", msrp: 102950 },
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const result = await importPastedFactoryVehicle(G90, fetchImpl);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.vehicle.vin, G90);
      assert.equal(result.oem, "genesis");
    }
  });

  it("falls back to Genesis when a generic dealer-URL paste tries Ford first and Ford's route resolves a Genesis VIN", async () => {
    const raw = "https://www.somegenericdealer.example/inventory/listing-12345";
    assert.equal(preferredFactoryBuildEndpoint(raw), null, "test setup: paste must not pre-resolve");
    const calledEndpoints: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calledEndpoints.push(url);
      if (url.includes("/api/ford-sticker")) {
        return new Response(
          JSON.stringify({ handled: false, notFord: true, vin: G90 }),
          { status: 200 }
        );
      }
      if (url.includes("/api/genesis-sticker")) {
        return new Response(
          JSON.stringify({
            vin: G90,
            vehicle: { vin: G90, year: 2024, make: "Genesis", model: "G90" },
            sticker: { status: "released", msrp: 102950 },
          }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected URL ${url}`);
    }) as typeof fetch;
    const result = await importPastedFactoryVehicle(raw, fetchImpl);
    assert.deepEqual(calledEndpoints, ["/api/ford-sticker", "/api/genesis-sticker"]);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.vehicle.vin, G90);
      assert.equal(result.oem, "genesis");
    }
  });
});
