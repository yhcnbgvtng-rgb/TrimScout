import "./testdata/blockLiveHttp";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeGenesisFamilySticker, normalizeFordSticker, normalizeGmSticker, normalizeStellantisSticker, pendingFactoryBuildShell } from "./factoryBuild";
import type { GenesisSticker } from "./genesisSticker";
import type { FordSticker } from "./fordSticker";
import type { GmSticker } from "./gmSticker";
import type { StellantisSticker } from "./stellantisSticker";

function baseSticker(overrides: Partial<GenesisSticker> = {}): GenesisSticker {
  return {
    vin: "5NMJECDE6TH781852",
    status: "released",
    make: "Hyundai",
    year: 2026,
    model: "Tucson",
    trim: "Limited",
    exteriorColor: "Atlantis Blue",
    interiorColor: "Gray/Gray",
    basePrice: 41175,
    destination: 1650,
    optionsPrice: 375,
    msrp: 43200,
    options: [{ name: "Cross Rails", price: 375, isStandard: false, isPackageChild: false, source: "sticker" }],
    standardEquipment: ["Highway Driving Assist"],
    rawText: "some sticker text",
    pdfUrl: "https://hyundai-sticker.dealerfire.com/new/5NMJECDE6TH781852",
    fetchedAt: "2026-09-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeGenesisFamilySticker", () => {
  it("a released sticker becomes factory_verified with sticker provenance and mapped options", () => {
    const build = normalizeGenesisFamilySticker(baseSticker(), { providerId: "hyundai_dealerfire", url: "https://example/sticker.pdf" });
    assert.equal(build.status, "factory_verified");
    assert.equal(build.provenance, "sticker");
    assert.equal(build.vin, "5NMJECDE6TH781852");
    assert.equal(build.trim, "Limited");
    assert.equal(build.msrp.total, 43200);
    assert.equal(build.options.length, 1);
    assert.deepEqual(build.options[0], { code: null, rawName: "Cross Rails", catalogId: null, msrpDelta: 375, kind: "option" });
    assert.equal(build.colors.exterior, "Atlantis Blue");
    assert.equal(build.stickerSource?.type, "hyundai_dealerfire");
    assert.ok(build.stickerSource?.contentHash);
    assert.equal(build.parse.confidence, "high");
    assert.deepEqual(build.parse.warnings, []);
  });

  it("MSRP that does not reconcile with base + destination + options gets a warning, never a silent drop", () => {
    const build = normalizeGenesisFamilySticker(
      baseSticker({ msrp: 99999 }),
      { providerId: "hyundai_dealerfire", url: null }
    );
    assert.equal(build.status, "factory_verified");
    assert.equal(build.parse.confidence, "medium");
    assert.match(build.parse.warnings[0], /does not reconcile/);
  });

  it("a released sticker with zero options is still factory_verified, with an explicit warning (not silence)", () => {
    const build = normalizeGenesisFamilySticker(
      baseSticker({ options: [], optionsPrice: 0, msrp: 42825 }),
      { providerId: "genesis_oem", url: null }
    );
    assert.equal(build.status, "factory_verified");
    assert.deepEqual(build.options, []);
    assert.match(build.parse.warnings[0], /no added factory options/);
  });

  it("a package header followed by its child lines classifies as package/option, and children never carry their own price", () => {
    const build = normalizeGenesisFamilySticker(
      baseSticker({
        options: [
          { name: "Advanced Package", price: 4700, isStandard: false, isPackageChild: false, source: "sticker" },
          { name: "Heated Steering Wheel", price: null, isStandard: false, isPackageChild: true, source: "sticker" },
          { name: "Cross Rails", price: 375, isStandard: false, isPackageChild: false, source: "sticker" },
        ],
        optionsPrice: 5075,
        msrp: 47900,
      }),
      { providerId: "genesis_oem", url: null }
    );
    assert.equal(build.options[0].kind, "package");
    assert.equal(build.options[0].msrpDelta, 4700);
    assert.equal(build.options[1].kind, "option");
    assert.equal(build.options[1].msrpDelta, null);
    assert.equal(build.options[2].kind, "option");
  });

  it("canonicalize is additive: a resolver can attach a catalogId without changing rawName/code", () => {
    const build = normalizeGenesisFamilySticker(baseSticker(), { providerId: "hyundai_dealerfire", url: null }, {
      resolveCatalogId: (opt) => (opt.rawName === "Cross Rails" ? "cat_cross_rails" : null),
    });
    assert.equal(build.options[0].catalogId, "cat_cross_rails");
    assert.equal(build.options[0].rawName, "Cross Rails");
  });

  it("an unreleased sticker becomes factory_pending with no options and no invented sticker fields", () => {
    const build = normalizeGenesisFamilySticker(
      baseSticker({ status: "unreleased", note: "Factory window sticker not published yet — we'll keep checking.", options: [], msrp: null, basePrice: null, destination: null, optionsPrice: null }),
      { providerId: "hyundai_dealerfire", url: null }
    );
    assert.equal(build.status, "factory_pending");
    assert.deepEqual(build.options, []);
    assert.equal(build.msrp.total, null);
  });

  it("a sticker whose text never matched the requested VIN becomes parse_failed, not factory_verified", () => {
    const build = normalizeGenesisFamilySticker(baseSticker({ status: "error" }), { providerId: "hyundai_dealerfire", url: null });
    assert.equal(build.status, "parse_failed");
    assert.deepEqual(build.options, []);
  });
});

describe("normalizeFordSticker / normalizeGmSticker / normalizeStellantisSticker", () => {
  it("Ford: same shape as the Genesis family, but FordOptionLine has no code field at all — always null", () => {
    const sticker: FordSticker = {
      vin: "1FTFW1ED5PFA12345",
      status: "released",
      make: "Ford",
      year: 2023,
      model: "F-150",
      trim: "Lariat",
      basePrice: 52000,
      destination: 1795,
      optionsPrice: 3200,
      msrp: 56995,
      options: [{ name: "502A Equipment Group", price: 3200, isStandard: false, isPackageChild: false, source: "sticker" }],
      standardEquipment: [],
      rawText: "ford sticker text",
      pdfUrl: "https://windowsticker.forddirect.com/windowsticker.pdf?vin=1FTFW1ED5PFA12345",
      fetchedAt: "2026-09-17T00:00:00.000Z",
    };
    const build = normalizeFordSticker(sticker, { providerId: "ford_windowsticker", url: sticker.pdfUrl });
    assert.equal(build.status, "factory_verified");
    assert.equal(build.options[0].code, null);
    assert.equal(build.options[0].rawName, "502A Equipment Group");
    assert.equal(build.parse.parserId, "ford_v1");
  });

  it("GM: an option's code comes from the RPO field", () => {
    const sticker: GmSticker = {
      vin: "3GNAXPEG1VL131423",
      status: "released",
      make: "Chevrolet",
      year: 2027,
      model: "Equinox",
      trim: "RS",
      basePrice: 31600,
      destination: 1395,
      optionsPrice: 1450,
      msrp: 34445,
      options: [{ name: "RS Package", rpo: "PDS", price: 1450, isStandard: false, isPackageChild: false, source: "sticker" }],
      standardEquipment: [],
      rawText: "gm sticker text",
      pdfUrl: "https://cws.gm.com/vs-cws/vehshop/v2/vehicle/windowsticker?vin=3GNAXPEG1VL131423",
      fetchedAt: "2026-09-17T00:00:00.000Z",
    };
    const build = normalizeGmSticker(sticker, { providerId: "gm_cws", url: sticker.pdfUrl });
    assert.equal(build.options[0].code, "PDS");
    assert.equal(build.parse.parserId, "gm_v1");
  });

  it("Stellantis: an option's code comes from the code field, same as Genesis", () => {
    const sticker: StellantisSticker = {
      vin: "1C4RJFBG5NC123456",
      status: "released",
      make: "Jeep",
      year: 2022,
      model: "Grand Cherokee",
      trim: "Limited",
      basePrice: 48000,
      destination: 1795,
      optionsPrice: 2495,
      msrp: 52290,
      options: [{ name: "Trailer Tow Group", code: "AHQ", price: 2495, isStandard: false, isPackageChild: false, source: "sticker" }],
      standardEquipment: [],
      rawText: "stellantis sticker text",
      pdfUrl: "https://www.chrysler.com/hostd/windowsticker/getWindowStickerPdf.do?vin=1C4RJFBG5NC123456",
      fetchedAt: "2026-09-17T00:00:00.000Z",
    };
    const build = normalizeStellantisSticker(sticker, { providerId: "stellantis_hostd", url: sticker.pdfUrl });
    assert.equal(build.options[0].code, "AHQ");
    assert.equal(build.parse.parserId, "stellantis_v1");
  });

  it("an unreleased GM sticker is factory_pending, not verified, and carries no options", () => {
    const sticker: GmSticker = {
      vin: "3GNAXPEG1VL131423",
      status: "unreleased",
      msrp: null,
      basePrice: null,
      optionsPrice: null,
      destination: null,
      options: [],
      standardEquipment: [],
      rawText: "",
      pdfUrl: "https://cws.gm.com/vs-cws/vehshop/v2/vehicle/windowsticker?vin=3GNAXPEG1VL131423",
      fetchedAt: "2026-09-17T00:00:00.000Z",
      note: "GM has no factory build on file for this VIN.",
    };
    const build = normalizeGmSticker(sticker, { providerId: "gm_cws", url: sticker.pdfUrl });
    assert.equal(build.status, "factory_pending");
    assert.deepEqual(build.options, []);
  });
});

describe("pendingFactoryBuildShell", () => {
  it("is factory_pending with a note and no sticker source, for a brand with no wired provider", () => {
    const shell = pendingFactoryBuildShell("1FTFW1ED5PFA12345", "No factory sticker provider is wired for this VIN's brand yet.");
    assert.equal(shell.status, "factory_pending");
    assert.equal(shell.stickerSource, null);
    assert.equal(shell.parse.warnings[0], "No factory sticker provider is wired for this VIN's brand yet.");
  });
});
