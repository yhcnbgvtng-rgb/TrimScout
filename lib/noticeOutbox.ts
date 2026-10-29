/**
 * Sending the thread notices (lib/threadNotice.ts). They are best effort by design: the quote, decline, rejection, walk-away or
 * chat message is already saved when one is sent, so a skipped or failed email never fails the request that caused it.
 *
 * Gates, same as the invite outbox: the email switch; the admin release gate (not for a rejection, which is about a request that
 * was never released); and, for dealer-bound mail, the rooftop's opt-out / unsubscribe. A new-message notice is also debounced per
 * thread and side. The window lives in this instance's memory (no stored state without a box change), so across serverless
 * instances it can send a second notice: with SAFE MODE on that is one extra mail to the safe inbox, never to a person.
 * SAFE MODE routing is unchanged: the sender has no `to` parameter.
 */
import { DEALER_EMAIL_BASE_URL, unsubscribeUrlFor } from "./dealerUnsubscribe";
import { matchDirectoryDealership } from "./dealerContactLookup";
import { listDealerships } from "./dealershipsApi";
import { sendQuoteInviteEmail } from "./dealerEmail";
import { dealerReference } from "./dealerReference";
import { featureEnabled } from "./featureFlags";
import { guestTrackerPath, isGuestBuyerId } from "./buyerAccess";
import { rfqIsTestOrAudit } from "./buyerTestMode";
import { bump } from "./opsMetrics";
import { rfqIsReleased, type RfqInvite, type RfqRequest } from "./rfq";
import { rfqVehicles } from "./rfqTracker";
import { rooftopOptedOut } from "./inviteOutbox";
import { buildBuyerClosedNotice, buildDealerDeclinedNotice, buildDealerQuotedNotice, buildNewMessageNotice, buildRequestRejectedNotice, type ThreadNotice } from "./threadNotice";

export type NoticeResult = "sent" | "held_for_approval" | "parked_switch_off" | "opted_out" | "debounced" | "failed";

export const MESSAGE_NOTICE_WINDOW_MS = 10 * 60 * 1000;
const lastMessageNotice = new Map<string, number>();
export function resetNoticeDebounceForTests(): void { lastMessageNotice.clear(); }

/** The buyer's link: a guest gets their private tracker link, everyone else their request page. */
export function buyerRfqUrl(rfq: Pick<RfqRequest, "id" | "buyerUserId">): string {
  return `${DEALER_EMAIL_BASE_URL}${isGuestBuyerId(rfq.buyerUserId) ? guestTrackerPath(rfq.id) : `/rfq/${encodeURIComponent(String(rfq.id))}`}`;
}

/** The dealer's link: their tokened quote page. Null when the invite has no token. */
export function dealerQuoteUrl(invite: Pick<RfqInvite, "viewToken">): string | null {
  return invite.viewToken ? `${DEALER_EMAIL_BASE_URL}/api/quote-invite/view?t=${encodeURIComponent(invite.viewToken)}` : null;
}

/** The car this invite is about (a package has one per invite), as title parts. */
export function inviteVehicleParts(rfq: RfqRequest, invite: RfqInvite) {
  const v = invite.vehicle ?? rfqVehicles(rfq).find((c) => c.vin === rfq.vin) ?? null;
  return v ? { year: v.year, make: v.make, model: v.model, trim: v.trim } : { year: rfq.vehicleYear, make: rfq.vehicleMake, model: rfq.vehicleModel, trim: rfq.vehicleTrim };
}

export function inviteReference(rfq: RfqRequest, invite: RfqInvite): string { return dealerReference(String(rfq.id), invite.id); }

export interface NoticeDeps {
  directory?: Awaited<ReturnType<typeof listDealerships>>;
  send?: typeof sendQuoteInviteEmail;
  emailEnabled?: () => boolean;
  now?: () => number;
}

/**
 * Send one notice. `build` receives the rooftop's unsubscribe link (dealer-bound mail only) so the copy can carry it.
 * `invite` is required for dealer-bound mail (opt-out) and for the message debounce.
 */
export async function sendThreadNotice(
  rfq: RfqRequest,
  invite: RfqInvite | null,
  audience: "buyer" | "dealer",
  build: (ctx: { unsubscribeUrl: string | null }) => ThreadNotice | null,
  deps: NoticeDeps = {}
): Promise<NoticeResult> {
  const count = rfqIsTestOrAudit(rfq) ? () => {} : bump;
  try {
    const probe = build({ unsubscribeUrl: null });
    if (!probe) return "failed";
    // A rejection is about a request that was never released; everything else needs the release.
    if (probe.kind !== "request_rejected" && !rfqIsReleased(rfq)) {
      count("notice_skipped");
      return "held_for_approval";
    }
    if (!(deps.emailEnabled || (() => featureEnabled("outboundDealerEmail")))()) {
      count("notice_skipped");
      return "parked_switch_off";
    }
    let unsubscribeUrl: string | null = null;
    if (audience === "dealer") {
      if (!invite) return "failed";
      const directory = deps.directory ?? (await listDealerships().catch(() => []));
      if (rooftopOptedOut(invite, rfq, directory)) {
        count("notice_skipped");
        return "opted_out";
      }
      const car = rfqVehicles(rfq).find((v) => v.vin === (invite.vehicle?.vin || rfq.vin)) || rfqVehicles(rfq)[0] || null;
      const row = matchDirectoryDealership(directory, { dealerName: invite.dealerName, state: car?.dealerState || "" });
      unsubscribeUrl = row ? unsubscribeUrlFor(row.id) : null;
    }
    const notice = build({ unsubscribeUrl });
    if (!notice) return "failed";
    const now = (deps.now || Date.now)();
    const key = notice.kind === "new_message" && invite ? `${rfq.id}:${invite.id}:${audience}` : null;
    if (key) {
      const last = lastMessageNotice.get(key);
      if (last != null && now - last < MESSAGE_NOTICE_WINDOW_MS) {
        count("notice_skipped");
        return "debounced";
      }
    }
    if (await (deps.send || sendQuoteInviteEmail)(notice.subject, notice.html)) {
      if (key) lastMessageNotice.set(key, now);
      count("notice_sent");
      return "sent";
    }
  } catch (err) {
    console.error(`noticeOutbox: notice for request ${rfq.id} threw —`, err instanceof Error ? err.message : err);
  }
  console.error(`noticeOutbox: notice for request ${rfq.id} was not sent`);
  count("notice_failed");
  return "failed";
}

// ---- the five moments, as the routes call them (each is best effort and never throws) ----------------------------------

/** A dealer's quote (or revised quote after a counter) was just saved: tell the buyer. */
export function notifyDealerQuoted(rfq: RfqRequest, invite: RfqInvite, deps?: NoticeDeps): Promise<NoticeResult> {
  return sendThreadNotice(rfq, invite, "buyer", () => buildDealerQuotedNotice({ dealerName: invite.dealerName, vehicle: inviteVehicleParts(rfq, invite), revised: Boolean(invite.buyerCounter), url: buyerRfqUrl(rfq) }), deps);
}

/** A dealer declined (could not quote, or could not do better on a counter): tell the buyer. */
export function notifyDealerDeclined(rfq: RfqRequest, invite: RfqInvite, deps?: NoticeDeps): Promise<NoticeResult> {
  return sendThreadNotice(rfq, invite, "buyer", () => buildDealerDeclinedNotice({ dealerName: invite.dealerName, vehicle: inviteVehicleParts(rfq, invite), url: buyerRfqUrl(rfq) }), deps);
}

/** An admin refused to release a request: tell the buyer (the reason stays on their tracker). */
export function notifyRequestRejected(rfq: RfqRequest, deps?: NoticeDeps): Promise<NoticeResult> {
  return sendThreadNotice(rfq, null, "buyer", () => buildRequestRejectedNotice({ vehicle: { year: rfq.vehicleYear, make: rfq.vehicleMake, model: rfq.vehicleModel, trim: rfq.vehicleTrim }, url: buyerRfqUrl(rfq) }), deps);
}

/** The invites a walk-away closes for a dealer: told about the request, still open, not already closed by a pick. */
export function invitesToTellClosed(rfq: RfqRequest): RfqInvite[] {
  return rfq.invites.filter((i) => (i.status === "invited" || i.status === "quoted") && !i.notSelectedAt && (i.deliveryStatus ?? "queued") !== "queued");
}

/** The buyer walked away: one notice per dealer who had the request. Pass the request as it was before the walk. */
export async function notifyBuyerClosed(rfq: RfqRequest, deps?: NoticeDeps): Promise<NoticeResult[]> {
  const out: NoticeResult[] = [];
  for (const invite of invitesToTellClosed(rfq)) {
    const url = dealerQuoteUrl(invite);
    out.push(await sendThreadNotice(rfq, invite, "dealer", ({ unsubscribeUrl }) => (url ? buildBuyerClosedNotice({ dealerName: invite.dealerName, vehicle: inviteVehicleParts(rfq, invite), reference: inviteReference(rfq, invite), url, unsubscribeUrl }) : null), deps));
  }
  return out;
}

/** One chat message was delivered (the guard let it through): tell the other side that one is waiting, never what it says. */
export function notifyNewMessage(rfq: RfqRequest, invite: RfqInvite, to: "buyer" | "dealer", deps?: NoticeDeps): Promise<NoticeResult> {
  const dealerUrl = dealerQuoteUrl(invite);
  return sendThreadNotice(rfq, invite, to, ({ unsubscribeUrl }) => {
    const url = to === "buyer" ? buyerRfqUrl(rfq) : dealerUrl;
    return url ? buildNewMessageNotice({ to, dealerName: invite.dealerName, vehicle: inviteVehicleParts(rfq, invite), reference: inviteReference(rfq, invite), url, unsubscribeUrl }) : null;
  }, deps);
}
