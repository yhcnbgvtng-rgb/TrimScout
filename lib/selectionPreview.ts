/**
 * Before the buyer submits: every selected vehicle, its dealership, and whether an invitation will be created.
 *
 * Two different kinds of answer, kept apart on purpose:
 *   known     — we can say it now from what's on screen (unticked dealership, no dealership on the listing, opted out,
 *               a second car at a dealership already in the request, a dealer-group domain already used, over the cap);
 *   on_submit — checks that need the server and can only finish when the request is submitted (an open request to the
 *               same desk elsewhere, a shared mailbox, a dealership's daily cap, a service error).
 *
 * The rules mirror lib/selectionInvites.ts (the submit-time authority). Pure: the wizard and the tests call it.
 */
import { RESOLVABLE_REASONS, SELECTION_REASON_MESSAGES, type SelectionReasonCode } from "./selectionOutcomes";
import { emailDomainOf, isPublicEmailDomain } from "./quotePackage";

export interface PreviewVehicle {
  vin: string;
  title: string;
  dealerName: string | null;
  dealerState: string | null;
  /** Row key of the dealership (lib/deskSelection deskKey). */
  deskKey: string | null;
  /** The dealership's tick. */
  checked: boolean;
  /** The directory marks the dealership opted out. */
  optedOut: boolean;
  /** The buyer typed their own adviser's address, which takes the request instead. */
  adviserAdded: boolean;
  /** Masked desk address ("j•••••@group.com"): only its domain is read, for the dealer-group rule. */
  emailMasked: string | null;
}

export interface PreviewRow {
  vin: string;
  title: string;
  dealerName: string | null;
  verdict: "will_invite" | "restricted";
  code: SelectionReasonCode | null;
  reason: string;
  /** "known": decided from what we can see now. "on_submit": cannot be fully checked until the request is submitted. */
  certainty: "known" | "on_submit";
  /** The buyer can fix it here (tick the dealership, swap the car, add their adviser). */
  resolvable: boolean;
}

export const ON_SUBMIT_NOTE = "Some checks can only finish when you submit: whether this desk already has an open request from you, a shared dealership mailbox, and a dealership's daily limit. Anything blocked then is listed with its reason.";

export function planSelectionPreview(vehicles: PreviewVehicle[], opts: { inviteCap?: number | null } = {}): PreviewRow[] {
  const cap = Math.min(3, opts.inviteCap ?? 3);
  const dealers = new Set<string>();
  const domains = new Set<string>();
  let invites = 0;
  return vehicles.map((v): PreviewRow => {
    const restricted = (code: SelectionReasonCode): PreviewRow => ({ vin: v.vin, title: v.title, dealerName: v.dealerName, verdict: "restricted", code, reason: SELECTION_REASON_MESSAGES[code], certainty: "known", resolvable: RESOLVABLE_REASONS.has(code) });
    if (!v.dealerName) return restricted("ineligible_vehicle");
    if (v.optedOut && !v.adviserAdded) return restricted("dealer_opted_out");
    if (!v.checked) return restricted("dealer_unchecked");
    const dealerKey = (v.deskKey || v.dealerName).toLowerCase();
    if (dealers.has(dealerKey)) return restricted("same_dealer_other_vehicle");
    const domain = v.adviserAdded ? "" : emailDomainOf(v.emailMasked);
    if (domain && !isPublicEmailDomain(domain) && domains.has(domain)) return restricted("sister_store");
    if (invites >= cap) return restricted("invite_limit_reached");
    dealers.add(dealerKey);
    if (domain && !isPublicEmailDomain(domain)) domains.add(domain);
    invites++;
    return { vin: v.vin, title: v.title, dealerName: v.dealerName, verdict: "will_invite", code: null, reason: "", certainty: "on_submit", resolvable: false };
  });
}

export function previewCounts(rows: PreviewRow[]): { vehicles: number; willInvite: number; restricted: number } {
  const willInvite = rows.filter((r) => r.verdict === "will_invite").length;
  return { vehicles: rows.length, willInvite, restricted: rows.length - willInvite };
}
