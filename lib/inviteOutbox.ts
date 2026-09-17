/**
 * Dealer email as a queue, not a request-time side effect.
 *
 * The invite row on the box IS the queue entry: it is created "queued"
 * inside the buyer's HTTP request and the request returns. The send runs
 * after the response (Next's after()), and anything still "queued" —
 * because the process was killed, Resend failed, or the email switch was
 * off — is picked up by drainQueuedInvites(): called from the ops endpoint
 * (runbook), and opportunistically whenever the buyer opens the deal. No
 * cron needed; nothing depends on the plan tier.
 *
 * The email is rebuilt from STORED state only (request + invite +
 * directory row), so a retry a day later sends the same thing the buyer
 * saw on Review. Idempotent per invite: the box only moves delivery
 * forward, and a "sent" invite is never sent twice.
 */
import { DEALER_EMAIL_BASE_URL, unsubscribeUrlFor } from "./dealerUnsubscribe";
import { listDealerships } from "./dealershipsApi";
import { matchDirectoryDealership } from "./dealerContactLookup";
import { sendQuoteInviteEmail } from "./dealerEmail";
import { dealerReference } from "./dealerReference";
import { featureEnabled } from "./featureFlags";
import { bump } from "./opsMetrics";
import { quoteInviteHtml, quoteInviteSubject, type QuoteEmailType, type QuoteInviteEmailInput } from "./quoteInviteEmail";
import { markRfqInviteDelivery } from "./rfqApi";
import { LEASE_TIMELINE_LABELS, rfqVehicles } from "./rfqTracker";
import { rfqIsReleased, type RfqInvite, type RfqRequest } from "./rfq";

export type OutboxResult = "sent" | "parked_switch_off" | "held_for_approval" | "no_desk" | "already_sent" | "failed";

/** Build the dealer email from what the box stores — nothing from the original request payload. */
export async function buildInviteEmailFromStored(
  rfq: RfqRequest,
  invite: RfqInvite,
  directory: Awaited<ReturnType<typeof listDealerships>>
): Promise<{ subject: string; html: string } | null> {
  const desk = invite.desk;
  if (!desk || !invite.dealerContactEmail) return null;
  const car = rfqVehicles(rfq).find((v) => v.vin === (invite.vehicle?.vin || rfq.vin)) || rfqVehicles(rfq)[0] || null;
  const directoryRow = desk.source === "directory" ? matchDirectoryDealership(directory, { dealerName: invite.dealerName, state: car?.dealerState || "" }) : null;
  const quoteType: QuoteEmailType = rfq.leasePrefs ? "lease" : rfq.quotePrefs?.quoteType === "finance" ? "finance" : "cash";
  const timeline = rfq.leasePrefs?.timeline || (rfq.quotePrefs?.quoteType === "finance" ? rfq.quotePrefs.finance.timeline : rfq.quotePrefs?.cash.timeline) || null;
  const input: QuoteInviteEmailInput = {
    quoteType,
    dealerName: invite.dealerName,
    contactName: desk.contactName,
    role: desk.role,
    rooftop: directoryRow ? { city: directoryRow.city, state: directoryRow.state, address: directoryRow.address } : { city: null, state: car?.dealerState || null, address: null },
    vehicle: invite.vehicle
      ? { ...invite.vehicle, vdpUrl: invite.vehicle.vdpUrl ?? null }
      : { vin: rfq.vin, year: rfq.vehicleYear, make: rfq.vehicleMake, model: rfq.vehicleModel, trim: rfq.vehicleTrim, vdpUrl: car?.vdpUrl || null },
    dealReference: dealerReference(rfq.id, invite.id),
    viewUrl: `${DEALER_EMAIL_BASE_URL}/api/quote-invite/view?t=${encodeURIComponent(invite.viewToken || "")}`,
    unsubscribeUrl: directoryRow ? unsubscribeUrlFor(directoryRow.id) : null,
    purchaseTimelineLabel: timeline ? LEASE_TIMELINE_LABELS[timeline] : null,
    buyerZip: rfq.leasePrefs?.zip || (rfq.quotePrefs?.quoteType === "finance" ? rfq.quotePrefs.finance.zip : rfq.quotePrefs?.cash.zip) || null,
    leasePrefs: rfq.leasePrefs || null,
    financePrefs: rfq.quotePrefs?.quoteType === "finance" ? { termMonths: rfq.quotePrefs.finance.termMonths, downPayment: rfq.quotePrefs.finance.downPayment, creditBand: rfq.quotePrefs.finance.creditBand } : null,
    buyerNote: rfq.buyerNote || null,
    tradeInExpected: rfq.tradeInExpected ?? null,
  };
  return { subject: quoteInviteSubject(input), html: quoteInviteHtml(input) };
}

/** Send one queued invite. Safe to call repeatedly: sent/viewed invites are skipped. */
export async function sendQueuedInvite(
  rfq: RfqRequest,
  invite: RfqInvite,
  deps: { directory?: Awaited<ReturnType<typeof listDealerships>>; send?: typeof sendQuoteInviteEmail; mark?: typeof markRfqInviteDelivery; emailEnabled?: () => boolean } = {}
): Promise<OutboxResult> {
  if (invite.status !== "invited") return "already_sent";
  if ((invite.deliveryStatus ?? "queued") !== "queued") return "already_sent";
  // The admin gate comes before every other check: an unreleased request is
  // never sent — not by the buyer opening the deal page, not by "drain all".
  if (!rfqIsReleased(rfq)) {
    bump("email_held_for_approval");
    return "held_for_approval";
  }
  if (!(deps.emailEnabled || (() => featureEnabled("outboundDealerEmail")))()) {
    bump("email_parked_switch_off");
    return "parked_switch_off";
  }
  const directory = deps.directory ?? (await listDealerships().catch(() => []));
  const mail = await buildInviteEmailFromStored(rfq, invite, directory);
  if (!mail) return "no_desk";
  try {
    const ok = await (deps.send || sendQuoteInviteEmail)(mail.subject, mail.html);
    if (!ok) {
      bump("email_failed");
      return "failed";
    }
    await (deps.mark || markRfqInviteDelivery)(rfq.id, invite.id, "sent").catch(() => null);
    bump("email_sent");
    return "sent";
  } catch {
    bump("email_failed");
    return "failed";
  }
}

/** Everything still queued on one request. */
export function queuedInvitesOf(rfq: RfqRequest): RfqInvite[] {
  return rfq.invites.filter((i) => i.status === "invited" && (i.deliveryStatus ?? "queued") === "queued");
}

/** Drain the queued invites of the given requests. Returns per-result counts. */
export async function drainQueuedInvites(
  rfqs: RfqRequest[],
  deps: Parameters<typeof sendQueuedInvite>[2] & { maxSends?: number } = {}
): Promise<Record<OutboxResult, number> & { queued: number }> {
  const out: Record<OutboxResult, number> & { queued: number } = { sent: 0, parked_switch_off: 0, held_for_approval: 0, no_desk: 0, already_sent: 0, failed: 0, queued: 0 };
  const directory = deps.directory ?? (await listDealerships().catch(() => []));
  let sends = 0;
  for (const rfq of rfqs) {
    if (rfq.status !== "collecting") continue;
    for (const invite of queuedInvitesOf(rfq)) {
      out.queued++;
      if (deps.maxSends != null && sends >= deps.maxSends) continue;
      const r = await sendQueuedInvite(rfq, invite, { ...deps, directory });
      out[r]++;
      if (r === "sent" || r === "failed") sends++;
    }
  }
  bump("drain_run");
  return out;
}
