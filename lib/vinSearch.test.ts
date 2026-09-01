import { guardedFetch, LIVE_HTTP_BLOCKLIST } from "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { env } from "node:process";
import { describe, it } from "node:test";
import { parseFordStickerText } from "./fordSticker";
import { serverSecret } from "./serverSecret";
import {
  FORD_COMPETITION_FACTORY_OPTIONS,
  FORD_COMPETITION_FACTORY_OPTIONS_UNAVAILABLE,
  FORD_COMPETITION_LOADING,
  FORD_COMPETITION_NEED_LOCATION,
  FORD_MUST_HAVE_HEADING,
  FORD_MUST_HAVE_HELP,
  advertisedOrStickerPrice,
  autoFillCompetitionSlots,
  fordCompetitionEmptyCopy,
  formatFactoryOptionLine,
  formatPriceAmount,
} from "./fordCompetitionUi";
import { resolveListingsProvider } from "./listingsProvider";
import {
  DEMO_COMPARABLE_LISTINGS,
  dealerIdentity,
  findSimilarFordVehicles,
  fordMatchToVehicle,
  formatListingPrice,
  hasListingsApiKey,
  isUsableHuntLocation,
  listingDealerId,
  rankFordMatches,
  searchCoarseListings,
  selectCompetitionSlots,
  stickerFromDemoFixture,
  type FordMatchCard,
  type ListingCandidate,
} from "./vinSearch";

const FIXTURE_DIR = path.join(import.meta.dirname, "testdata", "ford-stickers");
const SUBJECT = "1FMWK8JCXTGB47204";
const SHORKEY = "1FMWK8JC7TGB81309";
const BATTLEFIELD = "1FMWK8JC1TGB69561";
const MALL_OF_GEORGIA = "1FMWK8JC7TGA20216";
const DECOY_23 = "1FMUK8JH8TGB25138";
const ROUTE23_STX_A = "1FTEW2L56TFB33029";
const ROUTE23_STX_B = "1FTEW2LP7TFB90258";
const PARAMUS_STX = "1FTFW3L89TFB11111";
const F150_SUBJECT = "1FTFW3LD7TFB08996";

function loadFixture(vin: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${vin}.txt`), "utf8");
}

function baseCard(vin: string): FordMatchCard {
  return {
    vin,
    dealerName: "A",
    city: "Butler",
    state: "NJ",
    zip: "07405",
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
    factoryOptions: [],
    factoryOptionsStatus: "unavailable",
  };
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
    const near = { ...baseCard("NEAR"), distanceMiles: 20, listingPrice: 60000, matchedNiceToHaves: [] };
    const farCheapNice = {
      ...baseCard("FAR"),
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

  it("selects the nearest lot, then the nearest lot from a different dealer", () => {
    const aNear = {
      ...baseCard("A1"),
      dealerId: "23",
      dealerName: "Route 23 Auto Mall Ford",
      distanceMiles: 4,
    };
    const aNearerTwin = {
      ...baseCard("A2"),
      dealerId: "23",
      dealerName: "Route 23 Auto Mall Ford",
      distanceMiles: 5,
    };
    const bFarther = {
      ...baseCard("B1"),
      dealerId: "88",
      dealerName: "All American Ford of Paramus",
      city: "Paramus",
      distanceMiles: 12,
    };
    const ranked = rankFordMatches([bFarther, aNearerTwin, aNear]);
    assert.deepEqual(
      ranked.map((m) => m.vin),
      ["A1", "A2", "B1"]
    );
    assert.deepEqual(
      selectCompetitionSlots(ranked).map((m) => m.vin),
      ["A1", "B1"],
      "slot 2 must skip the second Route 23 lot when another dealer matched"
    );
  });

  it("keeps two lots from the only dealer instead of inventing a second rooftop", () => {
    const a1 = { ...baseCard("A1"), dealerId: "23", dealerName: "Route 23 Auto Mall Ford", distanceMiles: 4 };
    const a2 = { ...baseCard("A2"), dealerId: "23", dealerName: "Route 23 Auto Mall Ford", distanceMiles: 5 };
    assert.deepEqual(
      selectCompetitionSlots(rankFordMatches([a2, a1])).map((m) => m.vin),
      ["A1", "A2"]
    );
    assert.deepEqual(
      selectCompetitionSlots([{ ...a1 }]).map((m) => m.vin),
      ["A1"]
    );
  });

  it("treats the same dealer id as one rooftop even when names differ slightly", () => {
    const a1 = { ...baseCard("A1"), dealerId: "23", dealerName: "Route 23 Auto Mall Ford", distanceMiles: 4 };
    const a2 = { ...baseCard("A2"), dealerId: "23", dealerName: "Route 23 Ford", distanceMiles: 5 };
    const b1 = { ...baseCard("B1"), dealerId: "88", dealerName: "Mahwah Ford", distanceMiles: 18 };
    assert.equal(dealerIdentity(a1), dealerIdentity(a2));
    assert.notEqual(dealerIdentity(a1), dealerIdentity(b1));
    assert.deepEqual(
      selectCompetitionSlots(rankFordMatches([a1, a2, b1])).map((m) => m.vin),
      ["A1", "B1"]
    );
  });

  it("falls back to normalized name + rooftop when no dealer id is present", () => {
    const a1 = {
      ...baseCard("A1"),
      dealerName: "Route 23 Auto Mall Ford",
      city: "Butler",
      state: "NJ",
      zip: "07405",
      distanceMiles: 3,
    };
    const a2 = {
      ...baseCard("A2"),
      dealerName: "route-23 auto mall ford",
      city: "Butler",
      state: "NJ",
      zip: "07405",
      distanceMiles: 4,
    };
    const otherRooftop = {
      ...baseCard("C1"),
      dealerName: "Route 23 Auto Mall Ford",
      city: "Wayne",
      state: "NJ",
      zip: "07470",
      distanceMiles: 9,
    };
    assert.equal(dealerIdentity(a1), dealerIdentity(a2));
    assert.notEqual(dealerIdentity(a1), dealerIdentity(otherRooftop));
    assert.deepEqual(
      selectCompetitionSlots(rankFordMatches([a1, a2, otherRooftop])).map((m) => m.vin),
      ["A1", "C1"]
    );
    assert.equal(listingDealerId(1018922, "  "), "1018922");
    assert.equal(listingDealerId(undefined, "", "mc-9"), "mc-9");
  });

  it("fixture hunt still returns Shorkey + Battlefield only among the demo VINs when radius allows", async () => {
    const subject = parseFordStickerText(SUBJECT, loadFixture(SUBJECT));
    const result = await findSimilarFordVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: ["Ultimate Package", "Keyless Entry Keypad"],
      zip: "07405",
      radiusMiles: 500,
      listings: DEMO_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseFordStickerText(vin, loadFixture(vin)),
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

function releasedF150Sticker(vin: string) {
  return {
    vin,
    status: "released" as const,
    year: 2026,
    make: "Ford",
    model: "F-150",
    trim: "STX",
    msrp: 52110,
    basePrice: 43000,
    optionsPrice: 7000,
    destination: 2110,
    options: [],
    standardEquipment: [],
    rawText: "",
    pdfUrl: "",
    fetchedAt: "2026-01-01T00:00:00.000Z",
  };
}

function f150HuntListing(partial: Partial<ListingCandidate> & { vin: string }): ListingCandidate {
  return {
    year: 2026,
    make: "Ford",
    model: "F-150",
    trim: "STX",
    listingPrice: 48990,
    ...partial,
  };
}

describe("Increase Competition prefers two dealers among sticker matches", () => {
  it("07405 F-150 hunt: two Route 23 lots plus a farther Paramus match → slots are Route 23 and Paramus", async () => {
    const subject = {
      ...releasedF150Sticker(F150_SUBJECT),
      vin: F150_SUBJECT,
    };
    const route23 = {
      dealerId: "1018922",
      dealerName: "Route 23 Auto Mall Ford",
      city: "Butler",
      state: "NJ",
      zip: "07405",
      lat: 40.927,
      lng: -74.341,
    };
    const listings = [
      f150HuntListing({ vin: ROUTE23_STX_A, ...route23, listingPrice: 48990 }),
      f150HuntListing({ vin: ROUTE23_STX_B, ...route23, listingPrice: 49250 }),
      f150HuntListing({
        vin: PARAMUS_STX,
        dealerId: "2044551",
        dealerName: "All American Ford of Paramus",
        city: "Paramus",
        state: "NJ",
        zip: "07652",
        lat: 40.944,
        lng: -74.075,
        listingPrice: 47990,
      }),
    ];
    const stickers: Record<string, ReturnType<typeof releasedF150Sticker>> = {
      [ROUTE23_STX_A]: releasedF150Sticker(ROUTE23_STX_A),
      [ROUTE23_STX_B]: releasedF150Sticker(ROUTE23_STX_B),
      [PARAMUS_STX]: releasedF150Sticker(PARAMUS_STX),
    };

    const result = await findSimilarFordVehicles({
      subjectVin: F150_SUBJECT,
      subject,
      mustHaveLines: [],
      zip: "07405",
      radiusMiles: 100,
      listings,
      fetchSticker: async (vin) => stickers[vin],
    });

    assert.equal(result.matches.length, 2);
    assert.equal(result.matches[0].dealerName, "Route 23 Auto Mall Ford");
    assert.ok(
      [ROUTE23_STX_A, ROUTE23_STX_B].includes(result.matches[0].vin),
      "slot 1 is the nearest Route 23 lot"
    );
    assert.equal(result.matches[1].vin, PARAMUS_STX);
    assert.equal(result.matches[1].dealerName, "All American Ford of Paramus");
    assert.notEqual(result.matches[0].dealerId, result.matches[1].dealerId);
    assert.ok(
      (result.matches[0].distanceMiles ?? Infinity) <= (result.matches[1].distanceMiles ?? Infinity)
    );
    assert.ok(
      result.matches.every((m) => m.distanceMiles != null && m.distanceMiles <= 100),
      "must not expand the user radius"
    );
    assert.equal(
      result.matches.filter((m) => m.dealerName === "Route 23 Auto Mall Ford").length,
      1,
      "two Route 23 STXs must not occupy both slots when Paramus also sticker-matched"
    );
    const [slot0, slot1] = autoFillCompetitionSlots(result.matches);
    assert.equal(slot0?.dealerName, "Route 23 Auto Mall Ford");
    assert.equal(slot1?.vin, PARAMUS_STX);
  });

  it("only Route 23 in the matched set → still returns that rooftop, no demo padding", async () => {
    const subject = releasedF150Sticker(F150_SUBJECT);
    const route23 = {
      dealerId: "1018922",
      dealerName: "Route 23 Auto Mall Ford",
      city: "Butler",
      state: "NJ",
      zip: "07405",
      lat: 40.927,
      lng: -74.341,
    };
    const listings = [
      f150HuntListing({ vin: ROUTE23_STX_A, ...route23 }),
      f150HuntListing({ vin: ROUTE23_STX_B, ...route23 }),
    ];
    const stickers: Record<string, ReturnType<typeof releasedF150Sticker>> = {
      [ROUTE23_STX_A]: releasedF150Sticker(ROUTE23_STX_A),
      [ROUTE23_STX_B]: releasedF150Sticker(ROUTE23_STX_B),
    };

    const result = await findSimilarFordVehicles({
      subjectVin: F150_SUBJECT,
      subject,
      mustHaveLines: [],
      zip: "07405",
      radiusMiles: 100,
      listings,
      fetchSticker: async (vin) => stickers[vin],
    });

    assert.equal(result.matches.length, 2);
    assert.ok(result.matches.every((m) => m.dealerName === "Route 23 Auto Mall Ford"));
    assert.ok(result.matches.every((m) => m.dealerId === "1018922"));
    assert.deepEqual(
      result.matches.map((m) => m.vin).sort(),
      [ROUTE23_STX_A, ROUTE23_STX_B].sort()
    );
    assert.ok(!result.matches.some((m) => DEMO_COMPARABLE_LISTINGS.some((d) => d.vin === m.vin)));
    assert.doesNotMatch(result.note, /Explorer Tremor only/i);
  });

  it("a single sticker-matched rooftop returns one slot and does not pad with Explorers", async () => {
    const subject = releasedF150Sticker(F150_SUBJECT);
    const result = await findSimilarFordVehicles({
      subjectVin: F150_SUBJECT,
      subject,
      mustHaveLines: [],
      zip: "07405",
      radiusMiles: 100,
      listings: [
        f150HuntListing({
          vin: ROUTE23_STX_A,
          dealerId: "1018922",
          dealerName: "Route 23 Auto Mall Ford",
          city: "Butler",
          state: "NJ",
          zip: "07405",
          lat: 40.927,
          lng: -74.341,
        }),
      ],
      fetchSticker: async (vin) => releasedF150Sticker(vin),
    });
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].vin, ROUTE23_STX_A);
    assert.equal(autoFillCompetitionSlots(result.matches)[1], null);
    assert.ok(!result.matches.some((m) => m.vin === SHORKEY || m.vin === BATTLEFIELD));
    assert.equal(result.matches[0].factoryOptionsStatus, "unavailable");
    assert.deepEqual(result.matches[0].factoryOptions, []);
  });
});

describe("shopper-facing factory option copy", () => {
  it("must-have picker and competition breakout copy never say sticker", () => {
    for (const copy of [
      FORD_MUST_HAVE_HEADING,
      FORD_MUST_HAVE_HELP,
      FORD_COMPETITION_FACTORY_OPTIONS,
      FORD_COMPETITION_FACTORY_OPTIONS_UNAVAILABLE,
    ]) {
      assert.doesNotMatch(copy, /sticker/i);
    }
    assert.equal(
      formatFactoryOptionLine({ code: "800A", description: "EQUIPMENT GROUP 800A" }),
      "EQUIPMENT GROUP 800A"
    );
    assert.equal(
      formatFactoryOptionLine({ code: "67C", description: "Ultimate Package" }),
      "67C  Ultimate Package"
    );
    assert.equal(formatFactoryOptionLine({ code: null, description: "Keyless Entry Keypad" }), "Keyless Entry Keypad");
  });

  it("must-have picker is checkbox plus text with no bordered cards or sticker label", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/BiddingWizard.tsx"), "utf8");
    const start = src.indexOf("function FactoryMustHavePicker");
    const end = src.indexOf("function competitionFactoryLines");
    assert.ok(start >= 0 && end > start);
    const picker = src.slice(start, end);
    assert.match(picker, /type="checkbox"/);
    assert.doesNotMatch(picker, /sticker/i);
    assert.doesNotMatch(picker, /rounded-lg border/);
    assert.doesNotMatch(picker, /bg-surface-elevated/);
    assert.match(src, /FORD_MUST_HAVE_HEADING/);
    assert.match(src, /FORD_MUST_HAVE_HELP/);
    assert.match(src, /FORD_COMPETITION_FACTORY_OPTIONS_UNAVAILABLE/);
  });

  it("tests never call live MarketCheck, Auto.dev, Ford Direct, or production comparables", async () => {
    const vinSearchTest = fs.readFileSync(path.join(import.meta.dirname, "vinSearch.test.ts"), "utf8");
    const stickerTest = fs.readFileSync(path.join(import.meta.dirname, "fordSticker.test.ts"), "utf8");
    const dealStructureTest = fs.readFileSync(path.join(import.meta.dirname, "dealStructure.test.ts"), "utf8");
    const guardSrc = fs.readFileSync(path.join(import.meta.dirname, "testdata/blockLiveHttp.ts"), "utf8");
    for (const src of [vinSearchTest, stickerTest, dealStructureTest]) {
      assert.match(src, /blockLiveHttp/);
      assert.doesNotMatch(src, /getFordSticker\(/);
      assert.doesNotMatch(src, /confirmFordMustHaves\(/);
      assert.doesNotMatch(src, /fetch\([^)]*trim-scout\.vercel\.app/);
      assert.doesNotMatch(src, /\bcurl\b[\s\S]{0,120}trim-scout\.vercel\.app/);
    }
    assert.ok(guardSrc.includes("forddirect"));
    assert.ok(guardSrc.includes("marketcheck"));
    assert.ok(guardSrc.includes("auto.dev") || guardSrc.includes("auto\\.dev"));
    assert.ok(guardSrc.includes("trim-scout"));
    assert.equal(LIVE_HTTP_BLOCKLIST.test("https://www.windowsticker.forddirect.com/windowsticker.pdf?vin=X"), true);
    assert.equal(LIVE_HTTP_BLOCKLIST.test("https://api.marketcheck.com/v2/search/car/active"), true);
    assert.equal(LIVE_HTTP_BLOCKLIST.test("https://api.auto.dev/listings"), true);
    assert.equal(LIVE_HTTP_BLOCKLIST.test("https://trim-scout.vercel.app/api/ford-comparables"), true);
    assert.equal(LIVE_HTTP_BLOCKLIST.test("https://example.com/ford/vdp"), false);
    await assert.rejects(
      () => guardedFetch("https://www.windowsticker.forddirect.com/windowsticker.pdf?vin=1FTFW3LD7TFB08996"),
      /must mock HTTP/
    );
    await assert.rejects(
      () => guardedFetch("https://api.marketcheck.com/v2/search/car/active"),
      /must mock HTTP/
    );
    await assert.rejects(
      () => guardedFetch("https://trim-scout.vercel.app/api/ford-comparables"),
      /must mock HTTP/
    );
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
    const prevA = process.env["AUTO_DEV_API_KEY"];
    const prevM = process.env["MARKETCHECK_API_KEY"];
    delete process.env["AUTO_DEV_API_KEY"];
    delete process.env["MARKETCHECK_API_KEY"];
    try {
      assert.ok(stickerFromDemoFixture(BATTLEFIELD)?.status === "released");
      assert.ok(stickerFromDemoFixture(SHORKEY)?.status === "released");
      const subject = parseFordStickerText(SUBJECT, loadFixture(SUBJECT));
      const result = await findSimilarFordVehicles({
        subjectVin: SUBJECT,
        subject,
        mustHaveLines: [],
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
      assert.equal(second?.listingPrice, 58372);
      assert.equal(second?.listingPriceSource, "listing");
      assert.equal(first?.factoryOptionsStatus, "ok");
      assert.equal(second?.factoryOptionsStatus, "ok");
      assert.ok((first?.factoryOptions.length || 0) > (first?.matchedMustHaves.length || 0));
      assert.ok(first?.factoryOptions.some((o) => /Ultimate Package/i.test(o.description)));
      assert.ok(first?.factoryOptions.some((o) => o.isPackageChild));
      assert.ok(!first?.factoryOptions.some((o) => /Fuel Economy/i.test(o.description)));
      assert.equal(first?.listingPrice, null);
      assert.equal(advertisedOrStickerPrice(first?.listingPrice, first?.msrp).source, "sticker");
      assert.ok((first?.msrp || 0) > 0);
    } finally {
      if (prevA !== undefined) process.env["AUTO_DEV_API_KEY"] = prevA;
      else delete process.env["AUTO_DEV_API_KEY"];
      if (prevM !== undefined) process.env["MARKETCHECK_API_KEY"] = prevM;
      else delete process.env["MARKETCHECK_API_KEY"];
    }
  });

  it("fills a missing listings-API price from that lot's VDP sale price", async () => {
    const subject = parseFordStickerText(SUBJECT, loadFixture(SUBJECT));
    const battlefield = DEMO_COMPARABLE_LISTINGS.find((l) => l.vin === BATTLEFIELD);
    const shorkey = DEMO_COMPARABLE_LISTINGS.find((l) => l.vin === SHORKEY);
    assert.ok(battlefield && shorkey);
    let vdpCalls = 0;
    const result = await findSimilarFordVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: [],
      zip: "07405",
      radiusMiles: 500,
      listings: [
        { ...battlefield, dealerUrl: "https://www.example.com/ford/vdp-a", listingPrice: null },
        { ...shorkey },
      ],
      fetchVdpPrice: async (url) => {
        vdpCalls += 1;
        assert.equal(url, "https://www.example.com/ford/vdp-a");
        return 41250;
      },
    });
    assert.equal(result.matches[0]?.vin, BATTLEFIELD);
    assert.equal(result.matches[0]?.listingPrice, 41250);
    assert.equal(result.matches[0]?.listingPriceSource, "listing");
    assert.equal(result.matches[1]?.listingPrice, 58372);
    assert.equal(vdpCalls, 1);
  });

  it("does not scrape a VDP when the listings API already has a price", async () => {
    const subject = parseFordStickerText(SUBJECT, loadFixture(SUBJECT));
    const shorkey = DEMO_COMPARABLE_LISTINGS.find((l) => l.vin === SHORKEY);
    assert.ok(shorkey);
    const result = await findSimilarFordVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: [],
      zip: "07405",
      radiusMiles: 500,
      listings: [{ ...shorkey, listingPrice: 58372 }],
      fetchVdpPrice: async () => {
        throw new Error("should not fetch VDP when listings price exists");
      },
    });
    assert.equal(result.matches[0]?.listingPrice, 58372);
    assert.equal(result.matches[0]?.listingPriceSource, "listing");
  });

  it("blocked comparable VDP still shows sticker MSRP, never call dealer", async () => {
    const subject = parseFordStickerText(SUBJECT, loadFixture(SUBJECT));
    const battlefield = DEMO_COMPARABLE_LISTINGS.find((l) => l.vin === BATTLEFIELD);
    assert.ok(battlefield);
    const result = await findSimilarFordVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: [],
      zip: "07405",
      radiusMiles: 500,
      listings: [
        { ...battlefield, dealerUrl: "https://www.example.com/ford/blocked", listingPrice: null },
      ],
      fetchVdpPrice: async () => null,
    });
    assert.equal(result.matches[0]?.listingPrice, null);
    const shown = advertisedOrStickerPrice(result.matches[0]?.listingPrice, result.matches[0]?.msrp);
    assert.equal(shown.source, "sticker");
    assert.ok((shown.amount || 0) > 0);
    assert.doesNotMatch(formatPriceAmount(shown.amount), /call dealer/i);
  });

  it("demo Bronco Sport with zip/radius does not hang or pad Explorers", async () => {
    const prevA = process.env["AUTO_DEV_API_KEY"];
    const prevM = process.env["MARKETCHECK_API_KEY"];
    delete process.env["AUTO_DEV_API_KEY"];
    delete process.env["MARKETCHECK_API_KEY"];
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
      assert.equal(copy!.message, result.note);
    } finally {
      if (prevA !== undefined) process.env["AUTO_DEV_API_KEY"] = prevA;
      else delete process.env["AUTO_DEV_API_KEY"];
      if (prevM !== undefined) process.env["MARKETCHECK_API_KEY"] = prevM;
      else delete process.env["MARKETCHECK_API_KEY"];
    }
  });
});

describe("listings secrets are read from Node env, not webpack-stripped process.env", () => {
  it("serverSecret uses node:process env plus static fallbacks; listings modules do not rely solely on dynamic process.env[name]", () => {
    const vinSearchSrc = fs.readFileSync(path.join(import.meta.dirname, "vinSearch.ts"), "utf8");
    const listingsProviderSrc = fs.readFileSync(path.join(import.meta.dirname, "listingsProvider.ts"), "utf8");
    const helperSrc = fs.readFileSync(path.join(import.meta.dirname, "serverSecret.ts"), "utf8");
    const inventorySrc = fs.readFileSync(path.join(process.cwd(), "app/api/inventory/route.ts"), "utf8");
    const routeSrc = fs.readFileSync(path.join(process.cwd(), "app/api/ford-comparables/route.ts"), "utf8");
    assert.match(helperSrc, /from ["']node:process["']/);
    assert.match(helperSrc, /env\[name\]/);
    assert.match(helperSrc, /env\.AUTO_DEV_API_KEY \|\| process\.env\.AUTO_DEV_API_KEY/);
    assert.match(helperSrc, /env\.MARKETCHECK_API_KEY \|\| process\.env\.MARKETCHECK_API_KEY/);
    assert.match(helperSrc, /env\.LISTINGS_PROVIDER \|\| process\.env\.LISTINGS_PROVIDER/);
    assert.doesNotMatch(helperSrc, /NEXT_PUBLIC_[A-Z0-9_]+/);
    assert.match(routeSrc, /export const dynamic = ["']force-dynamic["']/);
    assert.match(routeSrc, /export const runtime = ["']nodejs["']/);
    assert.match(routeSrc, /export const revalidate = 0/);
    assert.match(listingsProviderSrc, /serverSecret\(/);
    assert.match(inventorySrc, /serverSecret\(/);
    assert.match(vinSearchSrc, /resolveListingsProvider/);
    for (const src of [vinSearchSrc, inventorySrc, listingsProviderSrc]) {
      assert.doesNotMatch(src, /process\.env\[/);
      assert.doesNotMatch(src, /process\.env\.AUTO_DEV_API_KEY/);
      assert.doesNotMatch(src, /process\.env\.MARKETCHECK_API_KEY/);
    }
    assert.doesNotMatch(vinSearchSrc, /searchParams\.set\(["']vehicle\.trim["']/);
    assert.doesNotMatch(vinSearchSrc, /searchParams\.set\(["']trim["']/);
    assert.doesNotMatch(vinSearchSrc, /Math\.min\([^)]*100/);
    assert.doesNotMatch(vinSearchSrc, /redis|@vercel\/kv|upstash/i);
    assert.match(vinSearchSrc, /api\.marketcheck\.com\/v2\/search\/car\/active/);
    assert.match(routeSrc, /hasListingsKey/);
    assert.doesNotMatch(routeSrc, /NEXT_PUBLIC_/);
  });

  it("serverSecret reads AUTO_DEV_API_KEY, MARKETCHECK_API_KEY, and LISTINGS_PROVIDER from node:process env", () => {
    const prevA = env["AUTO_DEV_API_KEY"];
    const prevM = env["MARKETCHECK_API_KEY"];
    const prevP = env["LISTINGS_PROVIDER"];
    env["AUTO_DEV_API_KEY"] = "runtime-test-auto-dev";
    env["MARKETCHECK_API_KEY"] = "runtime-test-marketcheck";
    env["LISTINGS_PROVIDER"] = "auto.dev";
    try {
      assert.equal(serverSecret("AUTO_DEV_API_KEY"), "runtime-test-auto-dev");
      assert.equal(serverSecret("MARKETCHECK_API_KEY"), "runtime-test-marketcheck");
      assert.equal(serverSecret("LISTINGS_PROVIDER"), "auto.dev");
    } finally {
      if (prevA !== undefined) env["AUTO_DEV_API_KEY"] = prevA;
      else delete env["AUTO_DEV_API_KEY"];
      if (prevM !== undefined) env["MARKETCHECK_API_KEY"] = prevM;
      else delete env["MARKETCHECK_API_KEY"];
      if (prevP !== undefined) env["LISTINGS_PROVIDER"] = prevP;
      else delete env["LISTINGS_PROVIDER"];
    }
  });

  it("searchCoarseListings chooses auto.dev when AUTO_DEV_API_KEY is set on node:process env", async () => {
    const prevA = env["AUTO_DEV_API_KEY"];
    const prevM = env["MARKETCHECK_API_KEY"];
    const prevP = env["LISTINGS_PROVIDER"];
    env["AUTO_DEV_API_KEY"] = "runtime-test-auto-dev";
    delete env["MARKETCHECK_API_KEY"];
    delete env["LISTINGS_PROVIDER"];
    const origFetch = globalThis.fetch;
    let autoDevCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const parsed = new URL(url);
      assert.equal(parsed.origin + parsed.pathname, "https://api.auto.dev/listings");
      assert.equal(parsed.searchParams.get("vehicle.make"), "Ford");
      assert.equal(parsed.searchParams.get("vehicle.model"), "F-150");
      assert.equal(parsed.searchParams.get("vehicle.year"), "2026");
      assert.equal(parsed.searchParams.get("zip"), "07405");
      assert.equal(parsed.searchParams.get("distance"), "500");
      assert.equal(parsed.searchParams.get("retailListing.used"), "false");
      assert.equal(parsed.searchParams.get("includeUnpriced"), "true");
      assert.equal(parsed.searchParams.has("vehicle.trim"), false);
      autoDevCalls += 1;
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer runtime-test-auto-dev");
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const result = await searchCoarseListings({
        year: 2026,
        make: "Ford",
        model: "F-150",
        trim: "Raptor R",
        zip: "07405",
        radiusMiles: 500,
      });
      assert.equal(result.provider, "auto.dev");
      assert.equal(autoDevCalls, 1);
      assert.equal(hasListingsApiKey(), true);
      assert.match(result.note, /Auto\.dev/);
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

  it("searchCoarseListings chooses marketcheck when only MARKETCHECK_API_KEY is set on node:process env", async () => {
    const prevA = env["AUTO_DEV_API_KEY"];
    const prevM = env["MARKETCHECK_API_KEY"];
    const prevP = env["LISTINGS_PROVIDER"];
    delete env["AUTO_DEV_API_KEY"];
    delete env["LISTINGS_PROVIDER"];
    env["MARKETCHECK_API_KEY"] = "runtime-test-marketcheck";
    const origFetch = globalThis.fetch;
    let marketcheckCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input));
      assert.equal(parsed.origin + parsed.pathname, "https://api.marketcheck.com/v2/search/car/active");
      assert.equal(parsed.searchParams.get("api_key"), "runtime-test-marketcheck");
      assert.equal(parsed.searchParams.get("append_api_key"), "false");
      assert.equal(parsed.searchParams.get("make"), "Ford");
      assert.equal(parsed.searchParams.get("model"), "F-150");
      assert.equal(parsed.searchParams.get("year"), "2026");
      assert.equal(parsed.searchParams.get("zip"), "07405");
      assert.equal(parsed.searchParams.get("radius"), "500", "must not clamp the user radius");
      assert.equal(parsed.searchParams.get("car_type"), "new");
      assert.equal(parsed.searchParams.get("rows"), "50");
      assert.equal(parsed.searchParams.has("trim"), false);
      marketcheckCalls += 1;
      return new Response(JSON.stringify({ num_found: 0, listings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const result = await searchCoarseListings({
        year: 2026,
        make: "Ford",
        model: "F-150",
        trim: "Raptor R",
        zip: "07405",
        radiusMiles: 500,
      });
      assert.equal(result.provider, "marketcheck");
      assert.equal(marketcheckCalls, 1);
      assert.equal(hasListingsApiKey(), true);
      assert.match(result.note, /MarketCheck/);
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
});

describe("listings API failure never falls back to Explorer demo", () => {
  it("hasListingsKey is true iff a listings key is configured (boolean only)", () => {
    const prevA = env["AUTO_DEV_API_KEY"];
    const prevM = env["MARKETCHECK_API_KEY"];
    try {
      delete env["AUTO_DEV_API_KEY"];
      delete env["MARKETCHECK_API_KEY"];
      assert.equal(hasListingsApiKey(), false);

      env["AUTO_DEV_API_KEY"] = "runtime-test-auto-dev";
      assert.equal(hasListingsApiKey(), true);

      delete env["AUTO_DEV_API_KEY"];
      env["MARKETCHECK_API_KEY"] = "runtime-test-marketcheck";
      assert.equal(hasListingsApiKey(), true);

      env["AUTO_DEV_API_KEY"] = "   ";
      env["MARKETCHECK_API_KEY"] = "   ";
      assert.equal(hasListingsApiKey(), false);
    } finally {
      if (prevA !== undefined) env["AUTO_DEV_API_KEY"] = prevA;
      else delete env["AUTO_DEV_API_KEY"];
      if (prevM !== undefined) env["MARKETCHECK_API_KEY"] = prevM;
      else delete env["MARKETCHECK_API_KEY"];
    }
  });

  it("Auto.dev HTTP 429 returns provider auto.dev, empty listings, and Retry-After seconds — not Explorer demo", async () => {
    const prevA = env["AUTO_DEV_API_KEY"];
    const prevM = env["MARKETCHECK_API_KEY"];
    const prevP = env["LISTINGS_PROVIDER"];
    env["AUTO_DEV_API_KEY"] = "runtime-test-auto-dev";
    delete env["MARKETCHECK_API_KEY"];
    delete env["LISTINGS_PROVIDER"];
    const origFetch = globalThis.fetch;
    let autoDevCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      assert.match(url, /api\.auto\.dev\/listings/);
      assert.doesNotMatch(url, /marketcheck/i);
      assert.doesNotMatch(url, /vehicle\.trim=/);
      autoDevCalls += 1;
      return new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "30" },
      });
    }) as typeof fetch;
    try {
      const coarse = await searchCoarseListings({
        year: 2026,
        make: "Ford",
        model: "F-150",
        trim: "Raptor R",
        zip: "07405",
        radiusMiles: 500,
      });
      assert.equal(coarse.provider, "auto.dev");
      assert.deepEqual(coarse.listings, []);
      assert.equal(coarse.listingsError, true);
      assert.match(coarse.note, /HTTP 429/);
      assert.match(coarse.note, /30 seconds/);
      assert.doesNotMatch(coarse.note, /Explorer Tremor only/i);
      assert.doesNotMatch(coarse.note, /runtime-test-auto-dev/);
      assert.doesNotMatch(coarse.note, /Bearer/i);
      assert.equal(autoDevCalls, 1);

      const bronco = parseFordStickerText(
        "3FMCR9BN8TRE94740",
        fs.readFileSync(path.join(FIXTURE_DIR, "3FMCR9BN8TRE94740.txt"), "utf8")
      );
      const hunt = await findSimilarFordVehicles({
        subjectVin: bronco.vin,
        subject: bronco,
        mustHaveLines: [],
        zip: "07405",
        radiusMiles: 500,
      });
      assert.equal(hunt.provider, "auto.dev");
      assert.equal(hunt.hasListingsKey, true);
      assert.equal(hunt.matches.length, 0);
      assert.equal(hunt.candidatesConsidered, 0);
      assert.equal(hunt.stickersFetched, 0);
      assert.match(hunt.note, /HTTP 429/);
      assert.match(hunt.note, /30 seconds/);
      assert.doesNotMatch(hunt.note, /Explorer Tremor only/i);
      assert.doesNotMatch(hunt.note, /Demo listings/i);
      assert.doesNotMatch(hunt.note, /runtime-test-auto-dev/);
      assert.equal(autoDevCalls, 2, "one Auto.dev request per hunt, no retry loop");
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

  it("findSimilarFordVehicles reports hasListingsKey false in demo when no listings key is set", async () => {
    const prevA = env["AUTO_DEV_API_KEY"];
    const prevM = env["MARKETCHECK_API_KEY"];
    delete env["AUTO_DEV_API_KEY"];
    delete env["MARKETCHECK_API_KEY"];
    try {
      assert.equal(hasListingsApiKey(), false);
      const subject = parseFordStickerText(SUBJECT, loadFixture(SUBJECT));
      const result = await findSimilarFordVehicles({
        subjectVin: SUBJECT,
        subject,
        mustHaveLines: [],
        zip: "07405",
        radiusMiles: 500,
      });
      assert.equal(result.provider, "demo");
      assert.equal(result.hasListingsKey, false);
    } finally {
      if (prevA !== undefined) env["AUTO_DEV_API_KEY"] = prevA;
      else delete env["AUTO_DEV_API_KEY"];
      if (prevM !== undefined) env["MARKETCHECK_API_KEY"] = prevM;
      else delete env["MARKETCHECK_API_KEY"];
    }
  });
});

describe("listings provider selection prefers MarketCheck", () => {
  it("resolveListingsProvider prefers MarketCheck when both keys are set", () => {
    const prevA = env["AUTO_DEV_API_KEY"];
    const prevM = env["MARKETCHECK_API_KEY"];
    const prevP = env["LISTINGS_PROVIDER"];
    env["AUTO_DEV_API_KEY"] = "runtime-test-auto-dev";
    env["MARKETCHECK_API_KEY"] = "runtime-test-marketcheck";
    delete env["LISTINGS_PROVIDER"];
    try {
      assert.deepEqual(resolveListingsProvider(), {
        provider: "marketcheck",
        key: "runtime-test-marketcheck",
      });
      assert.equal(hasListingsApiKey(), true);
    } finally {
      if (prevA !== undefined) env["AUTO_DEV_API_KEY"] = prevA;
      else delete env["AUTO_DEV_API_KEY"];
      if (prevM !== undefined) env["MARKETCHECK_API_KEY"] = prevM;
      else delete env["MARKETCHECK_API_KEY"];
      if (prevP !== undefined) env["LISTINGS_PROVIDER"] = prevP;
      else delete env["LISTINGS_PROVIDER"];
    }
  });

  it("LISTINGS_PROVIDER=auto.dev uses Auto.dev even when a MarketCheck key is also set", () => {
    const prevA = env["AUTO_DEV_API_KEY"];
    const prevM = env["MARKETCHECK_API_KEY"];
    const prevP = env["LISTINGS_PROVIDER"];
    env["AUTO_DEV_API_KEY"] = "runtime-test-auto-dev";
    env["MARKETCHECK_API_KEY"] = "runtime-test-marketcheck";
    env["LISTINGS_PROVIDER"] = "auto.dev";
    try {
      assert.equal(resolveListingsProvider().provider, "auto.dev");
      assert.equal(resolveListingsProvider().key, "runtime-test-auto-dev");
    } finally {
      if (prevA !== undefined) env["AUTO_DEV_API_KEY"] = prevA;
      else delete env["AUTO_DEV_API_KEY"];
      if (prevM !== undefined) env["MARKETCHECK_API_KEY"] = prevM;
      else delete env["MARKETCHECK_API_KEY"];
      if (prevP !== undefined) env["LISTINGS_PROVIDER"] = prevP;
      else delete env["LISTINGS_PROVIDER"];
    }
  });

  it("LISTINGS_PROVIDER=marketcheck is ignored when that key is missing and Auto.dev is used", () => {
    const prevA = env["AUTO_DEV_API_KEY"];
    const prevM = env["MARKETCHECK_API_KEY"];
    const prevP = env["LISTINGS_PROVIDER"];
    env["AUTO_DEV_API_KEY"] = "runtime-test-auto-dev";
    delete env["MARKETCHECK_API_KEY"];
    env["LISTINGS_PROVIDER"] = "marketcheck";
    try {
      assert.equal(resolveListingsProvider().provider, "auto.dev");
    } finally {
      if (prevA !== undefined) env["AUTO_DEV_API_KEY"] = prevA;
      else delete env["AUTO_DEV_API_KEY"];
      if (prevM !== undefined) env["MARKETCHECK_API_KEY"] = prevM;
      else delete env["MARKETCHECK_API_KEY"];
      if (prevP !== undefined) env["LISTINGS_PROVIDER"] = prevP;
      else delete env["LISTINGS_PROVIDER"];
    }
  });

  it("searchCoarseListings hits MarketCheck once when both keys are set", async () => {
    const prevA = env["AUTO_DEV_API_KEY"];
    const prevM = env["MARKETCHECK_API_KEY"];
    const prevP = env["LISTINGS_PROVIDER"];
    env["AUTO_DEV_API_KEY"] = "runtime-test-auto-dev";
    env["MARKETCHECK_API_KEY"] = "runtime-test-marketcheck";
    delete env["LISTINGS_PROVIDER"];
    const origFetch = globalThis.fetch;
    let marketcheckCalls = 0;
    let autoDevCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.auto.dev")) autoDevCalls += 1;
      if (url.includes("api.marketcheck.com")) marketcheckCalls += 1;
      return new Response(JSON.stringify({ num_found: 0, listings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const result = await searchCoarseListings({
        year: 2026,
        make: "Ford",
        model: "F-150",
        trim: "Raptor R",
        zip: "07405",
        radiusMiles: 500,
      });
      assert.equal(result.provider, "marketcheck");
      assert.equal(marketcheckCalls, 1);
      assert.equal(autoDevCalls, 0);
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

  it("maps MarketCheck listings from build + dealer (string lat/lng) and leaves Ford sticker matching unchanged", async () => {
    const prevA = env["AUTO_DEV_API_KEY"];
    const prevM = env["MARKETCHECK_API_KEY"];
    const prevP = env["LISTINGS_PROVIDER"];
    delete env["AUTO_DEV_API_KEY"];
    delete env["LISTINGS_PROVIDER"];
    env["MARKETCHECK_API_KEY"] = "runtime-test-marketcheck";
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input));
      assert.equal(parsed.origin + parsed.pathname, "https://api.marketcheck.com/v2/search/car/active");
      assert.equal(parsed.searchParams.has("trim"), false);
      return new Response(
        JSON.stringify({
          num_found: 3,
          listings: [
            {
              vin: BATTLEFIELD,
              price: 55990,
              vdp_url: null,
              exterior_color: "Star White",
              build: { year: 2026, make: "Ford", model: "Explorer", trim: "Tremor" },
              dealer: {
                id: 44001,
                name: "Battlefield Ford",
                city: "Culpeper",
                state: "VA",
                zip: "22701",
                latitude: "38.473",
                longitude: "-77.996",
              },
            },
            {
              vin: SHORKEY,
              price: 58372,
              vdp_url:
                "https://www.jimshorkey.com/new-Pittsburgh-2026-Ford-Explorer-Tremor+Ultimate+Package-1FMWK8JC7TGB81309",
              build: { year: 2026, make: "Ford", model: "Explorer", trim: "Tremor" },
              dealer: {
                id: 44002,
                name: "Jim Shorkey Ford",
                city: "White Oak",
                state: "PA",
                zip: "15131",
                latitude: "40.341",
                longitude: "-79.807",
              },
            },
            {
              vin: MALL_OF_GEORGIA,
              price: 61000,
              build: { year: 2026, make: "Ford", model: "Explorer", trim: "Tremor" },
              dealer: {
                name: "Mall of Georgia Ford",
                city: "Buford",
                state: "GA",
                zip: "30518",
                latitude: "34.121",
                longitude: "-84.004",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    try {
      const subject = parseFordStickerText(SUBJECT, loadFixture(SUBJECT));
      const result = await findSimilarFordVehicles({
        subjectVin: SUBJECT,
        subject,
        mustHaveLines: ["Ultimate Package", "Keyless Entry Keypad"],
        zip: "07405",
        radiusMiles: 500,
        fetchSticker: async (vin) => parseFordStickerText(vin, loadFixture(vin)),
      });
      assert.equal(result.provider, "marketcheck");
      assert.equal(result.hasListingsKey, true);
      assert.equal(result.matches.length, 2);
      assert.equal(result.matches[0].vin, BATTLEFIELD);
      assert.equal(result.matches[1].vin, SHORKEY);
      assert.equal(result.matches[0].dealerId, "44001");
      assert.equal(result.matches[1].dealerId, "44002");
      assert.equal(result.matches[0].listingPrice, 55990);
      assert.equal(result.matches[0].listingPriceSource, "listing");
      assert.equal(result.dropped.find((d) => d.vin === MALL_OF_GEORGIA)?.reason, "missing_must_have");
      assert.match(result.note, /MarketCheck|factory options/i);
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

  it("MarketCheck HTTP 400 surfaces status + provider message and does not fall back to demo lots", async () => {
    const prevA = env["AUTO_DEV_API_KEY"];
    const prevM = env["MARKETCHECK_API_KEY"];
    const prevP = env["LISTINGS_PROVIDER"];
    delete env["AUTO_DEV_API_KEY"];
    delete env["LISTINGS_PROVIDER"];
    env["MARKETCHECK_API_KEY"] = "runtime-test-marketcheck";
    const origFetch = globalThis.fetch;
    let marketcheckCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const parsed = new URL(String(input));
      assert.equal(parsed.searchParams.get("radius"), "500");
      marketcheckCalls += 1;
      return new Response(
        JSON.stringify({
          code: 400,
          message: "radius exceeds package limit of 100 miles",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    try {
      const coarse = await searchCoarseListings({
        year: 2026,
        make: "Ford",
        model: "F-150",
        trim: "Raptor R",
        zip: "07405",
        radiusMiles: 500,
      });
      assert.equal(coarse.provider, "marketcheck");
      assert.deepEqual(coarse.listings, []);
      assert.equal(coarse.listingsError, true);
      assert.match(coarse.note, /HTTP 400/);
      assert.match(coarse.note, /radius exceeds package limit of 100 miles/);
      assert.doesNotMatch(coarse.note, /Explorer Tremor only/i);
      assert.doesNotMatch(coarse.note, /runtime-test-marketcheck/);

      const bronco = parseFordStickerText(
        "3FMCR9BN8TRE94740",
        fs.readFileSync(path.join(FIXTURE_DIR, "3FMCR9BN8TRE94740.txt"), "utf8")
      );
      const hunt = await findSimilarFordVehicles({
        subjectVin: bronco.vin,
        subject: bronco,
        mustHaveLines: [],
        zip: "07405",
        radiusMiles: 500,
      });
      assert.equal(hunt.provider, "marketcheck");
      assert.equal(hunt.hasListingsKey, true);
      assert.equal(hunt.matches.length, 0);
      assert.equal(hunt.candidatesConsidered, 0);
      assert.equal(hunt.stickersFetched, 0);
      assert.match(hunt.note, /HTTP 400/);
      assert.match(hunt.note, /radius exceeds package limit of 100 miles/);
      assert.doesNotMatch(hunt.note, /Explorer Tremor only/i);
      assert.doesNotMatch(hunt.note, /Demo listings/i);
      assert.equal(marketcheckCalls, 2, "one MarketCheck request per hunt, no retry or clamp");
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

  it("MarketCheck HTTP 429 includes provider message and Retry-After seconds", async () => {
    const prevA = env["AUTO_DEV_API_KEY"];
    const prevM = env["MARKETCHECK_API_KEY"];
    const prevP = env["LISTINGS_PROVIDER"];
    delete env["AUTO_DEV_API_KEY"];
    delete env["LISTINGS_PROVIDER"];
    env["MARKETCHECK_API_KEY"] = "runtime-test-marketcheck";
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ message: "Monthly API quota exhausted" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "86400" },
      });
    }) as typeof fetch;
    try {
      const coarse = await searchCoarseListings({
        make: "Ford",
        model: "F-150",
        zip: "07405",
        radiusMiles: 500,
      });
      assert.equal(coarse.provider, "marketcheck");
      assert.equal(coarse.listingsError, true);
      assert.match(coarse.note, /HTTP 429/);
      assert.match(coarse.note, /Monthly API quota exhausted/);
      assert.match(coarse.note, /86400 seconds/);
      assert.doesNotMatch(coarse.note, /runtime-test-marketcheck/);
      assert.doesNotMatch(coarse.note, /Explorer Tremor only/i);
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
});

describe("price display never says call dealer", () => {
  it("listing wins over sticker; missing listing falls back to MSRP", () => {
    assert.equal(formatListingPrice(null), "unconfirmed");
    assert.doesNotMatch(formatListingPrice(null), /call dealer/i);
    assert.deepEqual(advertisedOrStickerPrice(null, 64705), { amount: 64705, source: "sticker" });
    assert.deepEqual(advertisedOrStickerPrice(58372, 65500), { amount: 58372, source: "listing" });
    assert.deepEqual(advertisedOrStickerPrice(60294, 64705), { amount: 60294, source: "listing" });
    assert.match(formatPriceAmount(60294), /60,294/);
    assert.match(formatPriceAmount(64705), /64,705/);
    assert.doesNotMatch(formatPriceAmount(null), /call dealer/i);
    assert.doesNotMatch(formatPriceAmount(0), /call dealer/i);
  });
});
