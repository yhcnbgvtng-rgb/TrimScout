import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffLine, diffVsPrimary, leadingCode, mustHaveHeadline, mustHaveReport } from "./alternateCompare";
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
    assert.match(mustHaveHeadline(r), /Can't check/);
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

  it("(1) the same-state box defaults ON and keeps its radius subtext", () => {
    assert.match(wizard, /const \[sameStateOnly, setSameStateOnly\] = useState<boolean>\(true\)/);
    assert.match(wizard, /Uncheck to include dealerships in other states within the radius/);
  });

  it("(3) the send path and the confirmed count both honor the gate, and the nudge unchecks it", () => {
    assert.match(wizard, /toSend = pastes\.filter\([\s\S]*?!excludedByState\.has\(p\.dealerName\)/);
    assert.match(wizard, /confirmedDeskCount = importedDealerships\.filter\([\s\S]*?!excludedByState\.has\(d\.dealerName\)/);
    assert.match(wizard, /formatExpandNudge\(gatePlan\)/);
    assert.match(wizard, /onClick=\{\(\) => setSameStateOnly\(false\)\}/);
    assert.match(wizard, /Include dealerships in other states/);
  });

  it("(4) alternate cards lead with the must-have report and diff, never a sticker similarity %", () => {
    assert.match(wizard, /mustHaveHeadline\(report\)/);
    assert.match(wizard, /diffVsPrimary\(primary, vehicle, mustHaves/);
    assert.doesNotMatch(wizard, /similarity|stickerMatchPercent|matchPercent/i);
  });

  it("(7) no advertised price surfaces on the cards or the package", () => {
    assert.doesNotMatch(wizard, /advertisedOrStickerPrice|shopperPriceSourceLabel|Advertised price/);
  });
});
