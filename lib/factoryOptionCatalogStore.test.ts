import "./testdata/blockLiveHttp";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeGenesisFamilySticker } from "./factoryBuild";
import { upsertFactoryBuild } from "./factoryBuildStore";
import { canonicalizeFactoryBuildOptions, searchFactoryOptions } from "./factoryOptionCatalogStore";
import type { GenesisSticker } from "./genesisSticker";

const SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "factory-option-catalog-test-"));
const ORIGINAL_BUILD_PATH = process.env.FACTORY_BUILD_STORE_PATH;
const ORIGINAL_CATALOG_PATH = process.env.FACTORY_OPTION_CATALOG_STORE_PATH;
process.env.FACTORY_BUILD_STORE_PATH = path.join(SCRATCH_DIR, "factory-builds.json");
process.env.FACTORY_OPTION_CATALOG_STORE_PATH = path.join(SCRATCH_DIR, "factory-option-catalog.json");

before(() => {
  process.env.FACTORY_BUILD_STORE_PATH = path.join(SCRATCH_DIR, "factory-builds.json");
  process.env.FACTORY_OPTION_CATALOG_STORE_PATH = path.join(SCRATCH_DIR, "factory-option-catalog.json");
});
after(() => {
  process.env.FACTORY_BUILD_STORE_PATH = ORIGINAL_BUILD_PATH;
  process.env.FACTORY_OPTION_CATALOG_STORE_PATH = ORIGINAL_CATALOG_PATH;
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
});

function releasedSticker(vin: string, optionName: string, price: number): GenesisSticker {
  return {
    vin,
    status: "released",
    make: "Hyundai",
    year: 2026,
    model: "Tucson",
    trim: "Limited",
    basePrice: 30000,
    destination: 1500,
    optionsPrice: price,
    msrp: 30000 + 1500 + price,
    options: [{ name: optionName, price, isStandard: false, isPackageChild: false, source: "sticker" }],
    standardEquipment: [],
    rawText: "text",
    pdfUrl: "https://example/sticker.pdf",
    fetchedAt: "2026-09-18T00:00:00.000Z",
  };
}

describe("canonicalizeFactoryBuildOptions", () => {
  it("fills catalogId on an option that doesn't have one, without touching rawName/code", async () => {
    const build = normalizeGenesisFamilySticker(releasedSticker("5NMJECDE6TH781852", "Cross Rails", 375), { providerId: "hyundai_dealerfire", url: null });
    assert.equal(build.options[0].catalogId, null);
    const canonicalized = await canonicalizeFactoryBuildOptions(build);
    assert.ok(canonicalized.options[0].catalogId);
    assert.equal(canonicalized.options[0].rawName, "Cross Rails");
  });

  it("a differently-cased option name on another VIN resolves to the SAME catalogId", async () => {
    const buildA = await canonicalizeFactoryBuildOptions(
      normalizeGenesisFamilySticker(releasedSticker("5NMJECDE6TH781852", "Heated Steering Wheel", 250), { providerId: "hyundai_dealerfire", url: null })
    );
    const buildB = await canonicalizeFactoryBuildOptions(
      normalizeGenesisFamilySticker(releasedSticker("5NMJECDE6TH781999", "HEATED STEERING WHEEL", 250), { providerId: "hyundai_dealerfire", url: null })
    );
    assert.equal(buildA.options[0].catalogId, buildB.options[0].catalogId);
  });

  it("an already-set catalogId (e.g. from a custom resolveCatalogId) is left alone", async () => {
    const build = normalizeGenesisFamilySticker(
      releasedSticker("5NMJECDE6TH782000", "Wireless Charging Pad", 150),
      { providerId: "hyundai_dealerfire", url: null },
      { resolveCatalogId: () => "cat_manual_override" }
    );
    const canonicalized = await canonicalizeFactoryBuildOptions(build);
    assert.equal(canonicalized.options[0].catalogId, "cat_manual_override");
  });

  it("a build with no options (pending/failed) passes through unchanged", async () => {
    const build = normalizeGenesisFamilySticker(
      { ...releasedSticker("5NMJECDE6TH782001", "irrelevant", 0), status: "unreleased", options: [], msrp: null, basePrice: null, destination: null, optionsPrice: null },
      { providerId: "hyundai_dealerfire", url: null }
    );
    const canonicalized = await canonicalizeFactoryBuildOptions(build);
    assert.deepEqual(canonicalized.options, []);
  });
});

describe("searchFactoryOptions", () => {
  it("finds an option by name and reports every VIN that actually carries it", async () => {
    const buildA = await canonicalizeFactoryBuildOptions(
      normalizeGenesisFamilySticker(releasedSticker("5NMJECDE6TH900001", "Panoramic Sunroof", 1200), { providerId: "hyundai_dealerfire", url: null })
    );
    const buildB = await canonicalizeFactoryBuildOptions(
      normalizeGenesisFamilySticker(releasedSticker("5NMJECDE6TH900002", "panoramic sunroof", 1200), { providerId: "hyundai_dealerfire", url: null })
    );
    await upsertFactoryBuild(buildA);
    await upsertFactoryBuild(buildB);

    const results = await searchFactoryOptions("sunroof");
    assert.equal(results.length, 1);
    assert.equal(results[0].canonicalName, "Panoramic Sunroof");
    assert.deepEqual(new Set(results[0].vins), new Set(["5NMJECDE6TH900001", "5NMJECDE6TH900002"]));
  });

  it("a query with no catalog match returns an empty array", async () => {
    assert.deepEqual(await searchFactoryOptions("nonexistent-option-xyz"), []);
  });

  it("an empty query returns an empty array rather than throwing", async () => {
    assert.deepEqual(await searchFactoryOptions(""), []);
  });
});
