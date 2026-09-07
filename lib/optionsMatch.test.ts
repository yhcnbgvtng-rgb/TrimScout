import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOptionCatalog, matchVehicle, rankMatches } from "./optionsMatch";
import type { MatchableVehicle } from "./optionsProvider";
import type { Vehicle } from "./types";

function vehicle(id: string, optionCodes: [string, string][]): MatchableVehicle {
  const options = optionCodes.map(([code, name]) => ({ code, name, price: 1000 }));
  return {
    vehicle: {
      id,
      vin: id,
      year: 2026,
      make: "Porsche",
      model: "911",
      trim: "Carrera",
      bodyType: "Coupe",
      engine: "",
      drivetrain: "",
      transmission: "",
      exteriorColor: "",
      interiorColor: "",
      msrp: 100000,
      dealerPrice: 100000,
      daysOnLot: 1,
      status: "on_lot",
      location: { dealerName: "Test Dealer", city: "", state: "NJ", distanceMiles: 0 },
      packages: [],
      options: options.map((o) => ({ ...o, category: "package" as const })),
      imageUrl: "",
      mileage: 0,
    } satisfies Vehicle,
    options,
  };
}

describe("buildOptionCatalog", () => {
  it("de-dupes by code across vehicles, keeping the first name seen", () => {
    const catalog = buildOptionCatalog([
      vehicle("a", [["8LH", "Sport Chrono Package"]]),
      vehicle("b", [["8LH", "Sport Chrono (dup name)"], ["0P9", "Sport Exhaust System"]]),
    ]);
    assert.equal(catalog.length, 2);
    const chrono = catalog.find((c) => c.code === "8LH");
    assert.equal(chrono?.name, "Sport Chrono Package");
  });

  it("sorts alphabetically by name", () => {
    const catalog = buildOptionCatalog([vehicle("a", [["0P9", "Sport Exhaust System"], ["8LH", "Sport Chrono Package"]])]);
    assert.deepEqual(catalog.map((c) => c.name), ["Sport Chrono Package", "Sport Exhaust System"]);
  });
});

describe("matchVehicle", () => {
  it("is a full match only when every must-have code is confirmed present", () => {
    const v = vehicle("a", [["8LH", "Sport Chrono Package"], ["0P9", "Sport Exhaust System"]]);
    const result = matchVehicle(v, ["8LH", "0P9"], []);
    assert.equal(result.isFullMatch, true);
    assert.equal(result.mustHavesHit.length, 2);
    assert.equal(result.mustHavesMissed.length, 0);
  });

  it("never claims a full match when a must-have is missing", () => {
    const v = vehicle("a", [["8LH", "Sport Chrono Package"]]);
    const result = matchVehicle(v, ["8LH", "0P9"], []);
    assert.equal(result.isFullMatch, false);
    assert.equal(result.mustHavesHit.length, 1);
    assert.deepEqual(result.mustHavesMissed, [{ code: "0P9", name: "0P9" }]);
  });

  it("is never a full match with zero must-haves selected — nothing was actually checked", () => {
    const v = vehicle("a", []);
    const result = matchVehicle(v, [], []);
    assert.equal(result.isFullMatch, false);
  });

  it("resolves a missed must-have's real name from the inventory-wide catalog, not just its bare code", () => {
    const v = vehicle("a", [["8LH", "Sport Chrono Package"]]);
    const catalog = buildOptionCatalog([v, vehicle("b", [["KA6", "Surround View 3D"]])]);
    const result = matchVehicle(v, ["8LH", "KA6"], [], catalog);
    assert.deepEqual(result.mustHavesMissed, [{ code: "KA6", name: "Surround View 3D" }]);
  });

  it("tracks nice-to-haves separately and never lets them affect isFullMatch", () => {
    const v = vehicle("a", [["8LH", "Sport Chrono Package"]]);
    const result = matchVehicle(v, ["8LH"], ["9VL"]);
    assert.equal(result.isFullMatch, true);
    assert.equal(result.niceToHavesHit.length, 0);
  });
});

describe("rankMatches", () => {
  it("puts full matches before partial matches regardless of input order", () => {
    const partial = matchVehicle(vehicle("partial", [["8LH", "Sport Chrono Package"]]), ["8LH", "0P9"], []);
    const full = matchVehicle(vehicle("full", [["8LH", "x"], ["0P9", "y"]]), ["8LH", "0P9"], []);
    const ranked = rankMatches([partial, full]);
    assert.equal(ranked[0].vehicle.id, "full");
  });

  it("among partial matches, ranks more must-haves hit higher", () => {
    const oneHit = matchVehicle(vehicle("one", [["8LH", "x"]]), ["8LH", "0P9", "9VL"], []);
    const twoHit = matchVehicle(vehicle("two", [["8LH", "x"], ["0P9", "y"]]), ["8LH", "0P9", "9VL"], []);
    const ranked = rankMatches([oneHit, twoHit]);
    assert.equal(ranked[0].vehicle.id, "two");
  });
});
