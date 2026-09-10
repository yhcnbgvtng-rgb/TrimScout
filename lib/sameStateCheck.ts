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
    `While "Keep results within my state" is on, those dealers won't see this request. ` +
    `Uncheck it to include them.`
  );
}
