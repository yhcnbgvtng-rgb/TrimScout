import "./testdata/blockLiveHttp";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { enrichFactoryBuild } from "./factoryBuildEnrich";
import { normalizeGenesisFamilySticker, pendingFactoryBuildShell } from "./factoryBuild";
import type { GenesisSticker } from "./genesisSticker";
import type { DecodedVehicle } from "./vinDecoder";

const VIN = "5NMJECDE6TH781852";

function releasedSticker(overrides: Partial<GenesisSticker> = {}): GenesisSticker {
  return {
    vin: VIN,
    status: "released",
    make: "Hyundai",
    year: 2026,
    model: "Tucson",
    trim: "",
    exteriorColor: "Atlantis Blue",
    interiorColor: "Gray/Gray",
    basePrice: 41175,
    destination: 1650,
    optionsPrice: 0,
    msrp: 42825,
    options: [],
    standardEquipment: [],
    rawText: "text",
    pdfUrl: "https://example/sticker.pdf",
    fetchedAt: "2026-09-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("enrichFactoryBuild", () => {
  it("never overwrites sticker MSRP/options, and only flags a make/model mismatch instead of correcting it", async () => {
    const build = normalizeGenesisFamilySticker(releasedSticker({ trim: "Limited" }), { providerId: "hyundai_dealerfire", url: null });
    const decode = async (): Promise<DecodedVehicle | null> => ({ vin: VIN, year: 2026, make: "Hyundai", model: "Santa Fe" });
    const enriched = await enrichFactoryBuild(build, { decode });
    assert.equal(enriched.status, "factory_verified", "status stays factory_verified — a decode mismatch never demotes a verified sticker");
    assert.equal(enriched.model, "Tucson", "sticker model is ground truth, never overwritten");
    assert.equal(enriched.msrp.total, 42825);
    assert.equal(enriched.enrich?.matched, false);
    assert.deepEqual(enriched.enrich?.mismatches, [{ field: "model", stickerValue: "Tucson", decodeValue: "Santa Fe" }]);
  });

  it("fills a genuinely missing trim from decode and marks provenance mixed", async () => {
    const build = normalizeGenesisFamilySticker(releasedSticker({ trim: "" }), { providerId: "hyundai_dealerfire", url: null });
    const decode = async (): Promise<DecodedVehicle | null> => ({ vin: VIN, year: 2026, make: "Hyundai", model: "Tucson", trim: "Limited" });
    const enriched = await enrichFactoryBuild(build, { decode });
    assert.equal(enriched.trim, "Limited");
    assert.equal(enriched.provenance, "mixed");
    assert.equal(enriched.enrich?.matched, true);
  });

  it("a build with no sticker (factory_pending) upgrades to decode_provisional when NHTSA resolves the VIN", async () => {
    const shell = pendingFactoryBuildShell(VIN, "No factory sticker provider is wired for this VIN's brand yet.");
    const decode = async (): Promise<DecodedVehicle | null> => ({ vin: VIN, year: 2026, make: "Hyundai", model: "Tucson", trim: "SEL" });
    const enriched = await enrichFactoryBuild(shell, { decode });
    assert.equal(enriched.status, "decode_provisional");
    assert.equal(enriched.provenance, "decode_provisional");
    assert.equal(enriched.make, "Hyundai");
    assert.deepEqual(enriched.options, [], "decode never manufactures sticker-verified options");
  });

  it("a build with no sticker stays factory_pending when NHTSA also has nothing — never claims decode_provisional on empty data", async () => {
    const shell = pendingFactoryBuildShell(VIN, "note");
    const decode = async (): Promise<DecodedVehicle | null> => null;
    const enriched = await enrichFactoryBuild(shell, { decode });
    assert.equal(enriched.status, "factory_pending");
  });

  it("a decode failure (network error) leaves the build unchanged rather than throwing", async () => {
    const build = normalizeGenesisFamilySticker(releasedSticker({ trim: "Limited" }), { providerId: "hyundai_dealerfire", url: null });
    const decode = async (): Promise<DecodedVehicle | null> => {
      throw new Error("NHTSA is down");
    };
    const enriched = await enrichFactoryBuild(build, { decode });
    assert.equal(enriched.status, "factory_verified");
    assert.equal(enriched.enrich, null);
  });
});
