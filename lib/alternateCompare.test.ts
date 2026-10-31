import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffLine, diffVsPrimary, leadingCode, mustHaveHeadline, mustHaveReport, normalizeTrim, sameTrim } from "./alternateCompare";
import type { Vehicle } from "./types";

const car = (o: Partial<Vehicle>): Vehicle =>
  ({
    vin: "X",
    year: 2026,
    make: "Ford",
    model: "Bronco",
    trim: "Badlands 4-Door",
    drivetrain: "4WD",
    exteriorColor: "Cactus Gray",
    buildConfidence: "verified_factory",
    packages: [],
    options: [],
    location: { dealerName: "", city: "", state: "", distanceMiles: 0 },
    ...o,
  }) as unknown as Vehicle;

const favorite = car({
  packages: ["Sasquatch Package", "Lux Package", "Modular Hardtop"],
  options: [
    { code: "17S", name: "Sasquatch Package", price: 0, category: "package" },
    { code: "53L", name: "Lux Package", price: 0, category: "package" },
    { code: "67H", name: "Modular Hardtop", price: 0, category: "standalone" },
    { code: "43V", name: "BlueCruise", price: 0, category: "standalone" },
  ],
});
const MUST = [
  { name: "Sasquatch Package", code: "17S" },
  { name: "Lux Package", code: "53L" },
  { name: "Modular Hardtop", code: "67H" },
  { name: "BlueCruise", code: "43V" },
];

describe("mustHaveReport — must-haves, not sticker similarity", () => {
  it("(4) scores hits against the buyer's picks and names the missing ones", () => {
    const alt = car({
      packages: ["Sasquatch Package", "Lux Package"],
      options: [
        { code: "17S", name: "Sasquatch Package", price: 0, category: "package" },
        { code: "53L", name: "Lux Package", price: 0, category: "package" },
        { code: "43V", name: "BlueCruise", price: 0, category: "standalone" },
        { code: "99Z", name: "Tow Hooks", price: 0, category: "standalone" },
      ],
    });
    const r = mustHaveReport(MUST, alt);
    assert.equal(r.kind, "scored");
    if (r.kind !== "scored") return;
    assert.deepEqual(r.present, ["Sasquatch Package", "Lux Package", "BlueCruise"]);
    assert.deepEqual(r.missing, ["Modular Hardtop"]);
    assert.equal(mustHaveHeadline(r), "3 of 4 must-haves");
    // Extra options on the alternate never inflate the score.
    assert.equal(r.total, 4);
  });

  it("(5) with one must-have selected, leads with the option's name, never a bare 100%", () => {
    const alt = car({ options: [{ code: "43V", name: "BlueCruise", price: 0, category: "standalone" }] });
    const r = mustHaveReport([{ name: "BlueCruise", code: "43V" }], alt);
    assert.equal(mustHaveHeadline(r), "Has: BlueCruise");
    const miss = mustHaveReport([{ name: "Modular Hardtop", code: "67H" }], alt);
    assert.equal(mustHaveHeadline(miss), "Missing: Modular Hardtop");
    assert.doesNotMatch(mustHaveHeadline(r), /100%|\d+%/);
  });

  it("matches by factory code even when the alternate spells the option differently", () => {
    const alt = car({ options: [{ code: "17S", name: "SASQUATCH PKG", price: 0, category: "package" }] });
    const r = mustHaveReport([{ name: "Sasquatch Package", code: "17S" }], alt);
    assert.equal(r.kind === "scored" && r.present[0], "Sasquatch Package");
  });

  it("reads a code off a formatted must-have line ('53L  Lux Package') and strips it from the label", () => {
    assert.equal(leadingCode("53L  Lux Package"), "53L");
    assert.equal(leadingCode("BlueCruise"), null);
    const alt = car({ options: [{ code: "53L", name: "Lux Package", price: 0, category: "package" }] });
    const r = mustHaveReport([{ name: "53L  Lux Package" }], alt);
    assert.equal(r.kind === "scored" && r.present[0], "Lux Package");
  });

  it("never scores 0 for a car it can't check — says the record is missing instead", () => {
    const alt = car({ buildConfidence: "dealer_listing_only", options: [], packages: [] });
    const r = mustHaveReport(MUST, alt);
    assert.equal(r.kind, "unverifiable");
    assert.match(mustHaveHeadline(r), /Not verified/);
  });

  it("says so when nothing was selected", () => {
    assert.equal(mustHaveHeadline(mustHaveReport([], favorite)), "No must-haves selected");
  });

  it("a near-miss name is missing, not a false yes", () => {
    const alt = car({ options: [{ code: "", name: "Sasquatch Off-Road Package", price: 0, category: "package" }] });
    const r = mustHaveReport([{ name: "Sasquatch Package" }], alt);
    assert.equal(r.kind === "scored" && r.missing[0], "Sasquatch Package");
  });
});

describe("diffVsPrimary — facts, not a second percentage", () => {
  it("(6) reports trim, color and the package deltas that matter, capped — not the whole sticker", () => {
    const alt = car({
      exteriorColor: "Oxford White",
      packages: ["Sasquatch Package", "Tow Package", "Bed Liner", "Floor Mats", "Cargo Net", "Splash Guards"],
    });
    const chips = diffVsPrimary(favorite, alt, [{ name: "Sasquatch Package" }]);
    const line = diffLine(chips);
    assert.match(line, /^Same Badlands 4-Door/);
    assert.match(line, /Oxford White \(favorite: Cactus Gray\)/);
    assert.match(line, /missing: Lux Package/);
    assert.match(line, /missing: Modular Hardtop/);
    assert.doesNotMatch(line, /Sasquatch/, "must-haves are scored above, not repeated here");
    // 5 extra packages → 2 shown + a count, never all of them.
    assert.equal(chips.filter((c) => c.kind === "extra").length, 3);
    assert.match(line, /\+3 more added/);
    assert.doesNotMatch(line, /Splash Guards/);
    assert.doesNotMatch(line, /\d+%/);
  });

  it("a different model is named once, with no package-by-package noise", () => {
    const alt = car({ model: "Explorer", trim: "Tremor", packages: ["Tow Package", "Twin Panel Moonroof"] });
    const chips = diffVsPrimary(favorite, alt);
    assert.equal(chips.length, 1);
    assert.equal(chips[0].text, "Different model: Ford Explorer Tremor (favorite: Ford Bronco Badlands 4-Door)");
  });

  it("names a different trim and drivetrain against the favorite", () => {
    const alt = car({ trim: "Outer Banks 4-Door", drivetrain: "AWD" });
    const line = diffLine(diffVsPrimary(favorite, alt));
    assert.match(line, /Outer Banks 4-Door \(favorite: Badlands 4-Door\)/);
    assert.match(line, /AWD \(favorite: 4WD\)/);
  });

  it("treats 4X4 / 4WD and AWD / All-Wheel Drive as the same drivetrain", () => {
    assert.equal(diffLine(diffVsPrimary(car({ drivetrain: "4X4" }), car({ drivetrain: "4WD" }))), "Same Badlands 4-Door");
    assert.equal(diffLine(diffVsPrimary(car({ drivetrain: "AWD" }), car({ drivetrain: "AWD/All-Wheel Drive" }))), "Same Badlands 4-Door");
    assert.match(diffLine(diffVsPrimary(car({ drivetrain: "4X4" }), car({ drivetrain: "RWD" }))), /RWD \(favorite: 4X4\)/);
  });

  it("skips package deltas when either car has no factory record", () => {
    const alt = car({ buildConfidence: "dealer_listing_only", packages: [], options: [], exteriorColor: "Oxford White" });
    const chips = diffVsPrimary(favorite, alt);
    assert.deepEqual(chips.map((c) => c.kind), ["same", "different"]);
  });
});

// ---------------------------------------------------------------------------
// Wizard wiring (source-level, same style as the other copy tests).
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";

describe("wizard wiring — same-state gate + alternate comparison", () => {
  const wizard = fs.readFileSync(path.join(process.cwd(), "components/BiddingWizard.tsx"), "utf8");

  it("(1) there is no same-state restriction — no checkbox, no expand nudge; the gate constant is off", () => {
    assert.match(wizard, /const sameStateOnly = false;/);
    assert.doesNotMatch(wizard, /Only send this to dealerships in my state|setSameStateOnly|formatExpandNudge|Include dealerships in other states|Uncheck to include dealerships/);
  });

  it("(3) the send path and the confirmed count both go through the desk plan", () => {
    assert.match(wizard, /toSend = pastes\.filter\([\s\S]*?deskPlan\.rows\[pasteDeskKey\(p\)\]\?\.checked/);
    assert.match(wizard, /confirmedDeskCount = deskPlan\.sendTo\.length/);
  });

  it("the primary (listing) desk is flagged to the plan and stays tickable", () => {
    assert.match(wizard, /planDeskSelection\(\{[\s\S]*?primaryDealerName,[\s\S]*?confirmed: confirmedDesks/);
    assert.match(wizard, /checked=\{Boolean\(row\?\.checked\)\}/);
    assert.match(wizard, /disabled=\{!row\?\.selectable\}/);
  });

  it("overnight QA pack: VIN-only CTA and degraded-directory retry are wired; a missing sticker shows no warning and no retry", () => {
    assert.match(wizard, /No dealership attached yet/);
    assert.match(wizard, /Paste the dealership&apos;s listing link to attach the store/);
    assert.match(wizard, /Couldn&apos;t check the dealer directory just now/);
    assert.match(wizard, /onRetry=\{retryPendingLink\}/);
    assert.doesNotMatch(wizard, /ask the manufacturer again|retryPrimarySticker|Unconfirmed build|temporarily unavailable|dealer listing only/i);
    // The build-sheet link still shows when the record is real.
    assert.match(wizard, /\{fordPdfUrl && \(/);
    assert.match(wizard, /"Factory verified"/);
  });

  it("(4) alternate cards lead with the must-have report and diff, never a sticker similarity %; an unscorable report is simply not shown", () => {
    assert.match(wizard, /const report = fullReport && fullReport\.kind === "scored" \? fullReport : null;/);
    assert.match(wizard, /mustHaveHeadline\(report\)/);
    assert.match(wizard, /diffVsPrimary\(primary, vehicle, mustHaves/);
    assert.doesNotMatch(wizard, /similarity|stickerMatchPercent|matchPercent/i);
  });

  it("(7) no advertised price surfaces on the cards or the package", () => {
    assert.doesNotMatch(wizard, /advertisedOrStickerPrice|shopperPriceSourceLabel|Advertised price/);
  });
});

describe("mustHaveReport — color and engine read the car's own fields", () => {
  const VINS = ["1FTEW1K52TKF58640", "1FTEW1K8XTKE03988", "1FTEW1LP2TKE57971"];
  const f150 = (vin: string, o: Partial<Vehicle> = {}) =>
    car({
      vin,
      model: "F-150",
      trim: "XL",
      exteriorColor: "OXFORD WHITE",
      engine: "5.0L V8",
      transmission: "10-Speed Automatic",
      options: [{ code: "99Z", name: "Tow Hooks", price: 0, category: "standalone" }],
      ...o,
    });

  for (const vin of VINS) {
    it(`${vin}: Exterior color OXFORD WHITE is present from the color field`, () => {
      const r = mustHaveReport([{ name: "Exterior color: OXFORD WHITE" }], f150(vin));
      assert.equal(r.kind === "scored" && r.present[0], "Exterior color: OXFORD WHITE");
      assert.equal(r.kind === "scored" && r.missing.length, 0);
    });
  }

  it("ignores Metallic / Pearl / Tri-coat suffixes, case-insensitively", () => {
    const r = mustHaveReport(
      [{ name: "Exterior color: Ruby Red Metallic Tinted Clearcoat" }, { name: "Exterior color: Wind Chill Pearl" }],
      f150(VINS[0], { exteriorColor: "ruby red" }),
    );
    assert.equal(r.kind === "scored" && r.present.length, 1);
    const t = mustHaveReport([{ name: "Exterior color: Wind Chill Pearl" }], f150("TOY", { make: "Toyota", exteriorColor: "WIND CHILL" }));
    assert.equal(t.kind === "scored" && t.present.length, 1);
  });

  it("a different color is Missing; a blank color is Unknown, not Missing", () => {
    const other = mustHaveReport([{ name: "Exterior color: Race Red" }], f150(VINS[0]));
    assert.equal(other.kind === "scored" && other.missing[0], "Exterior color: Race Red");
    const blank = mustHaveReport([{ name: "Exterior color: OXFORD WHITE" }], f150(VINS[0], { exteriorColor: "" }));
    assert.equal(blank.kind === "scored" && blank.missing.length, 0);
    assert.equal(blank.kind === "scored" && blank.unknown.length, 1);
    assert.equal(mustHaveHeadline(blank), "Unknown: Exterior color: OXFORD WHITE");
  });

  it("a 5.0L V8 must-have is met by the engine field even with no option row", () => {
    const r = mustHaveReport([{ name: "5.0L V8 Engine" }], f150(VINS[1]));
    assert.equal(r.kind === "scored" && r.present.length, 1);
    const wrong = mustHaveReport([{ name: "3.5L V6 EcoBoost Engine" }], f150(VINS[1]));
    assert.equal(wrong.kind === "scored" && wrong.missing.length, 1);
    const blank = mustHaveReport([{ name: "5.0L V8 Engine" }], f150(VINS[1], { engine: "", transmission: "" }));
    assert.equal(blank.kind === "scored" && blank.unknown.length, 1);
  });
});

describe("sameTrim — the same trim spelled two ways (2026-10-29)", () => {
  it("'Trail Boss - LT' and 'LT Trail Boss' are one trim", () => {
    assert.equal(sameTrim("Trail Boss - LT", "LT Trail Boss"), true);
    assert.equal(normalizeTrim("Trail Boss - LT"), normalizeTrim("LT Trail Boss"));
    assert.equal(sameTrim("high country", "High-Country"), true);
  });
  it("a real difference still counts: LT is not LTZ, and a trim is not the bare model", () => {
    assert.equal(sameTrim("LT", "LTZ"), false);
    assert.equal(sameTrim("LT Trail Boss", "LTZ Trail Boss"), false);
    assert.equal(sameTrim("LT Trail Boss", "LT"), false);
    assert.equal(sameTrim("Trail Boss - LT", "Z71 - LT"), false);
  });
  it("the diff keeps each card's own spelling and calls the pair the same, but flags LT vs LTZ", () => {
    const silverado = (trim: string) => car({ make: "Chevrolet", model: "Silverado 1500", trim });
    assert.equal(diffLine(diffVsPrimary(silverado("Trail Boss - LT"), silverado("LT Trail Boss"))), "Same LT Trail Boss");
    assert.equal(diffLine(diffVsPrimary(silverado("LT"), silverado("LTZ"))), "LTZ (favorite: LT)");
  });
});
