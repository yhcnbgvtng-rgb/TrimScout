import "./testdata/blockLiveHttp";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFactoryBuildPipeline } from "./factoryBuildPipeline";
import { getFactoryBuild } from "./factoryBuildStore";
import type { StickerProvider } from "./factoryBuildProviders";
import { normalizeGenesisFamilySticker } from "./factoryBuild";
import type { DecodedVehicle } from "./vinDecoder";

const SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "factory-build-pipeline-test-"));
const ORIGINAL_BUILD_STORE_ENV = process.env.FACTORY_BUILD_STORE_PATH;
const ORIGINAL_CATALOG_STORE_ENV = process.env.FACTORY_OPTION_CATALOG_STORE_PATH;
process.env.FACTORY_BUILD_STORE_PATH = path.join(SCRATCH_DIR, "factory-builds.json");
process.env.FACTORY_OPTION_CATALOG_STORE_PATH = path.join(SCRATCH_DIR, "factory-option-catalog.json");

before(() => {
  process.env.FACTORY_BUILD_STORE_PATH = path.join(SCRATCH_DIR, "factory-builds.json");
  process.env.FACTORY_OPTION_CATALOG_STORE_PATH = path.join(SCRATCH_DIR, "factory-option-catalog.json");
});
after(() => {
  process.env.FACTORY_BUILD_STORE_PATH = ORIGINAL_BUILD_STORE_ENV;
  process.env.FACTORY_OPTION_CATALOG_STORE_PATH = ORIGINAL_CATALOG_STORE_ENV;
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
});

const NO_PROVIDER_VIN = "3TMCZ5AN0RM123456"; // Toyota — MarketCheck-fed, never registered as a factory sticker provider
const HYUNDAI_VIN = "5NMJECDE6TH781852";

function fakeProvider(status: "released" | "unreleased" | "error"): StickerProvider {
  return {
    id: "fake_oem",
    make: "Fake",
    matchesVin: () => true,
    fetch: async (vin) => {
      const sticker = {
        vin,
        status,
        make: "FakeMake",
        year: 2026,
        model: "Model X",
        trim: "Limited",
        exteriorColor: "Black",
        interiorColor: "Tan",
        basePrice: 40000,
        destination: 1500,
        optionsPrice: 500,
        msrp: 42000,
        options: status === "released" ? [{ name: "Sunroof", price: 500, isStandard: false, isPackageChild: false, source: "sticker" as const }] : [],
        standardEquipment: [],
        rawText: status === "released" ? "sticker text" : "",
        pdfUrl: "https://example/sticker.pdf",
        fetchedAt: "2026-09-17T00:00:00.000Z",
      };
      return normalizeGenesisFamilySticker(sticker, { providerId: "fake_oem", url: sticker.pdfUrl });
    },
  };
}

describe("runFactoryBuildPipeline", () => {
  it("acquires, normalizes, canonicalizes and persists a factory_verified build end to end (enrich disabled)", async () => {
    const build = await runFactoryBuildPipeline(HYUNDAI_VIN, { provider: fakeProvider("released"), enrich: false });
    assert.equal(build.status, "factory_verified");
    assert.equal(build.options.length, 1);
    assert.ok(build.options[0].catalogId, "canonicalize (default on) fills catalogId");
    const stored = await getFactoryBuild(HYUNDAI_VIN);
    assert.equal(stored?.status, "factory_verified");
  });

  it("canonicalize: false skips the catalog stage, leaving catalogId null", async () => {
    const build = await runFactoryBuildPipeline(HYUNDAI_VIN, { provider: fakeProvider("released"), enrich: false, canonicalize: false });
    assert.equal(build.options[0].catalogId, null);
  });

  it("is idempotent — running twice for the same VIN replaces the record rather than duplicating it", async () => {
    await runFactoryBuildPipeline(HYUNDAI_VIN, { provider: fakeProvider("released"), enrich: false });
    await runFactoryBuildPipeline(HYUNDAI_VIN, { provider: fakeProvider("released"), enrich: false });
    const stored = await getFactoryBuild(HYUNDAI_VIN);
    assert.equal(stored?.options.length, 1);
  });

  it("a VIN with no wired sticker provider never reaches factory_verified, and enrich (when it resolves) yields decode_provisional, not sticker", async () => {
    const decode = async (): Promise<DecodedVehicle | null> => ({ vin: NO_PROVIDER_VIN, year: 2024, make: "Toyota", model: "Corolla" });
    const build = await runFactoryBuildPipeline(NO_PROVIDER_VIN, { provider: null, decode });
    assert.equal(build.status, "decode_provisional");
    assert.equal(build.provenance, "decode_provisional");
    assert.deepEqual(build.options, []);
  });

  it("an unreleased sticker stays factory_pending when enrich is off — never invents a build from nothing", async () => {
    const build = await runFactoryBuildPipeline("5NMJECDE7TH000002", { provider: fakeProvider("unreleased"), enrich: false });
    assert.equal(build.status, "factory_pending");
  });

  it("a sticker whose text mismatched the VIN becomes parse_failed, and enrich mismatches never overwrite it back to verified", async () => {
    const decode = async (): Promise<DecodedVehicle | null> => ({ vin: "5NMJECDE7TH000003", year: 2026, make: "FakeMake", model: "Model X" });
    const build = await runFactoryBuildPipeline("5NMJECDE7TH000003", { provider: fakeProvider("error"), decode });
    assert.equal(build.status, "parse_failed");
  });

  it("rejects a VIN that isn't 17 characters", async () => {
    await assert.rejects(() => runFactoryBuildPipeline("SHORTVIN", { provider: null }));
  });
});
