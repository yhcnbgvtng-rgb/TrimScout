import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { env } from "node:process";
import { describe, it } from "node:test";
import { parseStellantisStickerText } from "./stellantisSticker";
import {
  DEMO_STELLANTIS_COMPARABLE_LISTINGS,
  demoStellantisListingsNote,
  findSimilarStellantisVehicles,
} from "./stellantisVinSearch";
import { isUsableHuntLocation, selectCompetitionSlots } from "./vinSearch";

const FIXTURE_DIR = path.join(import.meta.dirname, "testdata", "stellantis-stickers");
const JEEP_WRANGLER = "1C4JJXSJ3MW678163";
const RAM_1500 = "1C6SRFHT4MN652569";

function loadFixture(vin: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${vin}.txt`), "utf8");
}

describe("stellantisVinSearch rank + must-have filter", () => {
  it("does not search until the user enters zip and radius", async () => {
    const subject = parseStellantisStickerText(JEEP_WRANGLER, loadFixture(JEEP_WRANGLER));
    const result = await findSimilarStellantisVehicles({
      subjectVin: JEEP_WRANGLER,
      subject,
      mustHaveLines: [],
      listings: DEMO_STELLANTIS_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseStellantisStickerText(vin, loadFixture(vin)),
    });
    assert.equal(result.needsLocation, true);
    assert.equal(result.matches.length, 0);
    assert.equal(result.candidatesConsidered, 0);
  });

  it("excludes the Ram 1500 demo listing for a Wrangler subject — different model, not just different trim", async () => {
    const subject = parseStellantisStickerText(JEEP_WRANGLER, loadFixture(JEEP_WRANGLER));
    const result = await findSimilarStellantisVehicles({
      subjectVin: JEEP_WRANGLER,
      subject,
      mustHaveLines: ["Trailer-Tow Package"],
      zip: "07405",
      radiusMiles: 100,
      listings: DEMO_STELLANTIS_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseStellantisStickerText(vin, loadFixture(vin)),
    });
    const matchVins = result.matches.map((m) => m.vin);
    assert.ok(matchVins.includes(JEEP_WRANGLER) === false, "the subject itself is never its own comparable");
    assert.ok(!matchVins.includes(RAM_1500), "a Ram 1500 must never be offered as a Wrangler comparable");
    assert.equal(result.candidatesConsidered, 1, "only the Wrangler survives the model filter — the Ram is dropped before any sticker is even fetched");
  });

  it("reports hasListingsKey and a note naming the demo pool's real coverage, never inventing coverage for an unrelated model", async () => {
    const subject = parseStellantisStickerText(JEEP_WRANGLER, loadFixture(JEEP_WRANGLER));
    const result = await findSimilarStellantisVehicles({
      subjectVin: JEEP_WRANGLER,
      subject,
      mustHaveLines: ["something the demo pool doesn't have"],
      zip: "07405",
      radiusMiles: 500,
      listings: DEMO_STELLANTIS_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseStellantisStickerText(vin, loadFixture(vin)),
    });
    assert.equal(typeof result.hasListingsKey, "boolean");
    assert.match(demoStellantisListingsNote("Wrangler"), /No listings API key configured/);
    assert.match(demoStellantisListingsNote("Grand Cherokee"), /limited to a Wrangler and a Ram 1500 and do not apply to Grand Cherokee/);
  });

  it("selectCompetitionSlots is shared, generic code — works the same for Stellantis matches", async () => {
    const subject = parseStellantisStickerText(JEEP_WRANGLER, loadFixture(JEEP_WRANGLER));
    const result = await findSimilarStellantisVehicles({
      subjectVin: JEEP_WRANGLER,
      subject,
      mustHaveLines: [],
      zip: "07405",
      radiusMiles: 100,
      // A second, different-dealer copy of the same Wrangler VIN's data
      // under a distinct VIN would be needed to exercise dealer diversity;
      // here just confirm the plumbing doesn't throw with a single result.
      listings: [
        {
          ...DEMO_STELLANTIS_COMPARABLE_LISTINGS[0],
        },
      ],
      fetchSticker: async (vin) => parseStellantisStickerText(vin, loadFixture(vin)),
    });
    const slots = selectCompetitionSlots(result.matches);
    assert.ok(slots.length <= 2);
  });

  it("app/api/stellantis-comparables calls findSimilarStellantisVehicles and gates on isStellantisVin", () => {
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), "app/api/stellantis-comparables/route.ts"),
      "utf8"
    );
    assert.match(routeSrc, /isStellantisVin\(subjectVin\)/);
    assert.match(routeSrc, /findSimilarStellantisVehicles/);
    assert.match(routeSrc, /getStellantisSticker/);
    assert.doesNotMatch(routeSrc, /findSimilarFordVehicles/);
    assert.doesNotMatch(routeSrc, /findSimilarGmVehicles/);
  });

  it("still requires a usable hunt location — shared helper, not duplicated logic", () => {
    assert.equal(isUsableHuntLocation("07054", 50), true);
    assert.equal(isUsableHuntLocation("07054", 0), false);
  });

  it("sends make/model to MarketCheck for the live coarse search (trim itself is a client-side post-filter — MarketCheck's API has no trim param, same as the GM hunt)", async () => {
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
      const subject = parseStellantisStickerText(JEEP_WRANGLER, loadFixture(JEEP_WRANGLER));
      await findSimilarStellantisVehicles({
        subjectVin: JEEP_WRANGLER,
        subject,
        mustHaveLines: [],
        zip: "07405",
        radiusMiles: 500,
        fetchSticker: async (vin) => parseStellantisStickerText(vin, loadFixture(vin)),
      });
      assert.equal(sawMakeParam, "Jeep");
      assert.equal(sawModelParam, "Wrangler");
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
    const subject = parseStellantisStickerText(JEEP_WRANGLER, loadFixture(JEEP_WRANGLER));
    assert.equal(subject.trim, "Unlimited Rubicon 392");
    const sportTwin = { ...DEMO_STELLANTIS_COMPARABLE_LISTINGS[0], vin: "1C4JJXSJ0MW999999", trim: "Sport" };
    const unknownTrim = { ...DEMO_STELLANTIS_COMPARABLE_LISTINGS[0], vin: "1C4JJXSJ1MW888888", trim: undefined };
    const result = await findSimilarStellantisVehicles({
      subjectVin: JEEP_WRANGLER,
      subject,
      mustHaveLines: [],
      zip: "07405",
      radiusMiles: 500,
      listings: [...DEMO_STELLANTIS_COMPARABLE_LISTINGS, sportTwin, unknownTrim],
      fetchSticker: async (vin) => parseStellantisStickerText(vin, loadFixture(vin)),
    });
    // Wrangler (Rubicon, matches) + Ram 1500 (different model, filtered) +
    // Sport twin (different trim, filtered) + unknown-trim twin (kept —
    // missing data passes rather than wrongly excludes).
    assert.equal(result.candidatesConsidered, 2);
  });
});
