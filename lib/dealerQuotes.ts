/**
 * Dealer "My Quotes": the signed-in dealer's own invites, one row per invite, with a status the SERVER derives.
 *
 * Rules (do not loosen without the owner):
 *  - Linked by dealerUserId on the invite (set once, by account id) — never by dealer-name match.
 *  - Four chips only: Needs quoting | In process | Awarded | Not awarded. There is no "Completed": a dealer cannot
 *    mark a deal completed, so the tracker cannot show one.
 *  - Only released requests; audit / forced-safe requests are hidden from real dealers and shown (badged TEST) to
 *    test-dealer accounts.
 *  - A row never carries the buyer: no name, email, phone, ZIP, buyer id, deal number. Stage data is read through
 *    stageForDealer (which only releases contact on the winning deal after the buyer accepts) and used for the
 *    last-activity time only — the row exposes none of it.
 *  - The row's link is the existing token quote page; the token is turned into a URL on the server and the bare
 *    token is never sent to the browser.
 */
import { dealerReference } from "./dealerReference";
import { stageForDealer } from "./dealStages";
import { vehicleTitle } from "./vehicleTitle";
import { cashOutTheDoor } from "./usedQuote";
import type { RfqInvite, RfqRequest } from "./rfq";

export const DEALER_QUOTE_STATUSES = ["needs_quoting", "in_process", "awarded", "not_awarded"] as const;
export type DealerQuoteStatus = (typeof DEALER_QUOTE_STATUSES)[number];

export const DEALER_QUOTE_STATUS_LABELS: Record<DealerQuoteStatus, string> = {
  needs_quoting: "Needs quoting",
  in_process: "In process",
  awarded: "Awarded",
  not_awarded: "Not awarded",
};

/** What the box's GET /api/dealer-invites returns per invite (server-to-server; never forwarded as-is). */
export interface DealerInviteRecord {
  rfqId: string;
  rfq: Pick<RfqRequest, "status" | "pickedQuoteId" | "approvalStatus" | "audit" | "auditForcedSafeMode" | "packageKind" | "vin" | "vehicleYear" | "vehicleMake" | "vehicleModel" | "vehicleTrim"> & { packageKind?: string };
  invite: RfqInvite;
}

/** The only shape that reaches a dealer's browser. */
export interface DealerQuoteRow {
  inviteId: string;
  status: DealerQuoteStatus;
  statusLabel: string;
  vehicle: string;
  dealerReference: string;
  /** The live quote's out-the-door total; null when there is none (or it is a lease, which has no single OTD). */
  quotedOtd: number | null;
  lastActivityAt: string | null;
  /** Test-dealer accounts only: this is an audit / test request. */
  test: boolean;
  /** The existing token quote page, built on the server. Null when the invite has no token. */
  viewUrl: string | null;
}

/** Released requests only. A row from a box that predates the gate (no approvalStatus) is not released. */
export function isReleasedToDealer(rec: Pick<DealerInviteRecord, "rfq">): boolean {
  return rec.rfq.approvalStatus === "approved";
}

export function isAuditRecord(rec: Pick<DealerInviteRecord, "rfq" | "invite">): boolean {
  return Boolean(rec.rfq.audit || rec.rfq.auditForcedSafeMode || (rec.invite as { audit?: boolean }).audit);
}

/**
 * Server-derived status. No "Completed": everything that has ended without this dealer winning is "Not awarded"
 * (the buyer picked someone else or walked, the desk declined, the invite expired, or the rooftop opted out).
 */
export function deriveDealerQuoteStatus(rec: Pick<DealerInviteRecord, "rfq" | "invite">): DealerQuoteStatus {
  const { rfq, invite } = rec;
  const quote = invite.quote && !invite.quote.supersededAt ? invite.quote : null;
  if (rfq.status === "picked" && quote && rfq.pickedQuoteId != null && String(rfq.pickedQuoteId) === String(quote.id)) return "awarded";
  if (invite.notSelectedAt) return "not_awarded";
  if (rfq.status === "picked" || rfq.status === "walked") return "not_awarded";
  if (invite.status === "declined" || invite.status === "expired") return "not_awarded";
  if (invite.dealerUnsubscribedAt && !quote) return "not_awarded";
  // Open request. A buyer counter reopens the invite (status back to "invited"), so it needs a new quote.
  if (invite.status === "invited" || !quote) return "needs_quoting";
  return "in_process";
}

function latest(...times: Array<string | null | undefined>): string | null {
  let best: { t: number; raw: string } | null = null;
  for (const raw of times) {
    if (!raw) continue;
    const t = Date.parse(raw);
    if (Number.isFinite(t) && (!best || t > best.t)) best = { t, raw };
  }
  return best ? new Date(best.t).toISOString() : null;
}

/** Newest dealer-visible event on the invite. Stage times come from the dealer-safe stage view only. */
export function dealerLastActivity(rec: Pick<DealerInviteRecord, "rfq" | "invite">): string | null {
  const { invite } = rec;
  const stage = stageForDealer(invite.stage ?? null, { notSelected: Boolean(invite.notSelectedAt) });
  const messages = Array.isArray(invite.messages) ? invite.messages : [];
  return latest(
    invite.invitedAt,
    invite.viewedAt,
    invite.respondedAt,
    invite.buyerCounterAt,
    invite.notSelectedAt,
    invite.quote?.submittedAt,
    ...messages.map((m) => m.at),
    stage?.otd?.lockedAt,
    stage?.trade?.lockedAt,
    ...(stage?.trade?.history || []).map((h) => h.at),
    stage?.release?.at,
    stage?.walk?.at
  );
}

/** Out-the-door total of the live quote, or null (no quote / lease). Used cash quotes use their own sheet total. */
export function dealerQuotedOtd(invite: Pick<RfqInvite, "quote">): number | null {
  const q = invite.quote && !invite.quote.supersededAt ? invite.quote : null;
  if (!q || q.lease) return null;
  if (q.used) return q.used.kind === "cash" ? cashOutTheDoor(q.used) : null;
  return Number.isFinite(q.totalOtdPrice) && q.totalOtdPrice > 0 ? q.totalOtdPrice : null;
}

function rowVehicle(rec: DealerInviteRecord): string {
  const v = rec.invite.vehicle;
  return vehicleTitle(
    v
      ? { vin: v.vin, year: v.year, make: v.make, model: v.model, trim: v.trim }
      : { vin: rec.rfq.vin, year: rec.rfq.vehicleYear, make: rec.rfq.vehicleMake, model: rec.rfq.vehicleModel, trim: rec.rfq.vehicleTrim }
  );
}

/** Needs quoting first, then in process, awarded, not awarded; newest activity first within a group. */
const STATUS_ORDER: Record<DealerQuoteStatus, number> = { needs_quoting: 0, in_process: 1, awarded: 2, not_awarded: 3 };
export function sortDealerQuoteRows<T extends Pick<DealerQuoteRow, "status" | "lastActivityAt">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    return (Date.parse(b.lastActivityAt || "") || 0) - (Date.parse(a.lastActivityAt || "") || 0);
  });
}

export function filterDealerQuoteRows<T extends Pick<DealerQuoteRow, "status">>(rows: T[], filter: DealerQuoteStatus | "all"): T[] {
  return filter === "all" ? rows : rows.filter((r) => r.status === filter);
}

export function dealerQuoteCounts(rows: Array<Pick<DealerQuoteRow, "status">>): Record<DealerQuoteStatus | "all", number> {
  const out: Record<DealerQuoteStatus | "all", number> = { all: rows.length, needs_quoting: 0, in_process: 0, awarded: 0, not_awarded: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

/**
 * Turns the box's invite records into the rows a dealer may see. `dealerTest` is derived on the server from the
 * session (lib/dealerTestMode.ts), never from the request. `viewUrlFor` receives the invite's token.
 */
export function buildDealerQuoteRows(
  records: DealerInviteRecord[],
  opts: { dealerTest: boolean; viewUrlFor: (token: string) => string; referenceSecret?: string }
): DealerQuoteRow[] {
  const rows: DealerQuoteRow[] = [];
  for (const rec of records) {
    if (!rec?.invite || !rec.rfq) continue;
    if (!isReleasedToDealer(rec)) continue;
    const audit = isAuditRecord(rec);
    if (audit && !opts.dealerTest) continue;
    const status = deriveDealerQuoteStatus(rec);
    const token = rec.invite.viewToken || "";
    rows.push({
      inviteId: String(rec.invite.id),
      status,
      statusLabel: DEALER_QUOTE_STATUS_LABELS[status],
      vehicle: rowVehicle(rec),
      dealerReference: dealerReference(String(rec.rfqId), String(rec.invite.id), opts.referenceSecret),
      quotedOtd: dealerQuotedOtd(rec.invite),
      lastActivityAt: dealerLastActivity(rec),
      test: audit,
      viewUrl: token ? opts.viewUrlFor(token) : null,
    });
  }
  return sortDealerQuoteRows(rows);
}
