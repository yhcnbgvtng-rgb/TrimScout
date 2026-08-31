import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseGmStickerText } from "./gmSticker";
import { autoFillCompetitionSlots } from "./fordCompetitionUi";
import {
  DEMO_GM_COMPARABLE_LISTINGS,
  findSimilarGmVehicles,
  gmMatchToVehicle,
} from "./vinSearch";

const FIXTURE_DIR = path.join(import.meta.dirname, "testdata", "gm-stickers");
const SUBJECT = "1GCUKDED9TZ134987";
const FLEMINGTON = "1GCUKDED8TZ200011";
const ALLENTOWN = "1GCUKDED2TZ200022";
const NO_SC = "1GCUKDED7TZ200033";
const UNRELEASED = "1GCUKDED1TZ200044";
const COLORADO = "1GCPYBEK4TZ300055";

function loadFixture(vin: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${vin}.txt`), "utf8");
}

describe("GM similar-lot hunt", () => {
  it("does not search until the user enters zip and radius", async () => {
    const subject = parseGmStickerText(SUBJECT, loadFixture(SUBJECT));
    const result = await findSimilarGmVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: ["Z71 Off-Road Package", "Super Cruise"],
      listings: DEMO_GM_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseGmStickerText(vin, loadFixture(vin)),
    });
    assert.equal(result.needsLocation, true);
    assert.equal(result.matches.length, 0);
  });

  it("keeps at most two radius-capped matches and never pads", async () => {
    const subject = parseGmStickerText(SUBJECT, loadFixture(SUBJECT));
    const tight = await findSimilarGmVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: [],
      zip: "07405",
      radiusMiles: 50,
      listings: DEMO_GM_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseGmStickerText(vin, loadFixture(vin)),
    });
    assert.equal(tight.matches.length, 1, "50 mi from 07405 is Flemington only — do not pad Allentown");
    assert.equal(tight.matches[0].vin, FLEMINGTON);
    const allentownDrop = tight.dropped.find((d) => d.vin === ALLENTOWN);
    assert.equal(allentownDrop?.reason, "outside_radius");
    assert.equal(autoFillCompetitionSlots(tight.matches)[1], null);

    const wide = await findSimilarGmVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: [],
      zip: "07405",
      radiusMiles: 100,
      listings: DEMO_GM_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseGmStickerText(vin, loadFixture(vin)),
    });
    assert.equal(wide.matches.length, 2);
    assert.equal(wide.matches[0].vin, FLEMINGTON, "nearest is Flemington");
    assert.equal(wide.matches[1].vin, ALLENTOWN, "second is Allentown");
    assert.ok(
      (wide.matches[0].distanceMiles ?? Infinity) <= (wide.matches[1].distanceMiles ?? Infinity)
    );
    assert.ok(wide.matches.every((m) => (m.distanceMiles ?? Infinity) <= 100));
    const [slot0, slot1] = autoFillCompetitionSlots(wide.matches);
    assert.equal(gmMatchToVehicle(slot0!).vin, FLEMINGTON);
    assert.equal(slot1?.vin, ALLENTOWN);
  });

  it("drops lots missing Super Cruise and never uses Colorado demo inventory", async () => {
    const subject = parseGmStickerText(SUBJECT, loadFixture(SUBJECT));
    const result = await findSimilarGmVehicles({
      subjectVin: SUBJECT,
      subject,
      mustHaveLines: ["Z71 Off-Road Package", "Multi-Flex Tailgate", "Super Cruise"],
      zip: "07405",
      radiusMiles: 100,
      listings: DEMO_GM_COMPARABLE_LISTINGS,
      fetchSticker: async (vin) => parseGmStickerText(vin, loadFixture(vin)),
    });
    const vins = result.matches.map((m) => m.vin);
    assert.ok(vins.includes(FLEMINGTON));
    assert.ok(vins.includes(ALLENTOWN));
    assert.equal(vins.includes(NO_SC), false);
    assert.equal(vins.includes(COLORADO), false);
    assert.equal(result.dropped.find((d) => d.vin === NO_SC)?.reason, "missing_must_have");
    assert.equal(result.dropped.find((d) => d.vin === UNRELEASED)?.reason, "unreleased");
    assert.ok(!result.dropped.some((d) => d.vin === COLORADO), "Colorado is model-filtered, not scored");
  });

  it("demo Silverado 07405+100 auto-fills Flemington then Allentown without a listings key", async () => {
    const prevA = process.env.AUTO_DEV_API_KEY;
    const prevM = process.env.MARKETCHECK_API_KEY;
    delete process.env.AUTO_DEV_API_KEY;
    delete process.env.MARKETCHECK_API_KEY;
    try {
      const subject = parseGmStickerText(SUBJECT, loadFixture(SUBJECT));
      const result = await findSimilarGmVehicles({
        subjectVin: SUBJECT,
        subject,
        mustHaveLines: [],
        zip: "07405",
        radiusMiles: 100,
      });
      assert.equal(result.provider, "demo");
      assert.equal(result.matches[0]?.vin, FLEMINGTON);
      assert.equal(result.matches[1]?.vin, ALLENTOWN);
      assert.match(result.matches[0].dealerName, /Flemington/i);
      assert.equal(result.matches[0].listingPrice, 57980);
      assert.equal(result.matches[1].listingPrice, null);
    } finally {
      if (prevA !== undefined) process.env.AUTO_DEV_API_KEY = prevA;
      else delete process.env.AUTO_DEV_API_KEY;
      if (prevM !== undefined) process.env.MARKETCHECK_API_KEY = prevM;
      else delete process.env.MARKETCHECK_API_KEY;
    }
  });
});
