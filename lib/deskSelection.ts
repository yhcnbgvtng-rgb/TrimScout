/**
 * Step 3 desk selection ("Request a quote from this dealership" mode):
 * which desks are tickable, which are ticked, and whether Continue is live.
 *
 * Pure, so the dead-end that shipped (NJ buyer + Scott Chevrolet in PA as the
 * only desk → OUTSIDE NJ, checkbox disabled, Continue never enabling) has a
 * regression test instead of a screenshot. Rules:
 *
 * - A desk is selectable only with a named, non-generic, not-opted-out
 *   contact (blockedReason null). Generic mailboxes never get a checkbox.
 * - The primary (listing) desk is never held back by the same-state gate.
 *   The gate only decides about the other dealerships in the package.
 * - A selectable desk starts ticked. The buyer's own tick/untick wins once
 *   they've touched it; until then the default holds, so the primary is
 *   checked the moment Step 3 renders, not after some later state settles.
 * - Continue needs at least one ticked, selectable, not-held desk.
 */
import { stateGatePlan, type StateGatePlan } from "./sameStateCheck";

export interface SelectionDesk {
  dealerName: string;
  state: string | null | undefined;
  /** The /api/quote-desks answer, or undefined while it's still loading. */
  desk: { knownNamed: boolean; blockedReason: string | null } | undefined;
}

export interface DeskRowState {
  /** Has a named contact and isn't held by the gate — the checkbox is enabled. */
  selectable: boolean;
  checked: boolean;
  /** Held back by the same-state gate (never true for the primary desk). */
  heldByState: boolean;
  /** Primary desk outside the buyer's state, kept in because it lists the car. */
  keptOutOfState: boolean;
}

export interface DeskSelectionPlan {
  gate: StateGatePlan;
  rows: Record<string, DeskRowState>;
  /** Desks the request would go to right now. */
  sendTo: string[];
  canContinue: boolean;
}

export function planDeskSelection(args: {
  buyerState: string | null | undefined;
  sameStateOnly: boolean;
  primaryDealerName: string | null | undefined;
  desks: SelectionDesk[];
  /** The buyer's explicit ticks; a missing key means "untouched → default". */
  confirmed: Record<string, boolean | undefined>;
}): DeskSelectionPlan {
  const primary = (args.primaryDealerName || "").trim();
  const contactReady = (d: SelectionDesk) => Boolean(d.desk?.knownNamed && !d.desk?.blockedReason);
  const gate = stateGatePlan(
    args.buyerState,
    args.desks.map((d) => ({
      dealerName: d.dealerName,
      state: d.state,
      contactReady: contactReady(d),
      primary: Boolean(primary) && d.dealerName === primary,
    })),
    args.sameStateOnly
  );
  const held = new Set(gate.active ? gate.excludedReady.map((d) => d.dealerName) : []);
  const kept = new Set(gate.active ? gate.primaryOutOfState.map((d) => d.dealerName) : []);

  const rows: Record<string, DeskRowState> = {};
  const sendTo: string[] = [];
  for (const d of args.desks) {
    const heldByState = held.has(d.dealerName);
    const hasContact = Boolean(d.desk && !d.desk.blockedReason);
    const selectable = hasContact && !heldByState;
    const wanted = args.confirmed[d.dealerName] ?? hasContact;
    const checked = selectable && wanted;
    rows[d.dealerName] = { selectable, checked, heldByState, keptOutOfState: kept.has(d.dealerName) };
    if (checked) sendTo.push(d.dealerName);
  }
  return { gate, rows, sendTo, canContinue: sendTo.length > 0 };
}
