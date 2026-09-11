// Types for the "invite dealers to quote" RFQ (phase 2). Deliberately NOT
// a reverse auction: the vehicle and must-haves are frozen once, at most
// RFQ_MAX_INVITES dealers are invited on that same car, each submits one
// structured quote, and the buyer picks or walks. No countdown, no rank,
// no binding SLA.
export const RFQ_MAX_INVITES = 3;

// "unknown" exists for a live adapter (e.g. MarketCheck NeoVIN) where an
// option's presence genuinely can't be confirmed from the data — never
// treated as a hit. The seed adapter never produces "unknown": its options
// list is the exhaustive confirmed set for that VIN, so absence there is a
// real "miss", not an unknown.
export type OptionMatchStatus = "hit" | "miss" | "unknown";

export interface RfqMustHave {
  code: string;
  name: string;
  status: OptionMatchStatus;
}

export type RfqStatus = "collecting" | "picked" | "walked";
export type RfqInviteStatus = "invited" | "quoted" | "declined" | "expired";
export type RfqDeclineReason = "soft_lead" | "wrong_car" | "options_mismatch" | "other";

export const RFQ_DECLINE_REASON_LABELS: Record<RfqDeclineReason, string> = {
  soft_lead: "Soft lead — buyer not ready",
  wrong_car: "Wrong car / already sold",
  options_mismatch: "Can't match the locked options",
  other: "Other",
};

export interface RfqQuoteFee {
  label: string;
  amount: number;
}

export interface RfqQuote {
  id: string;
  inviteId: string;
  dealerName: string;
  price: number;
  fees: RfqQuoteFee[];
  totalOtdPrice: number;
  vin: string;
  stockNumber: string | null;
  expiresAt: string;
  submittedAt: string;
  mustHaveAcknowledgement: boolean;
  notes: string | null;
}

export interface RfqInvite {
  id: string;
  dealerName: string;
  dealerContactEmail: string | null;
  status: RfqInviteStatus;
  declineReason: RfqDeclineReason | null;
  invitedAt: string;
  respondedAt: string | null;
  quote: RfqQuote | null;
  /** The named person this went to. Email is masked before it reaches the buyer. */
  desk?: { contactName: string; role: string; emailMasked: string; source: "directory" | "buyer" } | null;
  /** The car this desk is quoting — a link package has one per invite. */
  vehicle?: { vin: string; year: number; make: string; model: string; trim: string; vdpUrl: string | null } | null;
  /** Delivery leg of the audit trail: queued → sent → viewed. */
  deliveryStatus?: "queued" | "sent" | "viewed";
  queuedAt?: string | null;
  sentAt?: string | null;
  viewedAt?: string | null;
  /** Server-to-server only; stripped before any response to a browser. */
  viewToken?: string | null;
}

export interface RfqSpec {
  vin: string;
  stockNumber: string | null;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  vehicleTrim: string;
  mustHaves: RfqMustHave[];
}

export interface RfqRequest extends RfqSpec {
  id: string;
  buyerUserId: string;
  invites: RfqInvite[];
  status: RfqStatus;
  pickedQuoteId: string | null;
  createdAt: string;
  /** "match" = the factory-option match flow; "links" = the v1 core loop, pasted dealer links. */
  packageKind?: "match" | "links";
  /** What the buyer pasted and how each resolved — only on a "links" package. */
  linkPastes?: Array<Record<string, unknown>>;
  /** The TS-XXXXXX number the buyer saw on the review screen. */
  dealReference?: string | null;
}

// Logged verbatim to rfq_events on the box — no read endpoint, no
// dashboard. Scoring (response rate, spec integrity, quote completeness,
// buyer pick rate, time-to-first-quote) happens offline by querying that
// table directly; lib/rfqLogic.ts has the pure functions for that math.
export type RfqEventType =
  | "rfq_invited"
  | "invite_queued"
  | "invite_sent"
  | "invite_viewed"
  | "quote_received"
  | "quote_incomplete"
  | "buyer_picked"
  | "buyer_walked"
  | "desk_declined";

export interface RfqEventPayload {
  vin: string;
  stockNumber: string | null;
  mustHaves: RfqMustHave[];
  declineReason?: RfqDeclineReason;
  [key: string]: unknown;
}
