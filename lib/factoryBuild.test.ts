import "./testdata/blockLiveHttp";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeGenesisFamilySticker, pendingFactoryBuildShell } from "./factoryBuild";
import type { GenesisSticker } from "./genesisSticker";

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

describe("pendingFactoryBuildShell", () => {
  it("is factory_pending with a note and no sticker source, for a brand with no wired provider", () => {
    const shell = pendingFactoryBuildShell("1FTFW1ED5PFA12345", "No factory sticker provider is wired for this VIN's brand yet.");
    assert.equal(shell.status, "factory_pending");
    assert.equal(shell.stickerSource, null);
    assert.equal(shell.parse.warnings[0], "No factory sticker provider is wired for this VIN's brand yet.");
  });
});
