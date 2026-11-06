/**
 * Dealer "My Quotes": the signed-in dealer's own invites, one row each, with a four-way status.
 * Pure and client-safe (no server secrets): the route supplies the dealer reference and the link.
 *
 *   needs_quoting  an invite with no quote yet, or one the buyer countered and reopened
 *   in_process     quoted, the request is open, nobody has been chosen
 *   awarded        the buyer picked this desk's quote / accepted its final deal
 *   not_awarded    the buyer chose another dealer, walked, or this desk declined / expired / walked
 *
 * There is deliberately no "Completed": dealers cannot mark a sale done and the app never learns it closed.
 * Copy rule: a request, not a bid.
 */
import { stageSummary, type DealStageState } from "./dealStages";

export type DealerQuoteStatus = "needs_quoting" | "in_process" | "awarded" | "not_awarded";

export const DEALER_QUOTE_STATUSES: ReadonlyArray<{ id: DealerQuoteStatus; label: string }> = [
  { id: "needs_quoting", label: "Needs quoting" },
  { id: "in_process", label: "In process" },
  { id: "awarded", label: "Awarded" },
  { id: "not_awarded", label: "Not awarded" },
];

export function dealerQuoteStatusLabel(status: DealerQuoteStatus): string {
  return DEALER_QUOTE_STATUSES.find((s) => s.id === status)?.label ?? "In process";
}

/** One invite as the box sends it (GET /api/dealer-invites). Facts only. */
export interface BoxDealerInvite {
  inviteId: string;
  rfqId: string;
  dealerName: string;
  /** Server-to-server only: turned into `url`, never forwarded. */
  viewToken: string | null;
  inviteStatus: "invited" | "quoted" | "declined" | "expired" | string;
  invitedAt: string | null;
  respondedAt: string | null;
  viewedAt: string | null;
  buyerCounterAt: string | null;
  hasBuyerCounter: boolean;
  notSelectedAt: string | null;
  dealerUnsubscribedAt: string | null;
  rfqStatus: "collecting" | "picked" | "walked" | string;
  pickedQuoteId: string | null;
  vehicle: { vin?: string; year?: number | string | null; make?: string | null; model?: string | null; trim?: string | null } | null;
  quote: { id: string; totalOtdPrice: number; submittedAt: string | null; supersededAt: string | null } | null;
  stage: DealStageState | null;
  audit: boolean;
  testDealer: boolean;
}

export interface DealerQuoteRow {
  inviteId: string;
  rfqId: string;
  /** The dealer's own number for this request (never the buyer's deal number). */
  reference: string;
  vehicle: string;
  quotedOtd: number | null;
  status: DealerQuoteStatus;
  statusLabel: string;
  /** One plain line on where the deal stands, when there is something to say. */
  detail: string | null;
  lastActivityAt: string | null;
  /** Opens the existing token quote page. Built on the server; the token is never a separate field. */
  url: string | null;
  /** True for a test-dealer account (shows the TEST badge). */
  test: boolean;
}

function ms(v: string | null | undefined): number {
  if (!v) return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

/** The buyer's counter is newer than this desk's quote: the invite is open for a revised quote. */
function counterReopened(i: BoxDealerInvite): boolean {
  return i.hasBuyerCounter && (!i.quote || ms(i.buyerCounterAt) > ms(i.quote.submittedAt));
}

function acceptedFinal(stage: DealStageState | null): boolean {
  return Boolean(stage && stage.final?.status === "accepted" && !stage.walk);
}

/** One status per invite. Order matters: an explicit "not selected" beats everything; a walk beats a win. */
export function deriveDealerQuoteStatus(i: BoxDealerInvite): DealerQuoteStatus {
  if (i.notSelectedAt) return "not_awarded";
  if (i.stage?.walk) return "not_awarded";
  const pickedHere = i.rfqStatus === "picked" && Boolean(i.quote) && i.pickedQuoteId === i.quote!.id;
  if (pickedHere || acceptedFinal(i.stage)) return "awarded";
  if (i.rfqStatus === "walked" || i.rfqStatus === "picked") return "not_awarded";
  if (i.inviteStatus === "declined" || i.inviteStatus === "expired") return "not_awarded";
  // The dealership opted out of TrimScout and never quoted: nothing will come of it.
  if (i.dealerUnsubscribedAt && !i.quote) return "not_awarded";
  if (i.inviteStatus === "invited" || counterReopened(i)) return "needs_quoting";
  return "in_process";
}

export function dealerQuoteLastActivity(i: BoxDealerInvite): string | null {
  const log = Array.isArray(i.stage?.log) ? i.stage!.log : [];
  const stamps = [
    i.invitedAt, i.viewedAt, i.respondedAt, i.buyerCounterAt, i.quote?.submittedAt, i.notSelectedAt, i.stage?.walk?.at,
    ...log.map((e) => (typeof e.at === "string" ? e.at : null)),
  ];
  let best = 0;
  let bestIso: string | null = null;
  for (const s of stamps) {
    const t = ms(s);
    if (t > best) { best = t; bestIso = s as string; }
  }
  return bestIso;
}

function vehicleText(v: BoxDealerInvite["vehicle"]): string {
  if (!v) return "Vehicle on request";
  const parts = [v.year, v.make, v.model, v.trim].map((p) => (p == null ? "" : String(p).trim())).filter(Boolean);
  return parts.length ? parts.join(" ") : "Vehicle on request";
}

function detailFor(i: BoxDealerInvite, status: DealerQuoteStatus): string | null {
  if (status === "needs_quoting") return counterReopened(i) && i.quote ? "The buyer sent a counter: revise your quote or reply." : "Waiting for your quote.";
  if (status === "not_awarded") return i.notSelectedAt || i.rfqStatus === "picked" ? "The buyer chose another dealer." : i.rfqStatus === "walked" || i.stage?.walk ? "This request is closed." : null;
  if (!i.stage) return status === "awarded" ? "The buyer chose your quote." : null;
  return stageSummary(i.stage, false);
}

export interface BuildDeps {
  reference(rfqId: string, inviteId: string): string;
}

const ORDER: Record<DealerQuoteStatus, number> = { needs_quoting: 0, in_process: 1, awarded: 2, not_awarded: 3 };

/** An audit request belongs to test dealers only: a real dealer's list never contains one. */
export function visibleToDealer(i: Pick<BoxDealerInvite, "audit" | "testDealer">): boolean {
  return !i.audit || i.testDealer;
}

export function buildDealerQuoteRows(invites: BoxDealerInvite[], deps: BuildDeps): DealerQuoteRow[] {
  const rows = invites.filter(visibleToDealer).map((i): DealerQuoteRow => {
    const status = deriveDealerQuoteStatus(i);
    return {
      inviteId: i.inviteId,
      rfqId: i.rfqId,
      reference: deps.reference(i.rfqId, i.inviteId),
      vehicle: vehicleText(i.vehicle),
      quotedOtd: i.quote && Number.isFinite(i.quote.totalOtdPrice) ? i.quote.totalOtdPrice : null,
      status,
      statusLabel: dealerQuoteStatusLabel(status),
      detail: detailFor(i, status),
      lastActivityAt: dealerQuoteLastActivity(i),
      url: i.viewToken ? `/quote-request/received?t=${encodeURIComponent(i.viewToken)}` : null,
      test: Boolean(i.testDealer),
    };
  });
  return rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || ms(b.lastActivityAt) - ms(a.lastActivityAt));
}

export function filterDealerQuotes(rows: DealerQuoteRow[], status: DealerQuoteStatus | "all"): DealerQuoteRow[] {
  return status === "all" ? rows : rows.filter((r) => r.status === status);
}

export function countByStatus(rows: DealerQuoteRow[]): Record<DealerQuoteStatus, number> {
  const out: Record<DealerQuoteStatus, number> = { needs_quoting: 0, in_process: 0, awarded: 0, not_awarded: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

/** The auth gate for every My Quotes route: a signed-in dealer account, nothing else (buyers, admins and guests get null). */
export function dealerSessionId(session: { user?: { id?: unknown; role?: unknown } | null } | null | undefined): string | null {
  const u = session?.user;
  if (!u || u.role !== "dealer") return null;
  return typeof u.id === "string" && u.id.trim() ? u.id : null;
}
