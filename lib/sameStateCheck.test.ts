import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UNRESOLVED_STATE,
  isResolvedState,
  outOfStateVehicles,
  formatOutOfStateWarning,
  sameStateGateExcludes,
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
    assert.match(msg, /Only send this to dealerships in my state/);
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

describe("sameStateGateExcludes", () => {
  it("excludes a dealer whose state differs from the buyer's", () => {
    assert.equal(sameStateGateExcludes("NJ", "PA"), true);
  });

  it("keeps a dealer in the buyer's own state, whatever the casing", () => {
    assert.equal(sameStateGateExcludes("NJ", "NJ"), false);
    assert.equal(sameStateGateExcludes("nj", "NJ"), false);
    assert.equal(sameStateGateExcludes("NJ", " nj "), false);
  });

  it("stands down entirely when the buyer's ZIP mapped to no state", () => {
    // The bug this guards: a buyer in Ohio, the Carolinas, Tennessee or any
    // other region outside getZipCoordinates' range table used to carry the
    // "USA" sentinel. A raw !== comparison matched no dealer anywhere, so
    // their reverse-auction request reached zero rooftops with no explanation.
    assert.equal(sameStateGateExcludes(UNRESOLVED_STATE, "OH"), false);
    assert.equal(sameStateGateExcludes("", "OH"), false);
    assert.equal(sameStateGateExcludes(null, "OH"), false);
    assert.equal(sameStateGateExcludes(undefined, "OH"), false);
  });

  it("stands down when the dealer has no state on file", () => {
    assert.equal(sameStateGateExcludes("NJ", ""), false);
    assert.equal(sameStateGateExcludes("NJ", null), false);
    assert.equal(sameStateGateExcludes("NJ", UNRESOLVED_STATE), false);
  });

  it("agrees with outOfStateVehicles on the same buyer/dealer pair", () => {
    // The wizard warns with one and the dealer feed filters with the other;
    // if they ever disagreed, a buyer would be warned about an exclusion that
    // didn't happen, or excluded with no warning at all.
    for (const [buyer, dealer] of [
      ["NJ", "PA"],
      ["NJ", "NJ"],
      [UNRESOLVED_STATE, "PA"],
      ["NJ", UNRESOLVED_STATE],
      ["", "PA"],
    ] as const) {
      const warned = outOfStateVehicles(buyer, [vehicle("VIN1", dealer)]).length > 0;
      assert.equal(sameStateGateExcludes(buyer, dealer), warned, `${buyer} vs ${dealer}`);
    }
  });
});

// ---------------------------------------------------------------------------
// The quote-package gate (v1): keep the package in-state when it can be, and
// offer to expand — never dead-end — when it can't.
// ---------------------------------------------------------------------------
import { formatExpandNudge, stateGatePlan } from "./sameStateCheck";

const desk = (dealerName: string, state: string, contactReady = true) => ({ dealerName, state, contactReady });

describe("stateGatePlan", () => {
  it("(2) with enough in-state contact-ready desks the package stays in-state and no nudge appears", () => {
    const plan = stateGatePlan("NJ", [desk("Freedom Ford", "NJ"), desk("Route 23 Ford", "NJ"), desk("Paul Miller BMW", "NJ")], true);
    assert.equal(plan.active, true);
    assert.equal(plan.inStateReady.length, 3);
    assert.equal(plan.shouldOfferExpand, false);
    assert.equal(formatExpandNudge(plan), "");
  });

  it("(3) with too few in-state ready desks it offers to expand, naming the states — never an empty package", () => {
    const plan = stateGatePlan("NJ", [desk("Freedom Ford", "NJ"), desk("Koons Ford", "MD"), desk("Cochran Ford", "PA")], true);
    assert.equal(plan.inStateReady.length, 1);
    assert.equal(plan.excludedReady.length, 2);
    assert.deepEqual(plan.excludedStates, ["MD", "PA"]);
    assert.equal(plan.shouldOfferExpand, true);
    assert.equal(plan.emptyInState, false);
    assert.match(formatExpandNudge(plan), /Only 1 of your dealerships .* in NJ\. 2 more are in MD and PA\./);
  });

  it("with nothing in-state it says none, and still offers the expand", () => {
    const plan = stateGatePlan("NJ", [desk("Koons Ford", "MD")], true);
    assert.equal(plan.emptyInState, true);
    assert.equal(plan.shouldOfferExpand, true);
    assert.match(formatExpandNudge(plan), /^None of your dealerships/);
  });

  it("desks without a contact never count either way — the contact_ready rule holds", () => {
    const plan = stateGatePlan("NJ", [desk("No Contact NJ", "NJ", false), desk("Koons Ford", "MD")], true);
    assert.equal(plan.inStateReady.length, 0);
    assert.equal(plan.excludedReady.length, 1);
    assert.equal(plan.shouldOfferExpand, true);
  });

  it("stands down (no exclusions) when the box is unchecked or the buyer's state is unknown", () => {
    const desks = [desk("Freedom Ford", "NJ"), desk("Koons Ford", "MD")];
    for (const plan of [stateGatePlan("NJ", desks, false), stateGatePlan("USA", desks, true), stateGatePlan(null, desks, true)]) {
      assert.equal(plan.active, false);
      assert.equal(plan.inStateReady.length, 2);
      assert.equal(plan.shouldOfferExpand, false);
    }
  });

  it("a desk with an unknown state is kept, not excluded on a guess", () => {
    const plan = stateGatePlan("NJ", [desk("Mystery Motors", ""), desk("Freedom Ford", "NJ")], true);
    assert.equal(plan.inStateReady.length, 2);
  });

  // The live dead-end: NJ buyer, Scott Chevrolet (Allentown, PA) is the only
  // desk. The gate held the one rooftop that lists the car, so the row read
  // OUTSIDE NJ, couldn't be ticked, and Continue never enabled.
  it("never holds back the primary (listing) desk — alone it needs no expand click", () => {
    const plan = stateGatePlan("NJ", [{ ...desk("Scott Chevrolet", "PA"), primary: true }], true);
    assert.equal(plan.active, true);
    assert.deepEqual(plan.excludedReady, []);
    assert.equal(plan.primaryOutOfState.length, 1);
    assert.equal(plan.shouldOfferExpand, false);
    assert.equal(formatExpandNudge(plan), "");
  });

  it("gates the other out-of-state desks but not the primary, and the nudge says the listing dealer stays in", () => {
    const plan = stateGatePlan("NJ", [{ ...desk("Scott Chevrolet", "PA"), primary: true }, desk("Koons Chevrolet", "MD"), desk("Malouf Chevrolet", "NJ")], true);
    assert.deepEqual(plan.excludedReady.map((d) => d.dealerName), ["Koons Chevrolet"]);
    assert.deepEqual(plan.primaryOutOfState.map((d) => d.dealerName), ["Scott Chevrolet"]);
    assert.equal(plan.inStateReady.length, 1);
    assert.equal(plan.shouldOfferExpand, true);
    const nudge = formatExpandNudge(plan);
    assert.match(nudge, /Scott Chevrolet \(PA\) lists your car, so it stays in\./);
    assert.match(nudge, /1 more is in MD/);
  });

  it("a primary desk without a named contact still can't receive anything — the contact_ready rule wins", () => {
    const plan = stateGatePlan("NJ", [{ ...desk("Scott Chevrolet", "PA", false), primary: true }], true);
    assert.equal(plan.primaryOutOfState.length, 0);
    assert.equal(plan.emptyInState, true);
  });
});
