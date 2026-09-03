import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { env } from "node:process";
import { describe, it } from "node:test";
import { parseGenesisStickerText } from "./genesisSticker";
import {
  DEMO_GENESIS_COMPARABLE_LISTINGS,
  demoGenesisListingsNote,
  findSimilarGenesisVehicles,
} from "./genesisVinSearch";
import { isUsableHuntLocation, selectCompetitionSlots } from "./vinSearch";

const FIXTURE_DIR = path.join(import.meta.dirname, "testdata", "genesis-stickers");
const G90 = "KMTFC4SD2RU039916";
const G80 = "KMTGA4SC4PU151020";

function loadFixture(vin: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${vin}.txt`), "utf8");
}

describe("genesisVinSearch rank + must-have filter", () => {
  it("does not search until the user enters zip and radius", async () => {
    const subject = parseGenesisStickerText(G80, loadFixture(G80));
    const result = await findSimilarGenesisVehicles({
      subjectVin: G80,
      subject,
      mustHaveLines: [],
      listings: DEMO_GENESIS_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseGenesisStickerText(vin, loadFixture(vin)),
    });
    assert.equal(result.needsLocation, true);
    assert.equal(result.matches.length, 0);
    assert.equal(result.candidatesConsidered, 0);
  });

  it("excludes the G90 demo listing for a G80 subject — different model, not just different trim", async () => {
    const subject = parseGenesisStickerText(G80, loadFixture(G80));
    const result = await findSimilarGenesisVehicles({
      subjectVin: G80,
      subject,
      mustHaveLines: ["Advanced Package"],
      zip: "07405",
      radiusMiles: 100,
      listings: DEMO_GENESIS_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseGenesisStickerText(vin, loadFixture(vin)),
    });
    const matchVins = result.matches.map((m) => m.vin);
    assert.ok(matchVins.includes(G80) === false, "the subject itself is never its own comparable");
    assert.ok(!matchVins.includes(G90), "a G90 must never be offered as a G80 comparable");
    assert.equal(result.candidatesConsidered, 1, "only the G80 survives the model filter — the G90 is dropped before any sticker is even fetched");
  });

  it("reports hasListingsKey and a note naming the demo pool's real coverage, never inventing coverage for an unrelated model", async () => {
    const subject = parseGenesisStickerText(G80, loadFixture(G80));
    const result = await findSimilarGenesisVehicles({
      subjectVin: G80,
      subject,
      mustHaveLines: ["something the demo pool doesn't have"],
      zip: "07405",
      radiusMiles: 500,
      listings: DEMO_GENESIS_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseGenesisStickerText(vin, loadFixture(vin)),
    });
    assert.equal(typeof result.hasListingsKey, "boolean");
    assert.match(demoGenesisListingsNote("G80"), /No listings API key configured/);
    assert.match(demoGenesisListingsNote("GV70"), /limited to a G90 and a G80 and do not apply to GV70/);
  });

  it("selectCompetitionSlots is shared, generic code — works the same for Genesis matches", async () => {
    const subject = parseGenesisStickerText(G80, loadFixture(G80));
    const result = await findSimilarGenesisVehicles({
      subjectVin: G80,
      subject,
      mustHaveLines: [],
      zip: "07405",
      radiusMiles: 100,
      // A second, different-dealer copy of the same G90 VIN's data under a
      // distinct VIN would be needed to exercise dealer diversity; here just
      // confirm the plumbing doesn't throw with a single result.
      listings: [
        {
          ...DEMO_GENESIS_COMPARABLE_LISTINGS[1],
        },
      ],
      fetchSticker: async (vin) => parseGenesisStickerText(vin, loadFixture(vin)),
    });
    const slots = selectCompetitionSlots(result.matches);
    assert.ok(slots.length <= 2);
  });

  it("app/api/genesis-comparables calls findSimilarGenesisVehicles and gates on isGenesisVin", () => {
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), "app/api/genesis-comparables/route.ts"),
      "utf8"
    );
    assert.match(routeSrc, /isGenesisVin\(subjectVin\)/);
    assert.match(routeSrc, /findSimilarGenesisVehicles/);
    assert.match(routeSrc, /getGenesisSticker/);
    assert.doesNotMatch(routeSrc, /findSimilarFordVehicles/);
    assert.doesNotMatch(routeSrc, /findSimilarGmVehicles/);
    assert.doesNotMatch(routeSrc, /findSimilarStellantisVehicles/);
  });

  it("still requires a usable hunt location — shared helper, not duplicated logic", () => {
    assert.equal(isUsableHuntLocation("07054", 50), true);
    assert.equal(isUsableHuntLocation("07054", 0), false);
  });

  it("sends make/model to MarketCheck for the live coarse search (trim itself is a client-side post-filter — MarketCheck's API has no trim param, same as the GM/Stellantis hunts)", async () => {
    const prevA = env["AUTO_DEV_API_KEY"];
    const prevM = env["MARKETCHECK_API_KEY"];
    const prevP = env["LISTINGS_PROVIDER"];
    delete env["AUTO_DEV_API_KEY"];
    delete env["LISTINGS_PROVIDER"];
    env["MARKETCHECK_API_KEY"] = "runtime-test-marketcheck";
    const origFetch = globalThis.fetch;
    let sawMakeParam: string | null = null;
    let sawModelParam: string | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input));
      sawMakeParam = parsed.searchParams.get("make");
      sawModelParam = parsed.searchParams.get("model");
      return new Response(JSON.stringify({ num_found: 0, listings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const subject = parseGenesisStickerText(G80, loadFixture(G80));
      await findSimilarGenesisVehicles({
        subjectVin: G80,
        subject,
        mustHaveLines: [],
        zip: "07405",
        radiusMiles: 500,
        fetchSticker: async (vin) => parseGenesisStickerText(vin, loadFixture(vin)),
      });
      assert.equal(sawMakeParam, "Genesis");
      assert.equal(sawModelParam, "G80");
    } finally {
      globalThis.fetch = origFetch;
      if (prevA !== undefined) env["AUTO_DEV_API_KEY"] = prevA;
      else delete env["AUTO_DEV_API_KEY"];
      if (prevM !== undefined) env["MARKETCHECK_API_KEY"] = prevM;
      else delete env["MARKETCHECK_API_KEY"];
      if (prevP !== undefined) env["LISTINGS_PROVIDER"] = prevP;
      else delete env["LISTINGS_PROVIDER"];
    }
  });

  it("filters out a different-trim candidate client-side even if it slips through the search", async () => {
    const subject = parseGenesisStickerText(G80, loadFixture(G80));
    assert.equal(subject.trim, "Sport Prestige");
    const baseTwin = { ...DEMO_GENESIS_COMPARABLE_LISTINGS[1], vin: "KMTGA4SC0PU999999", trim: "Advanced" };
    const unknownTrim = { ...DEMO_GENESIS_COMPARABLE_LISTINGS[1], vin: "KMTGA4SC1PU888888", trim: undefined };
    const result = await findSimilarGenesisVehicles({
      subjectVin: G80,
      subject,
      mustHaveLines: [],
      zip: "07405",
      radiusMiles: 500,
      listings: [...DEMO_GENESIS_COMPARABLE_LISTINGS, baseTwin, unknownTrim],
      fetchSticker: async (vin) => parseGenesisStickerText(vin, loadFixture(vin)),
    });
    // G80 (Sport Prestige, matches) + G90 (different model, filtered) +
    // base twin (different trim, filtered) + unknown-trim twin (kept —
    // missing data passes rather than wrongly excludes).
    assert.equal(result.candidatesConsidered, 2);
  });
});
