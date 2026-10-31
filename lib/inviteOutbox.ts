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
import { rfqIsTestOrAudit } from "./buyerTestMode";
import { bump } from "./opsMetrics";
import { notSelectedHtml, notSelectedSubject, quoteInviteHtml, quoteInviteSubject, type QuoteEmailType, type QuoteInviteEmailInput } from "./quoteInviteEmail";
import { markRfqInviteDelivery, markRfqInviteNotSelected } from "./rfqApi";
import { LEASE_TIMELINE_LABELS, rfqVehicles } from "./rfqTracker";
import { rfqIsReleased, type RfqInvite, type RfqRequest } from "./rfq";
import { alternateAskSummary } from "./alternateAsk";
import { dealersOwedNotSelected, invitesToClose } from "./rfqClose";
import { buildAcceptedOfferEmail } from "./dealStageNotice";
import { revealUrl, signRevealToken } from "./contactRevealToken";
import { vehicleTitle } from "./vehicleTitle";

export type OutboxResult = "sent" | "parked_switch_off" | "held_for_approval" | "opted_out" | "no_desk" | "already_sent" | "failed";

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
  const timeline = rfq.leasePrefs?.timeline || (rfq.quotePrefs?.quoteType === "finance" ? rfq.quotePrefs.finance?.timeline : rfq.quotePrefs?.cash?.timeline) || null;
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
    buyerZip: rfq.leasePrefs?.zip || (rfq.quotePrefs?.quoteType === "finance" ? rfq.quotePrefs.finance?.zip : rfq.quotePrefs?.cash?.zip) || null,
    leasePrefs: rfq.leasePrefs || null,
    financePrefs: rfq.quotePrefs?.quoteType === "finance" ? { termMonths: rfq.quotePrefs.finance.termMonths, downPayment: rfq.quotePrefs.finance.downPayment, creditBand: rfq.quotePrefs.finance.creditBand } : null,
    buyerNote: rfq.buyerNote || null,
    tradeInExpected: rfq.tradeInExpected ?? null,
    tradeInIncluded: Boolean(rfq.tradeIn),
    alternateAsk: (rfq.lane ?? "same_spec") === "alternate" ? alternateAskSummary(rfq.alternateAsk) : null,
  };
  return { subject: quoteInviteSubject(input), html: quoteInviteHtml(input) };
}

/** The rooftop opted out or unsubscribed since the invite was queued (a request waits up to a business day for release). */
export function rooftopOptedOut(
  invite: Pick<RfqInvite, "dealerName" | "dealerUnsubscribedAt" | "vehicle">,
  rfq: RfqRequest,
  directory: Awaited<ReturnType<typeof listDealerships>>
): boolean {
  if (invite.dealerUnsubscribedAt) return true;
  const car = rfqVehicles(rfq).find((v) => v.vin === (invite.vehicle?.vin || rfq.vin)) || rfqVehicles(rfq)[0] || null;
  return Boolean(matchDirectoryDealership(directory, { dealerName: invite.dealerName, state: car?.dealerState || "" })?.emailOptOut);
}

/** Send one queued invite. Safe to call repeatedly: sent/viewed invites are skipped. */
export async function sendQueuedInvite(
  rfq: RfqRequest,
  invite: RfqInvite,
  deps: { directory?: Awaited<ReturnType<typeof listDealerships>>; send?: typeof sendQuoteInviteEmail; mark?: typeof markRfqInviteDelivery; emailEnabled?: () => boolean } = {}
): Promise<OutboxResult> {
  // Requests created by the scoped audit key or by buyer test mode stay out of ops metrics (no email_* counters).
  const count = rfqIsTestOrAudit(rfq) ? () => {} : bump;
  if (invite.status !== "invited") return "already_sent";
  if ((invite.deliveryStatus ?? "queued") !== "queued") return "already_sent";
  // The admin gate comes before every other check: an unreleased request is
  // never sent — not by the buyer opening the deal page, not by "drain all".
  if (!rfqIsReleased(rfq)) {
    count("email_held_for_approval");
    return "held_for_approval";
  }
  if (!(deps.emailEnabled || (() => featureEnabled("outboundDealerEmail")))()) {
    count("email_parked_switch_off");
    return "parked_switch_off";
  }
  const directory = deps.directory ?? (await listDealerships().catch(() => []));
  if (rooftopOptedOut(invite, rfq, directory)) {
    count("email_opted_out");
    return "opted_out";
  }
  const mail = await buildInviteEmailFromStored(rfq, invite, directory);
  if (!mail) return "no_desk";
  try {
    // Requests created by the scoped audit key or buyer test mode (rfq.audit / rfq.auditForcedSafeMode) must only ever go to
    // SAFE_MODE_RECIPIENT. Today every send does; if a per-recipient test-mode override is ever added
    // to sendQuoteInviteEmail, it must be skipped for these requests (pinned by lib/auditKeyApp.test.ts).
    const ok = await (deps.send || sendQuoteInviteEmail)(mail.subject, mail.html);
    if (!ok) {
      count("email_failed");
      return "failed";
    }
    // Resend has the email. If the mark fails the invite stays queued and the next drain sends it again: say so instead of hiding it.
    await (deps.mark || markRfqInviteDelivery)(rfq.id, invite.id, "sent").catch((err) => {
      console.error(`inviteOutbox: sent invite ${invite.id} of request ${rfq.id} but could not mark it sent —`, err instanceof Error ? err.message : err);
      count("email_mark_failed");
      return null;
    });
    count("email_sent");
    return "sent";
  } catch {
    count("email_failed");
    return "failed";
  }
}

export type CounterNoticeResult = "sent" | "held_for_approval" | "parked_switch_off" | "opted_out" | "failed";

/**
 * Tell a desk the buyer countered its quote. The counter is already saved on the box and waits on the dealer's page, so a skipped or
 * failed email never fails the buyer's request. Same gates as an invite (release, email switch, opt-out), and a failure is logged and
 * counted instead of swallowed. SAFE MODE routing is unchanged: the sender has no `to` parameter.
 */
export async function sendCounterNotice(
  rfq: RfqRequest,
  invite: RfqInvite,
  mail: { subject: string; html: string },
  deps: { directory?: Awaited<ReturnType<typeof listDealerships>>; send?: typeof sendQuoteInviteEmail; emailEnabled?: () => boolean } = {}
): Promise<CounterNoticeResult> {
  const count = rfqIsTestOrAudit(rfq) ? () => {} : bump;
  if (!rfqIsReleased(rfq)) {
    count("email_held_for_approval");
    return "held_for_approval";
  }
  if (!(deps.emailEnabled || (() => featureEnabled("outboundDealerEmail")))()) {
    count("email_parked_switch_off");
    return "parked_switch_off";
  }
  const directory = deps.directory ?? (await listDealerships().catch(() => []));
  if (rooftopOptedOut(invite, rfq, directory)) {
    count("email_opted_out");
    return "opted_out";
  }
  try {
    if (await (deps.send || sendQuoteInviteEmail)(mail.subject, mail.html)) {
      count("email_counter_sent");
      return "sent";
    }
  } catch (err) {
    console.error(`inviteOutbox: counter notice for invite ${invite.id} of request ${rfq.id} threw —`, err instanceof Error ? err.message : err);
  }
  console.error(`inviteOutbox: counter notice for invite ${invite.id} of request ${rfq.id} was not sent`);
  count("email_counter_failed");
  return "failed";
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
  const out: Record<OutboxResult, number> & { queued: number } = { sent: 0, parked_switch_off: 0, held_for_approval: 0, opted_out: 0, no_desk: 0, already_sent: 0, failed: 0, queued: 0 };
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

// ---------------------------------------------------------------------------
// "Not selected this time": the buyer accepted another dealer's offer.
// Same outbox rules as an invite: the release gate and the email switch apply, the send goes through the SAFE MODE
// sender (which has no `to` parameter, so audit=1 / test-mode requests can only ever reach SAFE_MODE_RECIPIENT), and the
// box is the source of truth for "already sent". Exactly once per dealer: the box claim is atomic, so two accepts
// racing, a retry, or a drain cannot send twice; a crashed send frees its claim after the lease and is retried.
// ---------------------------------------------------------------------------
export type NotSelectedResult = "sent" | "skipped" | "parked_switch_off" | "held_for_approval" | "no_desk" | "already_sent" | "claimed_elsewhere" | "failed";

export interface NotSelectedDeps {
  send?: typeof sendQuoteInviteEmail;
  mark?: typeof markRfqInviteNotSelected;
  emailEnabled?: () => boolean;
}

/** Everything a SAFE MODE review needs to see which dealer the note was meant for; removed with the override. */
function safeModeTag(dealerName: string, subject: string, html: string): { subject: string; html: string } {
  return {
    subject: `[SAFE MODE · ${dealerName}] ${subject}`,
    html: `<p style="font-size:12px;color:#78350f;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;margin:0 0 16px"><strong>SAFE MODE:</strong> redirected here instead of ${dealerName}.</p>${html}`,
  };
}

/** Send (at most once) the not-selected note to one dealer and close their quote. Never throws. */
export async function sendNotSelectedNotice(rfq: RfqRequest, invite: RfqInvite, deps: NotSelectedDeps = {}): Promise<NotSelectedResult> {
  const count = rfqIsTestOrAudit(rfq) ? () => {} : bump;
  const mark = deps.mark || markRfqInviteNotSelected;
  try {
    if (invite.notSelectedNoticeSentAt) return "already_sent";
    if (!rfqIsReleased(rfq)) return "held_for_approval";
    // Closing the quote never waits on the email switch: the dealer must not keep countering while mail is parked.
    await mark(rfq.id, invite.id, "close");
    if (!(deps.emailEnabled || (() => featureEnabled("outboundDealerEmail")))()) {
      count("notselected_parked_switch_off");
      return "parked_switch_off";
    }
    const desk = invite.desk;
    if (!desk || !invite.dealerContactEmail) return "no_desk";
    const input = {
      dealerName: invite.dealerName,
      contactName: desk.contactName,
      vehicle: invite.vehicle || { vin: rfq.vin, year: rfq.vehicleYear, make: rfq.vehicleMake, model: rfq.vehicleModel, trim: rfq.vehicleTrim },
      dealReference: dealerReference(rfq.id, invite.id),
    };
    const claim = await mark(rfq.id, invite.id, "claim");
    if (!claim.claimed) return "claimed_elsewhere";
    const mail = safeModeTag(invite.dealerName, notSelectedSubject(input), notSelectedHtml(input));
    let ok = false;
    try {
      ok = await (deps.send || sendQuoteInviteEmail)(mail.subject, mail.html);
    } catch {
      ok = false;
    }
    if (!ok) {
      await mark(rfq.id, invite.id, "release").catch(() => null);
      count("notselected_failed");
      return "failed";
    }
    await mark(rfq.id, invite.id, "sent").catch(() => null);
    count("notselected_sent");
    return "sent";
  } catch {
    count("notselected_failed");
    return "failed";
  }
}

/**
 * The buyer accepted `winnerInviteId`: close every other live quote and send each owed dealer their note, once.
 * Best effort and safe to call again (the accept routes call it from after(); the drain can too).
 */
export async function closeOutLosers(rfq: RfqRequest, winnerInviteId: string, deps: NotSelectedDeps = {}): Promise<Record<NotSelectedResult, number>> {
  const out: Record<NotSelectedResult, number> = { sent: 0, skipped: 0, parked_switch_off: 0, held_for_approval: 0, no_desk: 0, already_sent: 0, claimed_elsewhere: 0, failed: 0 };
  const owed = new Set(dealersOwedNotSelected(rfq, winnerInviteId).map((i) => i.id));
  for (const invite of invitesToClose(rfq, winnerInviteId)) {
    if (!owed.has(invite.id)) {
      // Already told (or unsubscribed): still make sure the quote is closed.
      await (deps.mark || markRfqInviteNotSelected)(rfq.id, invite.id, "close").catch(() => null);
      out[invite.notSelectedNoticeSentAt ? "already_sent" : "skipped"]++;
      continue;
    }
    out[await sendNotSelectedNotice(rfq, invite, deps)]++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// "Your offer was accepted": the buyer tapped "Accept final deal", so the WINNING dealer gets the vehicle, VIN and accepted
// out-the-door total and a button. The email carries NO buyer name, email or phone: the button opens a signed, expiring,
// single-dealer page where the dealer presses "Reveal buyer contact info" (app/api/quote-invite/reveal-contact), which is logged.
// Same outbox rules as every other dealer email: the release gate and the email switch apply, and the send goes through the SAFE MODE
// sender, which has no `to` parameter, so SAFE MODE, audit=1 and buyer-test-mode deals can only ever reach SAFE_MODE_RECIPIENT.
// Only a deal that is finally accepted and carries a release is ever sent; losing, walked and unaccepted deals have none.
// ---------------------------------------------------------------------------
export type BuyerDetailsResult = "sent" | "not_accepted" | "parked_switch_off" | "held_for_approval" | "not_winner" | "failed";

export async function sendBuyerDetailsRelease(
  rfq: RfqRequest,
  invite: RfqInvite,
  deps: { send?: typeof sendQuoteInviteEmail; emailEnabled?: () => boolean; now?: number } = {}
): Promise<BuyerDetailsResult> {
  const count = rfqIsTestOrAudit(rfq) ? () => {} : bump;
  try {
    const stage = invite.stage;
    if (!stage || stage.stage !== "closed" || stage.final?.status !== "accepted" || !stage.release || !stage.final.summary) return "not_accepted";
    if (invite.notSelectedAt) return "not_winner";
    if (!rfqIsReleased(rfq)) return "held_for_approval";
    if (!(deps.emailEnabled || (() => featureEnabled("outboundDealerEmail")))()) {
      count("buyerdetails_parked_switch_off");
      return "parked_switch_off";
    }
    const vehicle = vehicleTitle({ vin: rfq.vin, year: rfq.vehicleYear, make: rfq.vehicleMake, model: rfq.vehicleModel, trim: rfq.vehicleTrim }) || "vehicle";
    const mail = buildAcceptedOfferEmail({
      vehicle,
      vin: invite.vehicle?.vin || rfq.vin || "",
      acceptedOtd: stage.final.summary.otd,
      hasTrade: stage.final.summary.tradeValue != null,
      netAfterTrade: stage.final.summary.trueOtd,
      url: revealUrl(signRevealToken(rfq.id, invite.id, deps.now), DEALER_EMAIL_BASE_URL),
    });
    const tagged = safeModeTag(invite.dealerName, mail.subject, mail.html);
    const ok = await (deps.send || sendQuoteInviteEmail)(tagged.subject, tagged.html);
    count(ok ? "buyerdetails_sent" : "buyerdetails_failed");
    return ok ? "sent" : "failed";
  } catch {
    count("buyerdetails_failed");
    return "failed";
  }
}
