/**
 * Same-state gate: does the buyer's "keep results within my state" choice
 * conflict with the vehicles they actually imported?
 *
 * This matters because /api/dealer-requests applies sameStateOnly to *every*
 * dealer on a reverse-auction request, including the rooftop that physically
 * holds the imported car. A buyer who pastes an out-of-state listing and leaves
 * the box checked would silently hide their request from the one dealer who has
 * the vehicle. The warning built on this catches that before it's submitted.
 *
 * Pure types + logic only, so both the wizard and tests can use it.
 */

/**
 * getZipCoordinates falls back to this sentinel for any ZIP prefix it can't map
 * to a real state. It is not a state, so it can never be compared against a
 * dealer's real state code — treat it as "unknown" instead.
 */
export const UNRESOLVED_STATE = "USA";

/** True only for a real two-letter US state code, not the unknown sentinel. */
export function isResolvedState(state: string | null | undefined): boolean {
  const clean = (state || "").trim().toUpperCase();
  return clean.length === 2 && clean !== UNRESOLVED_STATE;
}

export interface SameStateVehicle {
  vin: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  location?: { dealerName?: string; state?: string } | null;
}

export interface OutOfStateVehicle {
  vin: string;
  label: string;
  dealerName: string;
  state: string;
}

/**
 * The imported vehicles sitting at a dealer outside the buyer's state.
 *
 * Returns nothing when the buyer's own state is unknown — an unmappable ZIP
 * must not produce a mismatch warning against every dealer in the country.
 * Vehicles whose dealer state is unknown are skipped for the same reason: we
 * only warn about a conflict we can actually prove.
 */
export function outOfStateVehicles(
  buyerState: string | null | undefined,
  vehicles: Array<SameStateVehicle | null | undefined>
): OutOfStateVehicle[] {
  if (!isResolvedState(buyerState)) return [];
  const buyer = (buyerState || "").trim().toUpperCase();

  const seen = new Set<string>();
  const out: OutOfStateVehicle[] = [];
  for (const vehicle of vehicles) {
    if (!vehicle) continue;
    const state = (vehicle.location?.state || "").trim().toUpperCase();
    if (!isResolvedState(state) || state === buyer) continue;
    if (seen.has(vehicle.vin)) continue;
    seen.add(vehicle.vin);
    out.push({
      vin: vehicle.vin,
      label: [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
        .filter(Boolean)
        .join(" "),
      dealerName: (vehicle.location?.dealerName || "").trim(),
      state,
    });
  }
  return out;
}

/**
 * The warning shown when same-state is on but imported cars sit elsewhere.
 * Names the states so the buyer can see exactly what would be excluded.
 */
export function formatOutOfStateWarning(
  buyerState: string,
  outOfState: OutOfStateVehicle[]
): string {
  if (outOfState.length === 0) return "";
  const states = [...new Set(outOfState.map((v) => v.state))].sort();
  const statesLabel =
    states.length === 1
      ? states[0]
      : `${states.slice(0, -1).join(", ")} and ${states[states.length - 1]}`;
  const subject =
    outOfState.length === 1
      ? "The car you added is"
      : `${outOfState.length} of the cars you added are`;
  return (
    `${subject} at a dealership in ${statesLabel}, not ${buyerState.toUpperCase()}. ` +
    `While "Only send this to dealerships in my state" is checked, those dealers ` +
    `won't see this request. Uncheck it to include them.`
  );
}

/**
 * The server-side half of the same-state gate: should this dealer be excluded
 * from a reverse-auction request because they're outside the buyer's state?
 *
 * Only a *provable* mismatch excludes. If the buyer's ZIP didn't map to a real
 * state (getZipCoordinates hands back UNRESOLVED_STATE for every prefix outside
 * its range table — Ohio, the Carolinas, Tennessee, Minnesota and many more),
 * or the dealer has no state on file, there is nothing to compare and the gate
 * has to stand down. Comparing the sentinel instead would match no dealer at
 * all, silently hiding the request from every rooftop in the country while the
 * buyer sees an empty bid list and no explanation.
 *
 * Mirrors outOfStateVehicles' "never guess" rule so the wizard's warning and
 * the dealer feed can't disagree about who is in range.
 */
export function sameStateGateExcludes(
  buyerState: string | null | undefined,
  dealerState: string | null | undefined
): boolean {
  if (!isResolvedState(buyerState) || !isResolvedState(dealerState)) return false;
  return (buyerState || "").trim().toUpperCase() !== (dealerState || "").trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// The quote-package gate. "Only send this to dealerships in my state" decides
// which of the package's desks receive the request — nothing else. It never
// dead-ends: when it would leave the package short, the plan says so and
// names the states that would fill it, so the UI can offer to expand.
// ---------------------------------------------------------------------------

export interface GateDesk {
  dealerName: string;
  state: string | null | undefined;
  /** A named, non-generic, not-opted-out contact — the only kind that can receive a quote request. */
  contactReady: boolean;
}

export interface StateGatePlan {
  /** Whether the gate is actually deciding anything (on, and the buyer's state is known). */
  active: boolean;
  buyerState: string | null;
  inStateReady: GateDesk[];
  /** Ready desks the gate is holding back. */
  excludedReady: GateDesk[];
  /** States of the held-back ready desks, sorted. */
  excludedStates: string[];
  /** True when the in-state ready desks can't fill the package and some held-back desk could. */
  shouldOfferExpand: boolean;
  /** True when nothing in-state can receive the request at all. */
  emptyInState: boolean;
}

export function stateGatePlan(
  buyerState: string | null | undefined,
  desks: GateDesk[],
  sameStateOnly: boolean,
  packageSize = 3
): StateGatePlan {
  const ready = desks.filter((d) => d.contactReady);
  const active = sameStateOnly && isResolvedState(buyerState);
  const buyer = active ? (buyerState || "").trim().toUpperCase() : null;
  if (!active) {
    return { active: false, buyerState: null, inStateReady: ready, excludedReady: [], excludedStates: [], shouldOfferExpand: false, emptyInState: ready.length === 0 };
  }
  const inStateReady = ready.filter((d) => !sameStateGateExcludes(buyer, d.state));
  const excludedReady = ready.filter((d) => sameStateGateExcludes(buyer, d.state));
  const excludedStates = [...new Set(excludedReady.map((d) => (d.state || "").trim().toUpperCase()))].sort();
  const want = Math.min(packageSize, ready.length);
  return {
    active: true,
    buyerState: buyer,
    inStateReady,
    excludedReady,
    excludedStates,
    shouldOfferExpand: excludedReady.length > 0 && inStateReady.length < want,
    emptyInState: inStateReady.length === 0,
  };
}

export function formatExpandNudge(plan: StateGatePlan): string {
  if (!plan.shouldOfferExpand) return "";
  const n = plan.excludedReady.length;
  const states = plan.excludedStates;
  const where = states.length === 1 ? states[0] : `${states.slice(0, -1).join(", ")} and ${states[states.length - 1]}`;
  const have = plan.inStateReady.length;
  const lead = have === 0 ? `None of your dealerships with a sales contact are in ${plan.buyerState}.` : `Only ${have} of your dealerships with a sales contact ${have === 1 ? "is" : "are"} in ${plan.buyerState}.`;
  return `${lead} ${n} more ${n === 1 ? "is" : "are"} in ${where}. Include dealerships in other states to send to ${n === 1 ? "it" : "them"} too.`;
}
