/**
 * The admin approval checkpoint for the quote-request (RFQ) pipe.
 *
 * Every invite the buyer's wizard creates now lands `queued` on the box and
 * stays there — app/api/rfqs/[id]/invites/route.ts no longer sends the
 * dealer email itself (see that route's comment). Nothing reaches a dealer
 * contact until an admin reviews the request and approves it here.
 *
 * This is the one place that composes and sends a queued invite's dealer
 * email — the same template and SAFE MODE send path the old inline logic
 * in the invites route used, just moved so both the (removed) buyer-side
 * send and the new admin-approve route can share it without duplicating
 * the derivation.
 *
 * Everything the email needs is derived from the persisted `RfqRequest` /
 * `RfqInvite` alone — never from the original POST body, which is long
 * gone by the time an admin approves. That drops a couple of decorative,
 * never-persisted fields the old inline path had for a split second
 * (vehicleFacts like drivetrain/exterior color) — see the gap noted in
 * buildRfqInviteEmailInput below. Everything that actually changes the
 * email's substance (quote type, finance/cash locks, timeline, ZIP) is a
 * persisted field on the rfq or invite, so this loses nothing that matters.
 */
import type { RfqInvite, RfqRequest } from "./rfq";
import { getRfq, markRfqInviteDelivery, RfqApiError } from "./rfqApi";
import { listDealerships } from "./dealershipsApi";
import { matchDirectoryDealership } from "./dealerContactLookup";
import { quoteInviteSubject, quoteInviteHtml, type QuoteEmailType, type QuoteInviteEmailInput } from "./quoteInviteEmail";
import { sendQuoteInviteEmail } from "./dealerEmail";
import { unsubscribeUrlFor, DEALER_EMAIL_BASE_URL } from "./dealerUnsubscribe";
import { LEASE_TIMELINE_LABELS, pendingApprovalInvites } from "./rfqTracker";

export { isPendingApproval, pendingApprovalInvites, rfqNeedsApproval } from "./rfqTracker";

/** The purchase-timeline label an invite's email shows — lease, finance, and cash prefs all carry the same `timeline` field. */
function timelineLabelFor(rfq: Pick<RfqRequest, "leasePrefs" | "quotePrefs">): string | null {
  const timeline = rfq.leasePrefs?.timeline || (rfq.quotePrefs?.quoteType === "finance" ? rfq.quotePrefs.finance.timeline : rfq.quotePrefs?.quoteType === "cash" ? rfq.quotePrefs.cash.timeline : null);
  return timeline ? LEASE_TIMELINE_LABELS[timeline] : null;
}

/** The buyer's ZIP for the email's area line — whichever locked prefs carried it. */
function buyerZipFor(rfq: Pick<RfqRequest, "leasePrefs" | "quotePrefs">): string | null {
  const zip = rfq.leasePrefs?.zip || (rfq.quotePrefs?.quoteType === "finance" ? rfq.quotePrefs.finance.zip : rfq.quotePrefs?.quoteType === "cash" ? rfq.quotePrefs.cash.zip : "");
  return zip || null;
}

/**
 * Builds the one email a queued invite's desk would get — pure, no I/O.
 * Returns null when the invite has no named desk/contact to send to (a
 * "links" package always resolves one before the invite is created, but a
 * defensive null keeps this from ever composing an email with nowhere to
 * send it).
 */
export function buildRfqInviteEmailInput(
  rfq: Pick<RfqRequest, "leasePrefs" | "quotePrefs" | "buyerNote" | "dealReference" | "vin" | "vehicleYear" | "vehicleMake" | "vehicleModel" | "vehicleTrim">,
  invite: Pick<RfqInvite, "id" | "dealerName" | "dealerContactEmail" | "desk" | "vehicle" | "viewToken">,
  directoryRow: { city: string | null; state: string | null; address: string | null } | null,
  unsubscribeUrl: string | null
): QuoteInviteEmailInput | null {
  if (!invite.desk || !invite.dealerContactEmail) return null;
  const vehicle = invite.vehicle || { vin: rfq.vin, year: rfq.vehicleYear, make: rfq.vehicleMake, model: rfq.vehicleModel, trim: rfq.vehicleTrim, vdpUrl: null };
  const quoteType: QuoteEmailType = rfq.leasePrefs ? "lease" : rfq.quotePrefs?.quoteType === "finance" ? "finance" : "cash";
  const financePrefs = rfq.quotePrefs?.quoteType === "finance" ? { termMonths: rfq.quotePrefs.finance.termMonths, downPayment: rfq.quotePrefs.finance.downPayment, creditBand: rfq.quotePrefs.finance.creditBand } : null;
  const viewUrl = `${DEALER_EMAIL_BASE_URL}/api/quote-invite/view?t=${encodeURIComponent(invite.viewToken || "")}`;
  return {
    quoteType,
    dealerName: invite.dealerName,
    contactName: invite.desk.contactName,
    role: invite.desk.role,
    rooftop: directoryRow ? { city: directoryRow.city, state: directoryRow.state, address: directoryRow.address } : { city: null, state: null, address: null },
    vehicle,
    dealReference: rfq.dealReference || null,
    viewUrl,
    unsubscribeUrl,
    purchaseTimelineLabel: timelineLabelFor(rfq),
    buyerNote: rfq.buyerNote || null,
    buyerZip: buyerZipFor(rfq),
    leasePrefs: rfq.leasePrefs || null,
    financePrefs,
  };
}

export interface SendRfqInviteResult {
  inviteId: string;
  sent: boolean;
  error?: string;
}

/**
 * Sends one queued invite's dealer email and marks it delivered on success.
 * A send failure (or a missing desk/contact) leaves the invite queued,
 * which is the truth — never throws, so one bad invite never blocks the
 * rest of an "approve the whole RFQ" pass.
 */
export async function sendRfqInvite(rfq: RfqRequest, invite: RfqInvite): Promise<SendRfqInviteResult> {
  if (!invite.desk || !invite.dealerContactEmail) {
    return { inviteId: invite.id, sent: false, error: "No named dealer contact on this invite." };
  }
  try {
    const directory = invite.desk.source === "directory" ? await listDealerships().catch(() => []) : [];
    const directoryMatch = invite.desk.source === "directory" ? matchDirectoryDealership(directory, { dealerName: invite.dealerName }) : null;
    const directoryRow = directoryMatch ? { city: directoryMatch.city, state: directoryMatch.state, address: directoryMatch.address } : null;
    const unsubscribeUrl = directoryMatch ? unsubscribeUrlFor(directoryMatch.id) : null;
    const emailInput = buildRfqInviteEmailInput(rfq, invite, directoryRow, unsubscribeUrl);
    if (!emailInput) {
      return { inviteId: invite.id, sent: false, error: "No named dealer contact on this invite." };
    }
    const accepted = await sendQuoteInviteEmail(quoteInviteSubject(emailInput), quoteInviteHtml(emailInput));
    if (!accepted) {
      return { inviteId: invite.id, sent: false, error: "Email service is not configured (RESEND_API_KEY)." };
    }
    await markRfqInviteDelivery(rfq.id, invite.id, "sent");
    return { inviteId: invite.id, sent: true };
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : err instanceof Error ? err.message : "Could not send this invite.";
    return { inviteId: invite.id, sent: false, error: message };
  }
}

export interface ApproveRfqResult {
  rfq: RfqRequest;
  results: SendRfqInviteResult[];
}

/**
 * Approves an RFQ: sends every still-queued invite, or only the ones named
 * in `inviteIds` when given (the admin's per-invite "skip" — ticking off
 * which desks to leave queued). Re-fetches the rfq fresh first so a
 * concurrently-declined or already-sent invite is never re-sent.
 */
export async function approveRfqInvites(rfqId: string, inviteIds?: string[]): Promise<ApproveRfqResult> {
  const rfq = await getRfq(rfqId);
  if (!rfq) throw new RfqApiError("RFQ not found.", 404);
  const wanted = inviteIds ? new Set(inviteIds) : null;
  const targets = pendingApprovalInvites(rfq).filter((i) => !wanted || wanted.has(i.id));
  const results: SendRfqInviteResult[] = [];
  for (const invite of targets) {
    results.push(await sendRfqInvite(rfq, invite));
  }
  const refreshed = (await getRfq(rfqId)) || rfq;
  return { rfq: refreshed, results };
}
