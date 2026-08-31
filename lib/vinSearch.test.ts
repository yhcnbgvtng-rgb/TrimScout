import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { getFordSticker, parseFordStickerText } from "./fordSticker";
import {
  DEMO_COMPARABLE_LISTINGS,
  findSimilarFordVehicles,
  fordMatchToVehicle,
  isUsableHuntLocation,
  rankFordMatches,
  stickerFromDemoFixture,
  type FordMatchCard,
} from "./vinSearch";
import {
  FORD_COMPETITION_LOADING,
  FORD_COMPETITION_NEED_LOCATION,
  autoFillCompetitionSlots,
  fordCompetitionEmptyCopy,
} from "./fordCompetitionUi";

const FIXTURE_DIR = path.join(import.meta.dirname, "testdata", "ford-stickers");
const SUBJECT = "1FMWK8JCXTGB47204";
const SHORKEY = "1FMWK8JC7TGB81309";
const BATTLEFIELD = "1FMWK8JC1TGB69561";
const MALL_OF_GEORGIA = "1FMWK8JC7TGA20216";
const DECOY_23 = "1FMUK8JH8TGB25138";

function loadFixture(vin: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${vin}.txt`), "utf8");
}

describe("vinSearch rank + must-have filter", () => {
  it("requires a 5-digit ZIP and a positive radius — never a silent default", () => {
    assert.equal(isUsableHuntLocation("07405", 100), true);
    assert.equal(isUsableHuntLocation("07405", 0), false);
    assert.equal(isUsableHuntLocation("07405"), false);
    assert.equal(isUsableHuntLocation("", 100), false);
    assert.equal(isUsableHuntLocation("7405", 100), false);
  });
  it("does not search until the user enters zip and radius", async () => {
    const subject = parseFordStickerText(SUBJECT, loadFixture(SUBJECT));
    const result = await findSimilarFordVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: ["Ultimate Package", "Keyless Entry Keypad"],
      listings: DEMO_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseFordStickerText(vin, loadFixture(vin)),
    });
    assert.equal(result.needsLocation, true);
    assert.equal(result.matches.length, 0);
    assert.equal(result.candidatesConsidered, 0);
  });

  it("drops sticker matches outside the user-entered radius instead of padding with far cars", async () => {
    const subject = parseFordStickerText(SUBJECT, loadFixture(SUBJECT));
    const result = await findSimilarFordVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: ["Ultimate Package", "Keyless Entry Keypad"],
      niceToHaveLines: ["BlueCruise"],
      zip: "07405",
      radiusMiles: 100,
      listings: DEMO_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseFordStickerText(vin, loadFixture(vin)),
    });

    assert.equal(result.matches.length, 0, "100 mi from 07405 must not pad with PA/VA lots");
    assert.equal(result.needsLocation, undefined);
    const shorkey = result.dropped.find((d) => d.vin === SHORKEY);
    const battlefield = result.dropped.find((d) => d.vin === BATTLEFIELD);
    assert.equal(shorkey?.reason, "outside_radius");
    assert.equal(battlefield?.reason, "outside_radius");
    assert.ok((shorkey?.distanceMiles ?? 0) > 100);
    assert.ok((battlefield?.distanceMiles ?? 0) > 100);
    assert.match(result.note, /100 miles of 07405/);
    assert.match(result.note, /outside your radius/i);
    const emptySlots = autoFillCompetitionSlots(result.matches);
    assert.equal(emptySlots[0], null);
    assert.equal(emptySlots[1], null);
  });

  it("keeps Shorkey + Battlefield when the user-entered radius is large enough", async () => {
    const subject = parseFordStickerText(SUBJECT, loadFixture(SUBJECT));
    const result = await findSimilarFordVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: ["Ultimate Package", "Keyless Entry Keypad"],
      niceToHaveLines: ["BlueCruise"],
      zip: "07405",
      radiusMiles: 500,
      listings: DEMO_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseFordStickerText(vin, loadFixture(vin)),
    });

    const matchVins = result.matches.map((m) => m.vin);
    assert.equal(result.matches.length, 2);
    assert.equal(result.matches[0].vin, BATTLEFIELD, "nearest slot is Battlefield (Culpeper)");
    assert.equal(result.matches[1].vin, SHORKEY, "second slot is Shorkey (White Oak)");
    assert.equal(result.matches[0].dealerUrl, null, "Battlefield has no VDP URL and must still fill a slot");
    assert.ok(result.matches[0].dealerName);
    assert.ok(result.matches[0].distanceMiles != null);
    const [slot0, slot1] = autoFillCompetitionSlots(result.matches);
    assert.equal(slot0?.vin, BATTLEFIELD);
    assert.equal(slot1?.vin, SHORKEY);
    const filled = [slot0, slot1].map((m) => fordMatchToVehicle(m!));
    assert.equal(filled[0].location.dealerName, result.matches[0].dealerName);
    assert.equal(filled[0].vin, BATTLEFIELD);
    assert.ok((filled[0].location.distanceMiles || 0) > 0);
    assert.ok(!matchVins.includes(MALL_OF_GEORGIA), "Mall of Georgia has Ultimate but no keypad");
    assert.ok(!matchVins.includes(DECOY_23), "1FMUK 2.3 decoy must be prefix-excluded");
    assert.ok(result.matches.every((m) => m.distanceMiles != null && m.distanceMiles <= 500));
    assert.ok(
      (result.matches[0].distanceMiles ?? Infinity) <= (result.matches[1].distanceMiles ?? Infinity),
      "Increase Competition slots must be nearest-first"
    );

    const decoyDrop = result.dropped.find((d) => d.vin === DECOY_23);
    assert.equal(decoyDrop?.reason, "engine_prefix");
    const mallDrop = result.dropped.find((d) => d.vin === MALL_OF_GEORGIA);
    assert.equal(mallDrop?.reason, "missing_must_have");
    assert.ok(mallDrop?.missing?.includes("Keyless Entry Keypad"));

    const unreleased = result.dropped.filter((d) => d.reason === "unreleased");
    assert.ok(unreleased.length >= 2, "Lilliston + Larson placeholders must not count as matches");
  });

  it("ranks nearest first even if a farther lot is cheaper or has more niceties", () => {
    const base: FordMatchCard = {
      vin: "A",
      dealerName: "A",
      city: "X",
      state: "NJ",
      distanceMiles: 20,
      listingPrice: 60000,
      listingPriceSource: "listing",
      msrp: 62000,
      msrpSource: "sticker",
      dealerUrl: null,
      pdfUrl: "",
      matchedMustHaves: ["Ultimate Package"],
      matchedNiceToHaves: [],
      stickerStatus: "released",
    };
    const near = { ...base, vin: "NEAR", distanceMiles: 20, listingPrice: 60000, matchedNiceToHaves: [] };
    const farCheapNice = {
      ...base,
      vin: "FAR",
      dealerName: "FAR",
      distanceMiles: 80,
      listingPrice: 40000,
      matchedNiceToHaves: ["BlueCruise", "Spare"],
    };
    assert.deepEqual(
      rankFordMatches([farCheapNice, near]).map((m) => m.vin),
      ["NEAR", "FAR"]
    );
  });

  it("live Ford Direct hunt still returns Shorkey + Battlefield only among the demo VINs when radius allows", async () => {
    const subject = await getFordSticker(SUBJECT);
    const result = await findSimilarFordVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: ["Ultimate Package", "Keyless Entry Keypad"],
      zip: "07405",
      radiusMiles: 500,
      listings: DEMO_COMPARABLE_LISTINGS,
    });
    const matchVins = result.matches.map((m) => m.vin);
    assert.ok(matchVins.includes(SHORKEY));
    assert.ok(matchVins.includes(BATTLEFIELD));
    assert.equal(matchVins.includes(MALL_OF_GEORGIA), false);
    assert.equal(matchVins.includes(DECOY_23), false);
    assert.ok(
      (result.matches[0].distanceMiles ?? Infinity) <= (result.matches[1].distanceMiles ?? Infinity)
    );
  });

  it("does not fill Explorer Tremor demo lots onto a Bronco Sport subject", async () => {
    const bronco = parseFordStickerText(
      "3FMCR9BN8TRE94740",
      fs.readFileSync(path.join(FIXTURE_DIR, "3FMCR9BN8TRE94740.txt"), "utf8")
    );
    const result = await findSimilarFordVehicles({
      subjectVin: bronco.vin,
      subject: bronco,
      mustHaveLines: [],
      zip: "07405",
      radiusMiles: 500,
      listings: DEMO_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseFordStickerText(vin, loadFixture(vin)),
    });
    assert.equal(result.matches.length, 0);
    assert.match(result.note, /do not apply to Bronco Sport/i);
    assert.match(result.note, /Explorer Tremor only/i);
    assert.equal(autoFillCompetitionSlots(result.matches)[0], null);
  });

  it("drops non-white Bronco comparables only when exterior color is a must-have", async () => {
    const bronco = parseFordStickerText(
      "3FMCR9BN8TRE94740",
      fs.readFileSync(path.join(FIXTURE_DIR, "3FMCR9BN8TRE94740.txt"), "utf8")
    );
    const whiteVin = "3FMCR9BN8TRE11111";
    const blackVin = "3FMCR9BN8TRE22222";
    const near = {
      model: "Bronco Sport",
      year: 2026,
      make: "Ford",
      city: "Butler",
      state: "NJ",
      zip: "07405",
      lat: 40.927,
      lng: -74.341,
      listingPrice: null as number | null,
    };
    const listings = [
      { ...near, vin: whiteVin, dealerName: "White Lot" },
      { ...near, vin: blackVin, dealerName: "Black Lot" },
    ];
    const stickers: Record<string, ReturnType<typeof parseFordStickerText>> = {
      [whiteVin]: { ...bronco, vin: whiteVin, exteriorColor: "Oxford White" },
      [blackVin]: { ...bronco, vin: blackVin, exteriorColor: "Agate Black Metallic" },
    };
    const colorLine = `Exterior color: ${bronco.exteriorColor}`;
    const withColor = await findSimilarFordVehicles({
      subjectVin: bronco.vin,
      subject: bronco,
      mustHaveLines: [colorLine],
      zip: "07405",
      radiusMiles: 100,
      listings,
      fetchSticker: async (vin) => stickers[vin],
    });
    assert.deepEqual(
      withColor.matches.map((m) => m.vin),
      [whiteVin]
    );
    assert.equal(withColor.dropped.find((d) => d.vin === blackVin)?.reason, "missing_must_have");

    const noColor = await findSimilarFordVehicles({
      subjectVin: bronco.vin,
      subject: bronco,
      mustHaveLines: [],
      zip: "07405",
      radiusMiles: 100,
      listings,
      fetchSticker: async (vin) => stickers[vin],
    });
    assert.equal(noColor.matches.length, 2);
  });

  it("Explorer Ultimate + keypad still requires both sticker lines; color filter is extra", async () => {
    const subject = parseFordStickerText(SUBJECT, loadFixture(SUBJECT));
    const both = await findSimilarFordVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: ["Ultimate Package", "Keyless Entry Keypad"],
      zip: "07405",
      radiusMiles: 500,
      listings: DEMO_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseFordStickerText(vin, loadFixture(vin)),
    });
    assert.ok(both.matches.map((m) => m.vin).includes(SHORKEY));
    assert.ok(both.matches.map((m) => m.vin).includes(BATTLEFIELD));

    const colorLine = `Exterior color: ${subject.exteriorColor}`;
    const withColor = await findSimilarFordVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: ["Ultimate Package", "Keyless Entry Keypad", colorLine],
      zip: "07405",
      radiusMiles: 500,
      listings: DEMO_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseFordStickerText(vin, loadFixture(vin)),
    });
    assert.equal(withColor.matches.length, 0);
    assert.ok(withColor.dropped.some((d) => d.reason === "missing_must_have"));
    assert.match(withColor.note, /must-have/i);
  });
});

describe("Increase Competition slots are the hunt result", () => {
  it("no zip → slots explain, no fake cars", () => {
    const copy = fordCompetitionEmptyCopy({
      huntReady: false,
      loading: false,
      error: null,
      note: null,
      matchCount: 0,
    });
    assert.equal(copy?.kind, "need_location");
    assert.equal(copy?.message, FORD_COMPETITION_NEED_LOCATION);
    assert.deepEqual(autoFillCompetitionSlots([]), [null, null]);
  });

  it("loading copy is a spinner label, not an empty paste box", () => {
    const copy = fordCompetitionEmptyCopy({
      huntReady: true,
      loading: true,
      error: null,
      note: null,
      matchCount: 0,
    });
    assert.equal(copy?.kind, "loading");
    assert.equal(copy?.message, FORD_COMPETITION_LOADING);
  });

  it("surfaces hunt API errors instead of swallowing them", () => {
    const copy = fordCompetitionEmptyCopy({
      huntReady: true,
      loading: false,
      error: "Could not load similar lots (502).",
      note: null,
      matchCount: 0,
    });
    assert.equal(copy?.kind, "error");
    assert.match(copy!.message, /502/);
  });

  it("demo Explorer 07405+500 auto-fills Battlefield then Shorkey without a listings API key", async () => {
    const prevA = process.env.AUTO_DEV_API_KEY;
    const prevM = process.env.MARKETCHECK_API_KEY;
    delete process.env.AUTO_DEV_API_KEY;
    delete process.env.MARKETCHECK_API_KEY;
    try {
      assert.ok(stickerFromDemoFixture(BATTLEFIELD)?.status === "released");
      assert.ok(stickerFromDemoFixture(SHORKEY)?.status === "released");
      const subject = parseFordStickerText(SUBJECT, loadFixture(SUBJECT));
      const result = await findSimilarFordVehicles({
        subjectVin: SUBJECT,
        subject,
        mustHaveLines: ["Ultimate Package", "Keyless Entry Keypad"],
        zip: "07405",
        radiusMiles: 500,
      });
      assert.equal(result.provider, "demo");
      assert.equal(result.matches[0]?.vin, BATTLEFIELD);
      assert.equal(result.matches[1]?.vin, SHORKEY);
      const [first, second] = autoFillCompetitionSlots(result.matches);
      assert.equal(first?.vin, BATTLEFIELD);
      assert.equal(second?.vin, SHORKEY);
      assert.equal(first?.dealerUrl, null);
      assert.match(first!.dealerName, /Battlefield/i);
      assert.match(second!.dealerName, /Shorkey/i);
    } finally {
      if (prevA !== undefined) process.env.AUTO_DEV_API_KEY = prevA;
      else delete process.env.AUTO_DEV_API_KEY;
      if (prevM !== undefined) process.env.MARKETCHECK_API_KEY = prevM;
      else delete process.env.MARKETCHECK_API_KEY;
    }
  });

  it("demo Bronco Sport with zip/radius does not hang or pad Explorers", async () => {
    const prevA = process.env.AUTO_DEV_API_KEY;
    const prevM = process.env.MARKETCHECK_API_KEY;
    delete process.env.AUTO_DEV_API_KEY;
    delete process.env.MARKETCHECK_API_KEY;
    try {
      const bronco = parseFordStickerText(
        "3FMCR9BN8TRE94740",
        fs.readFileSync(path.join(FIXTURE_DIR, "3FMCR9BN8TRE94740.txt"), "utf8")
      );
      const result = await findSimilarFordVehicles({
        subjectVin: bronco.vin,
        subject: bronco,
        mustHaveLines: [],
        zip: "07405",
        radiusMiles: 500,
      });
      assert.equal(result.provider, "demo");
      assert.equal(result.matches.length, 0);
      assert.equal(result.stickersFetched, 0);
      assert.match(result.note, /Explorer Tremor only/i);
      assert.doesNotMatch(result.note, /1FMWK8JC7TGB81309/);
      const copy = fordCompetitionEmptyCopy({
        huntReady: true,
        loading: false,
        error: null,
        note: result.note,
        droppedCount: result.dropped.length,
        matchCount: result.matches.length,
      });
      assert.equal(copy?.kind, "empty");
      assert.match(copy!.message, /Explorer Tremor only/i);
    } finally {
      if (prevA !== undefined) process.env.AUTO_DEV_API_KEY = prevA;
      else delete process.env.AUTO_DEV_API_KEY;
      if (prevM !== undefined) process.env.MARKETCHECK_API_KEY = prevM;
      else delete process.env.MARKETCHECK_API_KEY;
    }
  });
});
