import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { getFordSticker, parseFordStickerText } from "./fordSticker";
import {
  DEMO_COMPARABLE_LISTINGS,
  findSimilarFordVehicles,
  isUsableHuntLocation,
  rankFordMatches,
  type FordMatchCard,
} from "./vinSearch";

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
    assert.ok(matchVins.includes(SHORKEY), `expected Shorkey in ${matchVins.join(",")}`);
    assert.ok(matchVins.includes(BATTLEFIELD), `expected Battlefield in ${matchVins.join(",")}`);
    assert.ok(!matchVins.includes(MALL_OF_GEORGIA), "Mall of Georgia has Ultimate but no keypad");
    assert.ok(!matchVins.includes(DECOY_23), "1FMUK 2.3 decoy must be prefix-excluded");
    assert.ok(result.matches.every((m) => m.distanceMiles != null && m.distanceMiles <= 500));

    const decoyDrop = result.dropped.find((d) => d.vin === DECOY_23);
    assert.equal(decoyDrop?.reason, "engine_prefix");
    const mallDrop = result.dropped.find((d) => d.vin === MALL_OF_GEORGIA);
    assert.equal(mallDrop?.reason, "missing_must_have");
    assert.ok(mallDrop?.missing?.includes("Keyless Entry Keypad"));

    const unreleased = result.dropped.filter((d) => d.reason === "unreleased");
    assert.ok(unreleased.length >= 2, "Lilliston + Larson placeholders must not count as matches");
  });

  it("ranks more nice-to-have overlap first, then lower price, then closer", () => {
    const a: FordMatchCard = {
      vin: "A",
      dealerName: "A",
      city: "X",
      state: "NJ",
      distanceMiles: 10,
      listingPrice: 50000,
      listingPriceSource: "listing",
      msrp: 60000,
      msrpSource: "sticker",
      dealerUrl: null,
      pdfUrl: "",
      matchedMustHaves: ["Ultimate Package"],
      matchedNiceToHaves: ["BlueCruise"],
      stickerStatus: "released",
    };
    const b: FordMatchCard = {
      ...a,
      vin: "B",
      dealerName: "B",
      distanceMiles: 5,
      listingPrice: 48000,
      matchedNiceToHaves: ["BlueCruise", "Spare"],
    };
    assert.deepEqual(
      rankFordMatches([a, b]).map((m) => m.vin),
      ["B", "A"]
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
  });
});
