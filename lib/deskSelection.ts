/**
 * Step 3 desk selection ("Request a quote from this dealership" mode):
 * which desks are tickable, which are ticked, and whether Continue is live.
 *
 * Pure, so the dead-end that shipped (NJ buyer + Scott Chevrolet in PA as the
 * only desk → OUTSIDE NJ, checkbox disabled, Continue never enabling) has a
 * regression test instead of a screenshot. Rules:
 *
 * - A desk is selectable when the rooftop is known and hasn't opted out.
 *   With a named contact the request goes to them; without one it goes to
 *   the dealership's sales desk (its shared inbox, or the ops routing queue)
 *   — a known store is never a dead Continue.
 * - A sales adviser's own address the buyer typed (plausible, not a shared
 *   mailbox) stands in for a missing named contact and takes the request
 *   instead of the desk. For an opted-out dealership it is the ONLY way in:
 *   the desk becomes selectable with routing "adviser", and the request goes
 *   to the adviser alone — never to the dealership's own or opted-out
 *   address. With no adviser address an opted-out desk stays locked.
 * - Rows are keyed by `deskKey` (dealer id, else name + state), so two
 *   same-named rooftops in different states never share a tick or a row.
 * - The primary (listing) desk is never held back by the same-state gate.
 *   The gate only decides about the other dealerships in the package.
 * - A selectable desk starts ticked. The buyer's own tick/untick wins once
 *   they've touched it; until then the default holds, so the primary is
 *   checked the moment Step 3 renders, not after some later state settles.
 * - Continue needs at least one ticked, selectable, not-held desk.
 */
import { stateGatePlan, type StateGatePlan } from "./sameStateCheck";
import { isPlausibleDealerEmail } from "./dealerContactLookup";
import { isGenericMailbox } from "./quotePackage";

/** Stable per-rooftop key: the dealer id when the car carries one, else name + state. */
export function deskKey(d: { dealerName: string; state?: string | null; dealerId?: string | number | null }): string {
  const id = d.dealerId == null ? "" : String(d.dealerId).trim();
  if (id) return `id:${id}`;
  return `${d.dealerName.trim().toLowerCase()}|${(d.state || "").trim().toUpperCase()}`;
}

export interface SelectionDesk {
  dealerName: string;
  /** Row key (see deskKey); defaults to dealerName for callers with a single-state package. */
  key?: string;
  state: string | null | undefined;
  /** The /api/quote-desks answer, or undefined while it's still loading. */
  desk: { knownNamed: boolean; blockedReason: string | null; routing?: "named" | "rooftop_inbox" | "unassigned" } | undefined;
  /** A sales adviser's address the buyer typed for this dealership, if any. */
  buyerEmail?: string;
}

/** True when the typed address can stand in for a missing directory contact. */
export function adviserEmailStandsIn(desk: SelectionDesk["desk"], buyerEmail: string | undefined): boolean {
  if (!desk) return false;
  const optedOut = desk.blockedReason === "dealer_opted_out";
  // A named contact keeps the request, unless they opted out — then only the buyer's own adviser can take it.
  if (desk.knownNamed && !optedOut) return false;
  if (desk.blockedReason && desk.blockedReason !== "no_named_contact" && !optedOut) return false;
  const clean = (buyerEmail || "").trim();
  return isPlausibleDealerEmail(clean) && !isGenericMailbox(clean);
}

export interface DeskRowState {
  /** Has a named contact and isn't held by the gate — the checkbox is enabled. */
  selectable: boolean;
  checked: boolean;
  /** Held back by the same-state gate (never true for the primary desk). */
  heldByState: boolean;
  /** Primary desk outside the buyer's state, kept in because it lists the car. */
  keptOutOfState: boolean;
  /** The buyer supplied an adviser's address — the request goes there instead of the desk. */
  adviserAdded: boolean;
  /** Where the request goes for this row. */
  routing: "named" | "adviser" | "rooftop_inbox" | "unassigned";
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
  /** The primary desk's row key, when rows are keyed by deskKey; otherwise the name is compared. */
  primaryKey?: string | null;
  desks: SelectionDesk[];
  /** The buyer's explicit ticks; a missing key means "untouched → default". */
  confirmed: Record<string, boolean | undefined>;
}): DeskSelectionPlan {
  const primary = (args.primaryKey || args.primaryDealerName || "").trim();
  const idOf = (d: SelectionDesk) => d.key ?? d.dealerName;
  const optedOut = (d: SelectionDesk) => d.desk?.blockedReason === "dealer_opted_out";
  const adviserOf = (d: SelectionDesk) => adviserEmailStandsIn(d.desk, d.buyerEmail);
  // An opted-out desk is reachable only through the buyer's own adviser.
  const contactReady = (d: SelectionDesk) => Boolean(d.desk) && (!optedOut(d) || adviserOf(d));
  // The gate hands back the same objects it was given, so held/kept are matched by identity
  // and the real dealership name stays in the gate's own wording.
  const gateDesks = args.desks.map((d) => ({
    dealerName: d.dealerName,
    state: d.state,
    contactReady: contactReady(d),
    primary: Boolean(primary) && idOf(d) === primary,
  }));
  const gate = stateGatePlan(args.buyerState, gateDesks, args.sameStateOnly);
  const heldObjs = new Set(gate.active ? gate.excludedReady : []);
  const keptObjs = new Set(gate.active ? gate.primaryOutOfState : []);
  const held = new Set(args.desks.filter((_, i) => heldObjs.has(gateDesks[i])).map(idOf));
  const kept = new Set(args.desks.filter((_, i) => keptObjs.has(gateDesks[i])).map(idOf));

  const rows: Record<string, DeskRowState> = {};
  const sendTo: string[] = [];
  for (const d of args.desks) {
    const id = idOf(d);
    const heldByState = held.has(id);
    const adviserAdded = adviserOf(d);
    const hasContact = contactReady(d);
    const selectable = hasContact && !heldByState;
    const wanted = args.confirmed[id] ?? hasContact;
    const checked = selectable && wanted;
    const routing: DeskRowState["routing"] = adviserAdded ? "adviser" : d.desk?.knownNamed ? "named" : d.desk?.routing === "rooftop_inbox" ? "rooftop_inbox" : "unassigned";
    rows[id] = { selectable, checked, heldByState, keptOutOfState: kept.has(id), adviserAdded, routing };
    if (checked) sendTo.push(id);
  }
  return { gate, rows, sendTo, canContinue: sendTo.length > 0 };
}
