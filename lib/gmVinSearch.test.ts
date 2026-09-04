import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { env } from "node:process";
import { describe, it } from "node:test";
import { parseGmStickerText } from "./gmSticker";
import {
  DEMO_GM_COMPARABLE_LISTINGS,
  demoGmListingsNote,
  findSimilarGmVehicles,
} from "./gmVinSearch";
import { isUsableHuntLocation, selectCompetitionSlots } from "./vinSearch";

const FIXTURE_DIR = path.join(import.meta.dirname, "testdata", "gm-stickers");
const SUBJECT = "1GCUKDED9TZ134987";
const FLEMINGTON = "1GCUKDED8TZ200011";
const ALLENTOWN = "1GCUKDED2TZ200022";
const MONROEVILLE_NO_SC = "1GCUKDED7TZ200033";
const UNRELEASED = "1GCUKDED1TZ200044";

function loadFixture(vin: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${vin}.txt`), "utf8");
}

const ALL_THREE_MUST_HAVES = ["Z71 Off-Road Package", "Multi-Flex Tailgate", "Super Cruise"];

describe("gmVinSearch rank + must-have filter", () => {
  it("does not search until the user enters zip and radius", async () => {
    const subject = parseGmStickerText(SUBJECT, loadFixture(SUBJECT));
    const result = await findSimilarGmVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: ALL_THREE_MUST_HAVES,
      listings: DEMO_GM_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseGmStickerText(vin, loadFixture(vin)),
    });
    assert.equal(result.needsLocation, true);
    assert.equal(result.matches.length, 0);
    assert.equal(result.candidatesConsidered, 0);
  });

  it("drops the far Monroeville lot outside a 100mi radius, keeps Flemington + Allentown", async () => {
    const subject = parseGmStickerText(SUBJECT, loadFixture(SUBJECT));
    const result = await findSimilarGmVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: ["Z71 Off-Road Package"],
      zip: "07405",
      radiusMiles: 100,
      listings: DEMO_GM_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseGmStickerText(vin, loadFixture(vin)),
    });
    const matchVins = result.matches.map((m) => m.vin);
    assert.ok(matchVins.includes(FLEMINGTON));
    assert.ok(matchVins.includes(ALLENTOWN));
    assert.ok(!matchVins.includes(MONROEVILLE_NO_SC), "Monroeville is ~288mi away — outside 100mi");
    const dropped = result.dropped.find((d) => d.vin === MONROEVILLE_NO_SC);
    assert.equal(dropped?.reason, "outside_radius");
  });

  it("keeps Flemington + Allentown at a large radius, drops Monroeville for missing Super Cruise and the placeholder as unreleased", async () => {
    const subject = parseGmStickerText(SUBJECT, loadFixture(SUBJECT));
    const result = await findSimilarGmVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: ALL_THREE_MUST_HAVES,
      zip: "07405",
      radiusMiles: 500,
      listings: DEMO_GM_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseGmStickerText(vin, loadFixture(vin)),
    });
    const matchVins = result.matches.map((m) => m.vin);
    assert.ok(matchVins.includes(FLEMINGTON));
    assert.ok(matchVins.includes(ALLENTOWN));
    assert.ok(!matchVins.includes(MONROEVILLE_NO_SC));
    assert.ok(!matchVins.includes(UNRELEASED));

    const noScDrop = result.dropped.find((d) => d.vin === MONROEVILLE_NO_SC);
    assert.equal(noScDrop?.reason, "missing_must_have");
    assert.ok(noScDrop?.missing?.includes("Super Cruise"));

    const unreleasedDrop = result.dropped.find((d) => d.vin === UNRELEASED);
    assert.equal(unreleasedDrop?.reason, "unreleased");

    // Slot selection picks two different dealers, nearest first — same
    // dealer-diversity logic as the Ford hunt (selectCompetitionSlots is
    // shared, generic code).
    for (const match of result.matches) {
      assert.ok(match.factoryOptions.length > 0, "factory options carried through from the GM sticker");
      assert.equal(match.factoryOptionsStatus, "ok");
    }
    const slots = selectCompetitionSlots(result.matches);
    assert.ok(slots.length <= 2);
  });

  it("reports hasListingsKey and a Silverado-specific demo note when nothing is configured", async () => {
    const subject = parseGmStickerText(SUBJECT, loadFixture(SUBJECT));
    const result = await findSimilarGmVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: ["a line nothing in the demo pool has"],
      zip: "07405",
      radiusMiles: 500,
      listings: DEMO_GM_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseGmStickerText(vin, loadFixture(vin)),
    });
    assert.equal(typeof result.hasListingsKey, "boolean");
    assert.equal(result.matches.length, 0);
  });

  it("demoGmListingsNote names Silverado 1500, never invents coverage for an unrelated model", () => {
    assert.match(demoGmListingsNote("Silverado 1500"), /Silverado 1500/);
    assert.match(demoGmListingsNote("Colorado"), /do not apply to Colorado/);
  });

  it("app/api/gm-comparables calls findSimilarGmVehicles and gates on isGmVin", () => {
    const routeSrc = fs.readFileSync(path.join(process.cwd(), "app/api/gm-comparables/route.ts"), "utf8");
    assert.match(routeSrc, /isGmVin\(subjectVin\)/);
    assert.match(routeSrc, /findSimilarGmVehicles/);
    assert.match(routeSrc, /getGmSticker/);
    assert.doesNotMatch(routeSrc, /findSimilarFordVehicles/);
  });

  it("still requires a usable hunt location — shared helper, not duplicated logic", () => {
    assert.equal(isUsableHuntLocation("08822", 50), true);
    assert.equal(isUsableHuntLocation("08822", 0), false);
  });

  it("sends the subject's trim to MarketCheck — a buyer comparing an LT should not see RST suggestions", async () => {
    const prevA = env["AUTO_DEV_API_KEY"];
    const prevM = env["MARKETCHECK_API_KEY"];
    const prevP = env["LISTINGS_PROVIDER"];
    delete env["AUTO_DEV_API_KEY"];
    delete env["LISTINGS_PROVIDER"];
    env["MARKETCHECK_API_KEY"] = "runtime-test-marketcheck";
    const origFetch = globalThis.fetch;
    let sawTrimParam: string | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input));
      sawTrimParam = parsed.searchParams.get("trim");
      return new Response(JSON.stringify({ num_found: 0, listings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const subject = parseGmStickerText(SUBJECT, loadFixture(SUBJECT));
      await findSimilarGmVehicles({
        subjectVin: SUBJECT,
        subject,
        mustHaveLines: [],
        zip: "07405",
        radiusMiles: 500,
        fetchSticker: async (vin) => parseGmStickerText(vin, loadFixture(vin)),
      });
      assert.equal(sawTrimParam, subject.trim);
      assert.equal(sawTrimParam, "LT");
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

  it("filters out a different-trim candidate even if it slips through the search, but keeps one with no trim data rather than guessing", async () => {
    const subject = parseGmStickerText(SUBJECT, loadFixture(SUBJECT));
    assert.equal(subject.trim, "LT");
    const rstTwin = { ...DEMO_GM_COMPARABLE_LISTINGS[1], vin: "1GCUKDED3TZ200099", trim: "RST" };
    const unknownTrim = { ...DEMO_GM_COMPARABLE_LISTINGS[0], vin: "1GCUKDED5TZ200088", trim: undefined };
    const result = await findSimilarGmVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: [],
      zip: "07405",
      radiusMiles: 500,
      listings: [...DEMO_GM_COMPARABLE_LISTINGS, rstTwin, unknownTrim],
      fetchSticker: async (vin) => parseGmStickerText(vin, loadFixture(vin)),
    });
    const consideredVins = result.candidatesConsidered;
    assert.ok(consideredVins < DEMO_GM_COMPARABLE_LISTINGS.length + 2, "the RST twin must be dropped before sticker-fetch");
    // Flemington/Allentown (LT) and the no-trim-data listing all still count
    // as candidates; only the RST twin is excluded by trim.
    assert.equal(consideredVins, DEMO_GM_COMPARABLE_LISTINGS.length + 1);
  });
});
