// Client for the RFQ ("invite dealers to quote") endpoints on the box's
// existing deals API (port 3004, same process as deal_requests/deal_bids
// — see scrapers/lightsail-crawler/src/deals_api_server.js). Same
// request/error pattern as lib/dealsApi.ts.
import { LIGHTSAIL_HOST } from "./lightsailClient";
import type { LeaseQuote, LeaseRequestPrefs } from "./leaseQuote";
import type { AlternateAsk, RfqLane } from "./alternateAsk";
import type { BuyerCounter } from "./rfq";
import type { DealStageState } from "./dealStages";
import type { DealerTradeAppraisal, TradeInRecord, TradePhoto, TradePhotoRequest } from "./trade/types";
import type { QuotePrefs, UsedQuote } from "./usedQuote";
import { serverSecret } from "./serverSecret";
import type { DealMessage, RfqDeclineReason, RfqInvite, RfqQuoteFee, RfqRequest } from "./rfq";

const DEALS_API_PORT = 3004;
const DEFAULT_TIMEOUT_MS = 8000;

export class RfqApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<any> {
  const apiKey = serverSecret("LIGHTSAIL_API_KEY");
  if (!apiKey) {
    throw new RfqApiError("RFQ backend is not configured (missing LIGHTSAIL_API_KEY)", 500);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`http://${LIGHTSAIL_HOST}:${DEALS_API_PORT}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Trimscout-Api-Key": apiKey,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    throw new RfqApiError(
      err instanceof Error && err.name === "AbortError" ? "RFQ request timed out" : "Could not reach RFQ service",
      503
    );
  } finally {
    clearTimeout(timeoutId);
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // no-op — handled by the !res.ok branch below
  }

  if (!res.ok) {
    throw new RfqApiError(json?.error || `RFQ request failed (${res.status})`, res.status);
  }
  return json;
}

export async function createRfq(input: {
  buyerUserId: string;
  vin: string;
  stockNumber?: string | null;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  vehicleTrim: string;
  mustHaves: { code: string; name: string; status: "hit" }[];
  packageKind?: "match" | "links";
  linkPastes?: Array<Record<string, unknown>>;
  dealReference?: string | null;
  leasePrefs?: LeaseRequestPrefs | null;
  quotePrefs?: QuotePrefs | null;
  /** The buyer's note to every quoting dealer — scrubbed of contact info before it gets here. */
  buyerNote?: string | null;
  /** Whether the buyer said a trade-in is coming (handled after the OTD price; never in the quote). */
  tradeInExpected?: boolean | null;
  /** same_spec (default) or alternate — the latter needs no VIN and carries the ask instead. */
  lane?: RfqLane;
  alternateAsk?: AlternateAsk | null;
  /** Buyer test mode: the box stores the row audit=1 (full key only). */
  buyerTestMode?: boolean;
}): Promise<RfqRequest> {
  const json = await request("POST", "/api/rfqs", input);
  return json.rfq as RfqRequest;
}

export async function getRfq(id: string): Promise<RfqRequest | null> {
  try {
    const json = await request("GET", `/api/rfqs/${id}`);
    return json.rfq as RfqRequest;
  } catch (err) {
    if (err instanceof RfqApiError && err.status === 404) return null;
    throw err;
  }
}

/** Buyer adjusting the lease ask before any dealer has looked. The box answers 409 once locked. */
export async function updateRfqLeasePrefs(rfqId: string, leasePrefs: LeaseRequestPrefs): Promise<RfqRequest> {
  const json = await request("PATCH", `/api/rfqs/${rfqId}/lease-prefs`, { leasePrefs });
  return json.rfq as RfqRequest;
}

/** Every buyer's requests, newest first — the admin desk only. Raw rows (tokens included); the admin route decides what to expose. */
export async function listAllRfqs(limit = 200): Promise<RfqRequest[]> {
  const json = await request("GET", `/api/rfqs?all=1&limit=${limit}`);
  return json.rfqs as RfqRequest[];
}

export async function listRfqsForBuyer(buyerUserId: string): Promise<RfqRequest[]> {
  const json = await request("GET", `/api/rfqs?buyerUserId=${encodeURIComponent(buyerUserId)}`);
  return json.rfqs as RfqRequest[];
}

export async function createRfqInvite(
  rfqId: string,
  input: {
    dealerName: string;
    dealerContactEmail?: string | null;
    desk?: { contactName: string; role: string; emailMasked: string; source: "directory" | "buyer" | "rooftop" };
    vehicle?: { vin: string; year: number; make: string; model: string; trim: string; vdpUrl: string | null };
  }
): Promise<RfqInvite> {
  const json = await request("POST", `/api/rfqs/${rfqId}/invites`, input);
  return json.invite as RfqInvite;
}

/** The admin gate: release, reject (reason required), or put back to pending (buyer resubmit). */
export async function setRfqApproval(rfqId: string, input: { decision: "approved" | "rejected" | "pending"; by?: string | null; reason?: string | null }): Promise<RfqRequest> {
  const json = await request("POST", `/api/rfqs/${rfqId}/approval`, input);
  return json.rfq as RfqRequest;
}

/** An admin correcting the quote sheet before release; 409 once released. */
export async function adminPatchRfq(rfqId: string, patch: Record<string, unknown> & { adminEdit?: { by?: string | null; summary: string } }): Promise<RfqRequest> {
  const json = await request("PATCH", `/api/rfqs/${rfqId}`, patch);
  return json.rfq as RfqRequest;
}

/** An admin dropping a dealer before release; 409 once released or sent. */
export async function deleteRfqInvite(rfqId: string, inviteId: string): Promise<RfqRequest> {
  const json = await request("DELETE", `/api/rfqs/${rfqId}/invites/${inviteId}`);
  return json.rfq as RfqRequest;
}

/** Every buyer's requests awaiting an admin decision, oldest first. */
export async function listPendingRfqs(limit = 200): Promise<RfqRequest[]> {
  const json = await request("GET", `/api/rfqs?all=1&approval=pending&limit=${limit}`);
  return (json.rfqs as RfqRequest[]) || [];
}

/** Advances an invite's delivery leg. The box logs the matching audit event. */
export async function markRfqInviteDelivery(
  rfqId: string,
  inviteId: string,
  status: "sent" | "viewed"
): Promise<RfqInvite> {
  const json = await request("POST", `/api/rfqs/${rfqId}/invites/${inviteId}/delivery`, { status });
  return json.invite as RfqInvite;
}

/**
 * The buyer accepted another dealer: close this desk's quote ("close", idempotent), take the one-time right to send the
 * not-selected note ("claim": atomic, claimed:true for exactly one caller), then stamp it ("sent") or hand the claim
 * back ("release") when the send failed. Needs the box patch scripts/box/2026-10-12-rfq-not-selected.sh.
 */
export async function markRfqInviteNotSelected(
  rfqId: string,
  inviteId: string,
  step: "close" | "claim" | "sent" | "release"
): Promise<{ claimed: boolean; invite: RfqInvite | null }> {
  const json = await request("POST", `/api/rfqs/${rfqId}/invites/${inviteId}/not-selected`, { step });
  return { claimed: Boolean(json.claimed), invite: (json.invite as RfqInvite) ?? null };
}

/** Resolves a tracked-link token to its invite, for the "viewed" event. */
export async function getRfqInviteByViewToken(token: string): Promise<{ rfqId: string; invite: RfqInvite } | null> {
  try {
    const json = await request("GET", `/api/rfq-invites/by-token/${encodeURIComponent(token)}`);
    return { rfqId: String(json.rfqId), invite: json.invite as RfqInvite };
  } catch (err) {
    if (err instanceof RfqApiError && err.status === 404) return null;
    throw err;
  }
}

/** The buyer's counter to one desk's quote — the box supersedes the quote and reopens the invite. */
export async function submitBuyerCounter(rfqId: string, inviteId: string, counter: BuyerCounter): Promise<RfqRequest> {
  const json = await request("POST", `/api/rfqs/${rfqId}/invites/${inviteId}/buyer-counter`, { counter });
  return json.rfq as RfqRequest;
}

/**
 * One action on a desk's staged Cash / Finance deal (rules: lib/dealStages.ts). Needs the box patch
 * scripts/box/2026-10-11-rfq-deal-stages.sh; on an unpatched box this 404s and is reported as "not available yet".
 */
export async function postDealStage(
  rfqId: string,
  inviteId: string,
  input: { action: Record<string, unknown>; actor: "buyer" | "dealer"; state?: string | null; buyerContact?: Record<string, string | null> }
): Promise<{ rfq: RfqRequest; stage: DealStageState }> {
  try {
    const json = await request("POST", `/api/rfqs/${rfqId}/invites/${inviteId}/stage`, input);
    return { rfq: json.rfq as RfqRequest, stage: json.stage as DealStageState };
  } catch (err) {
    if (err instanceof RfqApiError && err.status === 404 && err.message === "Not found") {
      throw new RfqApiError("The staged deal isn't available yet.", 503);
    }
    throw err;
  }
}

/**
 * Chat on a desk's thread: messages, the buyer's report, and the one deal event the app logs (a dealer's fee override). Needs the box
 * patches scripts/box/2026-10-11-rfq-messages.sh (+ 2026-10-12-rfq-chat-guard.sh for screening, strikes and the review queue); on an
 * unpatched box this 404s and is reported as "not available yet".
 */
export type ChatPostResult =
  | { status: "delivered"; rfq?: RfqRequest; message?: DealMessage }
  | { status: "blocked"; note: string; warning: string | null; attempts: number; paused: boolean; justPaused: boolean }
  | { status: "needs_review"; score?: number }
  | { status: "held"; note: string }
  | { status: "paused"; note: string };

const chatUnavailable = (err: unknown) => err instanceof RfqApiError && err.status === 404 && err.message === "Not found";

export async function postChatMessage(rfqId: string, inviteId: string, input: { from: "buyer" | "dealer"; text: string; aiVerdict?: "yes" | "no" | "unavailable" }): Promise<ChatPostResult> {
  try {
    const json = await request("POST", `/api/rfqs/${rfqId}/invites/${inviteId}/messages`, { kind: "message", ...input });
    // A box with only the earlier rfq-messages patch answers { rfq, message } with no status: that is a delivery.
    if (!json.status) return { status: "delivered", rfq: json.rfq as RfqRequest | undefined, message: json.message as DealMessage | undefined };
    return json as ChatPostResult;
  } catch (err) {
    if (chatUnavailable(err)) throw new RfqApiError("Messaging isn't available yet.", 503);
    throw err;
  }
}

/** The buyer flags a dealer message: it goes to the admin review queue. */
export async function reportChatMessage(rfqId: string, inviteId: string, messageId: string): Promise<{ duplicate: boolean }> {
  try {
    const json = await request("POST", `/api/rfqs/${rfqId}/invites/${inviteId}/messages`, { kind: "report", messageId });
    return { duplicate: Boolean(json.duplicate) };
  } catch (err) {
    if (chatUnavailable(err)) throw new RfqApiError("Reporting isn't available yet.", 503);
    throw err;
  }
}

/** Logs the dealer's fee override as a deal event (best effort at the call site). */
export async function postRfqMessage(rfqId: string, inviteId: string, input: { kind: "event"; type: "fee_override"; overrides: Array<Record<string, unknown>> }): Promise<void> {
  try {
    await request("POST", `/api/rfqs/${rfqId}/invites/${inviteId}/messages`, input);
  } catch (err) {
    if (chatUnavailable(err)) throw new RfqApiError("Messaging isn't available yet.", 503);
    throw err;
  }
}

/** Is this invite's dealer paused from chat? An unpatched box says no. */
export async function getChatPaused(rfqId: string, inviteId: string): Promise<boolean> {
  try {
    const json = await request("GET", `/api/rfqs/${rfqId}/invites/${inviteId}/chat-status`);
    return Boolean(json.paused);
  } catch {
    return false;
  }
}

export interface ChatReviewItem {
  id: number; rfqId: number; inviteId: number; sender: "buyer" | "dealer"; kind: "held" | "reported"; messageId: string | null;
  text: string; reason: string | null; reporter: string | null; createdAt: string; dealerName: string | null;
}
export interface ChatPause { id: number; dealerKey: string; pausedAt: string; reason: string | null }

export async function listChatReview(): Promise<ChatReviewItem[]> {
  const json = await request("GET", "/api/admin/chat-review");
  return (json.items as ChatReviewItem[]) || [];
}
export async function decideChatReview(id: number, decision: "release" | "block", by: string): Promise<{ status: string; dealerName: string | null; attempts: number | null; paused: boolean; justPaused: boolean }> {
  return (await request("POST", `/api/admin/chat-review/${id}`, { decision, by })) as never;
}
export async function listChatPauses(): Promise<ChatPause[]> {
  const json = await request("GET", "/api/admin/chat-pauses");
  return (json.pauses as ChatPause[]) || [];
}
export async function liftChatPause(dealerKey: string, by: string): Promise<void> {
  await request("POST", "/api/admin/chat-pauses/lift", { dealerKey, by });
}

/**
 * Trade-in endpoints — need the box patch scripts/box/2026-10-08-rfq-trade-in.sh; on an unpatched box they 404.
 * Only metadata travels here: photo bytes live in S3.
 */
export async function submitRfqTradeIn(rfqId: string, tradeIn: TradeInRecord): Promise<RfqRequest> {
  const json = await request("POST", `/api/rfqs/${rfqId}/trade-in`, { tradeIn });
  return json.rfq as RfqRequest;
}

/** Replace the request's photo list (buyer changed a photo after sending). `notify` lists invites owed one notice. */
export async function putRfqTradePhotos(rfqId: string, photos: TradePhoto[]): Promise<{ rfq: RfqRequest; notifyInviteIds: string[] }> {
  const json = await request("PUT", `/api/rfqs/${rfqId}/trade-in/photos`, { photos });
  return { rfq: json.rfq as RfqRequest, notifyInviteIds: (json.notifyInviteIds as string[]) || [] };
}

export async function submitTradeAppraisal(rfqId: string, inviteId: string, appraisal: DealerTradeAppraisal): Promise<void> {
  await request("POST", `/api/rfqs/${rfqId}/invites/${inviteId}/trade-appraisal`, { appraisal });
}

export async function submitTradePhotoRequest(rfqId: string, inviteId: string, photoRequest: TradePhotoRequest): Promise<void> {
  await request("POST", `/api/rfqs/${rfqId}/invites/${inviteId}/trade-photo-request`, { photoRequest });
}

/** Buyer replaced/added photos covering an open ask (or dismissed it): marks that desk's request fulfilled. */
export async function fulfilTradePhotoRequests(rfqId: string, slots: string[]): Promise<void> {
  await request("POST", `/api/rfqs/${rfqId}/trade-photo-requests/fulfil`, { slots });
}

export async function markTradeSeen(rfqId: string, inviteId: string): Promise<void> {
  await request("POST", `/api/rfqs/${rfqId}/invites/${inviteId}/trade-seen`, {});
}

export async function declineRfqInvite(
  rfqId: string,
  inviteId: string,
  declineReason: RfqDeclineReason
): Promise<RfqInvite> {
  const json = await request("POST", `/api/rfqs/${rfqId}/invites/${inviteId}/decline`, { declineReason });
  return json.invite as RfqInvite;
}

export async function submitRfqQuote(
  rfqId: string,
  inviteId: string,
  input: {
    price: number;
    fees: RfqQuoteFee[];
    vin: string;
    stockNumber?: string | null;
    expiresAt: string;
    mustHaveAcknowledgement: boolean;
    notes?: string | null;
    /** The validated lease calculator; stored whole on the box. */
    lease?: LeaseQuote | null;
    /** The validated used Finance / Cash sheet; stored whole on the box. */
    used?: UsedQuote | null;
  }
): Promise<void> {
  // The box returns the created quote alone; callers that need the
  // invite's refreshed status ("quoted") re-fetch the whole RFQ via
  // getRfq rather than reason about a partial shape here.
  await request("POST", `/api/rfqs/${rfqId}/invites/${inviteId}/quotes`, input);
}

export async function pickRfqQuote(rfqId: string, quoteId: string): Promise<RfqRequest> {
  const json = await request("POST", `/api/rfqs/${rfqId}/pick`, { quoteId });
  return json.rfq as RfqRequest;
}

export async function walkAwayFromRfq(rfqId: string): Promise<RfqRequest> {
  const json = await request("POST", `/api/rfqs/${rfqId}/walk`);
  return json.rfq as RfqRequest;
}
