import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UNRESOLVED_STATE,
  isResolvedState,
  outOfStateVehicles,
  formatOutOfStateWarning,
  type SameStateVehicle,
} from "./sameStateCheck";

function vehicle(
  vin: string,
  state: string,
  dealerName = "Somewhere Ford"
): SameStateVehicle {
  return {
    vin,
    year: 2026,
    make: "Ford",
    model: "Explorer",
    trim: "ST",
    location: { dealerName, state },
  };
}

describe("isResolvedState", () => {
  it("accepts a real two-letter code and rejects the unknown sentinel", () => {
    assert.equal(isResolvedState("NJ"), true);
    assert.equal(isResolvedState("nj"), true);
    assert.equal(isResolvedState(UNRESOLVED_STATE), false);
    assert.equal(isResolvedState(""), false);
    assert.equal(isResolvedState(null), false);
    assert.equal(isResolvedState(undefined), false);
    assert.equal(isResolvedState("New Jersey"), false);
  });
});

describe("outOfStateVehicles", () => {
  it("flags a vehicle whose dealer sits outside the buyer's state", () => {
    const out = outOfStateVehicles("NJ", [vehicle("VIN1", "PA", "Keystone Ford")]);
    assert.equal(out.length, 1);
    assert.equal(out[0].vin, "VIN1");
    assert.equal(out[0].state, "PA");
    assert.equal(out[0].dealerName, "Keystone Ford");
    assert.equal(out[0].label, "2026 Ford Explorer ST");
  });

  it("says nothing when every dealer is in the buyer's state", () => {
    const out = outOfStateVehicles("NJ", [vehicle("VIN1", "NJ"), vehicle("VIN2", "nj")]);
    assert.deepEqual(out, []);
  });

  it("never warns when the buyer's own ZIP could not be mapped to a state", () => {
    // getZipCoordinates returns "USA" for unmapped prefixes; comparing that
    // against real dealer states would flag every deal in those regions.
    assert.deepEqual(outOfStateVehicles(UNRESOLVED_STATE, [vehicle("VIN1", "PA")]), []);
    assert.deepEqual(outOfStateVehicles("", [vehicle("VIN1", "PA")]), []);
    assert.deepEqual(outOfStateVehicles(null, [vehicle("VIN1", "PA")]), []);
  });

  it("skips vehicles whose dealer state is unknown rather than guessing", () => {
    const out = outOfStateVehicles("NJ", [
      vehicle("VIN1", ""),
      vehicle("VIN2", UNRESOLVED_STATE),
      { vin: "VIN3", year: 2026, make: "Ford", model: "Bronco", location: null },
    ]);
    assert.deepEqual(out, []);
  });

  it("ignores empty alternate slots and de-duplicates a repeated VIN", () => {
    const out = outOfStateVehicles("NJ", [
      vehicle("VIN1", "PA"),
      null,
      undefined,
      vehicle("VIN1", "PA"),
    ]);
    assert.equal(out.length, 1);
  });
});

describe("formatOutOfStateWarning", () => {
  it("is empty when there is nothing to warn about", () => {
    assert.equal(formatOutOfStateWarning("NJ", []), "");
  });

  it("names the single out-of-state dealer's state and how to proceed", () => {
    const msg = formatOutOfStateWarning("NJ", [
      { vin: "VIN1", label: "2026 Ford Explorer ST", dealerName: "Keystone Ford", state: "PA" },
    ]);
    assert.match(msg, /The car you added is at a dealership in PA, not NJ/);
    assert.match(msg, /won't see this request/);
    assert.match(msg, /Uncheck it to include them/);
  });

  it("counts and lists multiple states", () => {
    const msg = formatOutOfStateWarning("NJ", [
      { vin: "VIN1", label: "a", dealerName: "A", state: "PA" },
      { vin: "VIN2", label: "b", dealerName: "B", state: "NY" },
    ]);
    assert.match(msg, /2 of the cars you added are at a dealership in NY and PA/);
  });
});
