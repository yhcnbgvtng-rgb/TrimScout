import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { displayTrim, isUnofficialTrim, officialTrimOptions, NO_TRIM } from "./fordTrimDisplay";

describe("displayTrim: Chevrolet / GMC / Toyota / Ram", () => {
  it("shows a dash for dealer sentences, even ones that contain a trim", () => {
    assert.equal(displayTrim("Chevrolet", "Silverado 1500", "Crew Cab Short Box"), NO_TRIM);
    assert.equal(displayTrim("Chevrolet", "Silverado 1500", "LT 2FL"), NO_TRIM);
    assert.equal(displayTrim("Ram", "1500", "BIG HORN CREW CAB 4X4 5'7 BOX"), NO_TRIM);
    assert.equal(displayTrim("Toyota", "Tacoma", "SR5 V6"), NO_TRIM);
    assert.equal(displayTrim("GMC", "Sierra 1500", "4WD Crew Cab Short"), NO_TRIM);
    assert.equal(displayTrim("Ram", "1500", "RAM"), NO_TRIM);
  });
  it("keeps official trims", () => {
    assert.equal(displayTrim("Chevrolet", "Silverado 1500", "LT Trail Boss"), "LT Trail Boss");
    assert.equal(displayTrim("Toyota", "RAV4 Hybrid", "XLE Premium"), "XLE Premium");
    assert.equal(displayTrim("Ram", "2500", "Power Wagon"), "Power Wagon");
    assert.equal(displayTrim("GMC", "Yukon XL", "Denali Ultimate"), "Denali Ultimate");
  });
  it("a spelling variant of an official trim shows the official spelling, not a dash", () => {
    assert.equal(displayTrim("Toyota", "Tacoma", "TRD Off Road"), "TRD Off-Road");
    assert.equal(displayTrim("Toyota", "Tacoma", "Trd_sport"), "TRD Sport");
  });
  it("leaves blanks, unprofiled models (EV, chassis) and other makes alone", () => {
    assert.equal(displayTrim("Chevrolet", "Silverado 1500", null), null);
    assert.equal(displayTrim("Chevrolet", "Silverado 1500", ""), "");
    assert.equal(displayTrim("Chevrolet", "Silverado EV", "Crew Cab Short Box"), "Crew Cab Short Box");
    assert.equal(displayTrim("Toyota", "Corolla", "Weird"), "Weird");
    assert.equal(displayTrim("Honda", "Civic", "8 FOOT BED"), "8 FOOT BED");
  });
  it("Ford behaves as before", () => {
    assert.equal(displayTrim("Ford", "F-150", "4X4 CREWCAB XLT"), NO_TRIM);
    assert.equal(displayTrim("Ford", "F-150", "XLT"), "XLT");
    assert.equal(isUnofficialTrim("Ford", "F-150", "8 FOOT BED"), true);
  });
});

describe("officialTrimOptions: Chevrolet / GMC / Toyota / Ram", () => {
  const opts = [{ value: "LT", n: 5 }, { value: "Crew Cab Short Box", n: 2 }, { value: "TRD Off Road", n: 3 }, { value: "RAM", n: 1 }];
  it("drops unofficial trims, keeps official ones and spelling variants", () => {
    assert.deepEqual(officialTrimOptions("Toyota", "Tacoma", opts).map((o) => o.value), ["TRD Off Road"]);
    assert.deepEqual(officialTrimOptions("Chevrolet", "Silverado 1500", opts).map((o) => o.value), ["LT"]);
  });
  it("changes nothing for an unprofiled model or an unset model", () => {
    assert.equal(officialTrimOptions("Chevrolet", "Silverado EV", opts).length, 4);
    assert.equal(officialTrimOptions("Chevrolet", "", opts).length, 4);
  });
});
