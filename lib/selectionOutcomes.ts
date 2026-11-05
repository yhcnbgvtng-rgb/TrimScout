/**
 * Every vehicle a buyer selects for a quote request ends in exactly one durable outcome:
 *
 *   invited   — a dealer invitation was created (or an existing one reused) for it
 *   excluded  — no invitation, with a stable reason code and a buyer-facing sentence
 *
 * Nothing here does I/O. The submit orchestration (lib/selectionInvites.ts) produces outcomes, the box stores them
 * (rfq_requests.selection_outcomes_json), and the tracker, the buyer's results panel and the admin diagnostic all
 * read them through `vehicleRows`, so the screens cannot disagree.
 *
 * Honesty rules:
 *  - queued, sent, opened and quoted are different things and are counted separately;
 *  - a request saved before outcomes were recorded shows "Reason unavailable" — never a guessed reason;
 *  - outcomes carry no email address, token or raw error text. Buyer-visible text comes from the fixed table below.
 */
import type { RfqInvite, RfqQuote, RfqRequest } from "./rfq";
import { inviteStage, INVITE_BLOCK_MESSAGES, type QuoteInviteStage } from "./quotePackage";
import { rfqVehicles, type RfqPasteVehicle } from "./rfqTracker";

export type SelectionReasonCode =
  | "dealer_unchecked"            // the buyer unticked this dealership
  | "ineligible_vehicle"          // the listing never resolved to a dealership, so there is no one to invite
  | "dealer_opted_out"            // the dealership asked us to stop emailing
  | "sister_store"                // another selected dealership shares the dealer group's domain
  | "desk_already_invited"        // that desk already holds an open request (this one or another)
  | "same_dealer_other_vehicle"   // an invitation to this dealership already covers a different selected vehicle
  | "invite_limit_reached"        // the request already holds the maximum number of invitations
  | "dealer_daily_cap"            // the dealership hit its per-day request cap
  | "invite_creation_failed"      // the invitation could not be created (service error) — nothing was sent
  | "not_attempted"               // the submission ended before this vehicle was handled
  | "reason_unavailable";         // saved before outcomes were recorded: we do not guess

export const SELECTION_REASON_MESSAGES: Record<SelectionReasonCode, string> = {
  dealer_unchecked: "You unticked this dealership, so it doesn't get an invitation. Tick it to include this vehicle.",
  ineligible_vehicle: INVITE_BLOCK_MESSAGES.no_rooftop,
  dealer_opted_out: INVITE_BLOCK_MESSAGES.dealer_opted_out,
  sister_store: INVITE_BLOCK_MESSAGES.sister_store,
  desk_already_invited: INVITE_BLOCK_MESSAGES.desk_already_invited,
  same_dealer_other_vehicle: "This dealership already has an invitation for another vehicle in this request. A dealership gets one invitation per request, so this car isn't invited separately.",
  invite_limit_reached: "This request already holds the maximum number of dealer invitations.",
  dealer_daily_cap: "This dealership has reached the number of requests it can receive today. Try again tomorrow.",
  invite_creation_failed: "We couldn't create the invitation for this vehicle because of a service error. Nothing was sent to the dealership.",
  not_attempted: "The submission ended before this vehicle was handled, so no invitation was created.",
  reason_unavailable: "Reason unavailable",
};

/** Reasons the buyer can act on from the pre-submit review (untick, swap the car, add an adviser). */
export const RESOLVABLE_REASONS: ReadonlySet<SelectionReasonCode> = new Set(["dealer_unchecked", "ineligible_vehicle", "dealer_opted_out", "sister_store", "same_dealer_other_vehicle"]);

export interface SelectionOutcome {
  vin: string;
  dealerName: string | null;
  dealerState: string | null;
  status: "invited" | "excluded";
  code: SelectionReasonCode | null;
  /** Buyer-facing sentence. Always from SELECTION_REASON_MESSAGES for an exclusion; empty for an invitation. */
  message: string;
  inviteId: string | null;
  /** True when an invitation that already existed was linked instead of a new one created. */
  reused?: boolean;
  recordedAt: string;
}

const CODES = new Set<string>(Object.keys(SELECTION_REASON_MESSAGES));

export function reasonMessage(code: SelectionReasonCode): string {
  return SELECTION_REASON_MESSAGES[code];
}

/** Defensive read of the stored column: drops anything malformed rather than trusting it. */
export function coerceSelectionOutcomes(raw: unknown): SelectionOutcome[] {
  if (!Array.isArray(raw)) return [];
  const out: SelectionOutcome[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const vin = typeof o.vin === "string" ? o.vin.trim().toUpperCase() : "";
    if (!vin) continue;
    const status = o.status === "invited" ? "invited" : o.status === "excluded" ? "excluded" : null;
    if (!status) continue;
    const code = typeof o.code === "string" && CODES.has(o.code) ? (o.code as SelectionReasonCode) : null;
    if (status === "excluded" && !code) continue;
    out.push({
      vin,
      dealerName: typeof o.dealerName === "string" && o.dealerName ? o.dealerName : null,
      dealerState: typeof o.dealerState === "string" && o.dealerState ? o.dealerState : null,
      status,
      code,
      // The sentence is re-derived from the code, so a stored row can never carry free text that was never reviewed.
      message: status === "excluded" && code ? SELECTION_REASON_MESSAGES[code] : "",
      inviteId: typeof o.inviteId === "string" && o.inviteId ? o.inviteId : null,
      ...(o.reused === true ? { reused: true } : {}),
      recordedAt: typeof o.recordedAt === "string" ? o.recordedAt : "",
    });
  }
  return out;
}

export function excluded(v: Pick<RfqPasteVehicle, "vin" | "dealerName" | "dealerState">, code: SelectionReasonCode, at: string): SelectionOutcome {
  return { vin: v.vin, dealerName: v.dealerName, dealerState: v.dealerState, status: "excluded", code, message: SELECTION_REASON_MESSAGES[code], inviteId: null, recordedAt: at };
}

export function invited(v: Pick<RfqPasteVehicle, "vin" | "dealerName" | "dealerState">, inviteId: string, at: string, reused = false): SelectionOutcome {
  return { vin: v.vin, dealerName: v.dealerName, dealerState: v.dealerState, status: "invited", code: null, message: "", inviteId, ...(reused ? { reused: true } : {}), recordedAt: at };
}

// ---------------------------------------------------------------------------
// One row per selected vehicle — what every screen renders
// ---------------------------------------------------------------------------

export type VehicleRowStatus = QuoteInviteStage | "excluded" | "unrecorded";

export interface VehicleRow {
  vehicle: RfqPasteVehicle;
  /** "exact": the request's headline VIN. "alternate": any other selected vehicle — never compared as the exact build. */
  role: "exact" | "alternate";
  status: VehicleRowStatus;
  /** Short label for the status chip. */
  statusLabel: string;
  code: SelectionReasonCode | null;
  /** Buyer-facing reason; empty when the vehicle has a live invitation. */
  reason: string;
  inviteId: string | null;
  dealerName: string | null;
  /** The dealer's quote for THIS vehicle, when there is one. */
  quote: RfqQuote | null;
}

const STATUS_LABELS: Record<VehicleRowStatus, string> = {
  queued: "Invitation queued",
  sent: "Invitation sent",
  viewed: "Opened by dealer",
  quoted: "Quoted",
  declined: "Dealer declined",
  expired: "Expired",
  excluded: "Not invited",
  unrecorded: "No invitation on record",
};

function norm(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase();
}

/** The invitation that carries this vehicle. VIN first; an older invite with no vehicle falls back to the dealership name. */
export function inviteForVehicle(rfq: Pick<RfqRequest, "invites">, v: Pick<RfqPasteVehicle, "vin" | "dealerName">): RfqInvite | null {
  const byVin = rfq.invites.find((i) => i.vehicle?.vin && i.vehicle.vin.trim().toUpperCase() === v.vin);
  if (byVin) return byVin;
  if (!v.dealerName) return null;
  return rfq.invites.find((i) => !i.vehicle?.vin && norm(i.dealerName) === norm(v.dealerName)) || null;
}

export function vehicleRows(rfq: Pick<RfqRequest, "invites" | "linkPastes" | "vin" | "vehicleYear" | "vehicleMake" | "vehicleModel" | "vehicleTrim"> & { selectionOutcomes?: SelectionOutcome[] | null }): VehicleRow[] {
  const stored = coerceSelectionOutcomes(rfq.selectionOutcomes);
  const headline = (rfq.vin || "").trim().toUpperCase();
  const claimed = new Set<string>();
  return rfqVehicles(rfq).map((vehicle) => {
    const role: VehicleRow["role"] = vehicle.vin === headline ? "exact" : "alternate";
    const invite = inviteForVehicle(rfq, vehicle);
    // Two legacy pastes at one dealership share one invite: only the first one owns it.
    if (invite && !claimed.has(invite.id)) {
      claimed.add(invite.id);
      const status = inviteStage(invite);
      return { vehicle, role, status, statusLabel: STATUS_LABELS[status], code: null, reason: "", inviteId: invite.id, dealerName: invite.dealerName, quote: invite.quote ?? null };
    }
    const outcome = stored.find((o) => o.vin === vehicle.vin && o.status === "excluded");
    if (outcome?.code) {
      return { vehicle, role, status: "excluded", statusLabel: STATUS_LABELS.excluded, code: outcome.code, reason: SELECTION_REASON_MESSAGES[outcome.code], inviteId: null, dealerName: vehicle.dealerName, quote: null };
    }
    // Nothing links it and nothing explains it: say so. (An unrecorded exclusion is never invented.)
    return { vehicle, role, status: "unrecorded", statusLabel: STATUS_LABELS.unrecorded, code: "reason_unavailable", reason: SELECTION_REASON_MESSAGES.reason_unavailable, inviteId: null, dealerName: vehicle.dealerName, quote: null };
  });
}

/** Outcomes exist for a pasted-vehicle package. A factory-match or open-ended alternate request has no per-vehicle selection. */
export function selectionApplies(rfq: Pick<RfqRequest, "packageKind" | "linkPastes" | "lane">): boolean {
  return rfq.packageKind === "links" && (rfq.lane ?? "same_spec") !== "alternate" && Array.isArray(rfq.linkPastes) && rfq.linkPastes.length > 0;
}

export interface SelectionSummary {
  /** Vehicles saved on the request. */
  saved: number;
  /** Vehicles with an invitation (created or reused). */
  invitations: number;
  /** Vehicles with an explicit exclusion reason. */
  blocked: number;
  /** Vehicles with no invitation and no recorded reason. */
  unrecorded: number;
  /** Delivery is a separate fact from creation. */
  queued: number;
  sent: number;
  opened: number;
  quoted: number;
  declined: number;
  expired: number;
}

export function summarizeRows(rows: VehicleRow[]): SelectionSummary {
  const s: SelectionSummary = { saved: rows.length, invitations: 0, blocked: 0, unrecorded: 0, queued: 0, sent: 0, opened: 0, quoted: 0, declined: 0, expired: 0 };
  for (const r of rows) {
    if (r.status === "excluded") s.blocked++;
    else if (r.status === "unrecorded") s.unrecorded++;
    else {
      s.invitations++;
      if (r.status === "queued") s.queued++;
      else if (r.status === "sent") s.sent++;
      else if (r.status === "viewed") s.opened++;
      else if (r.status === "quoted") s.quoted++;
      else if (r.status === "declined") s.declined++;
      else if (r.status === "expired") s.expired++;
    }
  }
  return s;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 vehicles saved · 1 invitation created · 2 not invited". Creation only; delivery has its own line. */
export function summaryHeadline(s: SelectionSummary): string {
  const parts = [`${plural(s.saved, "vehicle")} saved`, `${plural(s.invitations, "invitation")} created`];
  if (s.blocked) parts.push(`${s.blocked} blocked`);
  if (s.unrecorded) parts.push(`${s.unrecorded} with no invitation on record`);
  return parts.join(" · ");
}

/** Delivery and reply state, never folded into the creation count. Empty string when there is nothing to report. */
export function deliveryLine(s: SelectionSummary): string {
  if (!s.invitations) return "";
  const parts: string[] = [];
  if (s.queued) parts.push(`${s.queued} queued`);
  if (s.sent) parts.push(`${s.sent} sent`);
  if (s.opened) parts.push(`${s.opened} opened`);
  parts.push(`${plural(s.quoted, "quote")} received`);
  if (s.declined) parts.push(`${s.declined} declined`);
  if (s.expired) parts.push(`${s.expired} expired`);
  return parts.join(" · ");
}

/** True when the outcome set is anything less than every vehicle invited — a partial result must never read as success. */
export function isPartial(s: SelectionSummary): boolean {
  return s.blocked > 0 || s.unrecorded > 0;
}

/** The older request has no recorded outcomes and at least one vehicle with no invitation. */
export function hasUnexplainedGap(rows: VehicleRow[]): boolean {
  return rows.some((r) => r.status === "unrecorded");
}

/**
 * Last line of defence before anything is stored or logged: strips email addresses and long token-like strings.
 * Outcomes never carry free text today; this guards any future caller that adds some.
 */
export function scrubDiagnostic(text: string): string {
  return String(text || "")
    .replace(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email removed]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token removed]");
}
