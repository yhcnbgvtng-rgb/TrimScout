/**
 * Lease quote comparison — the analysis behind the deal page's "at a
 * glance → table → detail" view. Pure over the RFQ's invites so the server
 * (GET /api/rfqs/:id) can attach it and stay the source of truth for
 * eligibility, and the client renders exactly that.
 *
 * Eligibility for "best": a quote that matches the buyer's term and miles
 * (not a counter) and hasn't expired. Counters never win "lowest"; expired
 * quotes never win anything. No composite score, no prose — derived
 * numbers only.
 */
import { aprFromMoneyFactor, dueAtSigningTotal, isCounter, isExpired, termMilesLabel, type LeaseQuote, type LeaseRequestPrefs } from "./leaseQuote";
import type { RfqInvite, RfqRequest } from "./rfq";

export type LeaseRowKind = "eligible" | "counter" | "expired" | "waiting" | "declined";

export interface LeaseCompareRow {
  inviteId: string;
  quoteId: string | null;
  dealerName: string;
  contactName: string | null;
  emailMasked: string | null;
  kind: LeaseRowKind;
  lease: LeaseQuote | null;
  monthly: number | null;
  dueAtSigning: number | null;
  /** One line on how a counter differs from the ask ("39 mo instead of 36"). */
  counterHow: string | null;
  counterNote: string | null;
  expiresAt: string | null;
  bestMonthly: boolean;
  bestDas: boolean;
  /** Auto math chips vs. the best eligible quote — derived from fields only. */
  chips: string[];
  picked: boolean;
}

export interface LeaseCompare {
  prefs: LeaseRequestPrefs;
  /** Eligible quotes, lowest monthly first; then counters; then expired; then waiting/declined. */
  rows: LeaseCompareRow[];
  glance: {
    lowestMonthly: { dealerName: string; amount: number; quoteId: string } | null;
    lowestDas: { dealerName: string; amount: number; quoteId: string } | null;
    /** Null when there's nothing to warn about. */
    watchOuts: string | null;
    /** Copy for the no-eligible-quotes case, or null when at least one is eligible. */
    noEligible: string | null;
  };
  counts: { quoted: number; eligible: number; counters: number; expired: number; waiting: number };
}

export const fmtMoney = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${Math.round(n).toLocaleString()}`);
export const fmtPct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`);
export const fmtMf = (mf: number | null | undefined) => (mf == null || !Number.isFinite(mf) ? "—" : `${mf.toFixed(Math.max(5, (String(mf).split(".")[1] || "").length))} ≈ ${aprFromMoneyFactor(mf)}% APR`);

/** "39 mo instead of 36" · "12,000 mi/yr instead of 10,000" — what a counter changed. */
export function counterHowLine(q: Pick<LeaseQuote, "termMonths" | "milesPerYear">, prefs: Pick<LeaseRequestPrefs, "termMonths" | "milesPerYear">): string | null {
  const parts: string[] = [];
  if (q.termMonths !== prefs.termMonths) parts.push(`${q.termMonths} mo instead of ${prefs.termMonths}`);
  if (q.milesPerYear !== prefs.milesPerYear) parts.push(`${q.milesPerYear.toLocaleString()} mi/yr instead of ${prefs.milesPerYear.toLocaleString()}`);
  return parts.length ? parts.join(" · ") : null;
}

function baseRow(invite: RfqInvite, rfq: RfqRequest): Omit<LeaseCompareRow, "kind" | "monthly" | "dueAtSigning" | "counterHow" | "counterNote" | "expiresAt"> {
  return {
    inviteId: invite.id,
    quoteId: invite.quote?.id ?? null,
    dealerName: invite.dealerName,
    contactName: invite.desk?.contactName ?? null,
    emailMasked: invite.desk?.emailMasked ?? null,
    lease: invite.quote?.lease ?? null,
    bestMonthly: false,
    bestDas: false,
    chips: [],
    picked: Boolean(invite.quote && rfq.pickedQuoteId === invite.quote.id),
  };
}

export function analyzeLeaseQuotes(rfq: RfqRequest, now: Date = new Date()): LeaseCompare | null {
  const prefs = rfq.leasePrefs;
  if (!prefs) return null;
  const rows: LeaseCompareRow[] = [];
  for (const invite of rfq.invites) {
    const lease = invite.quote?.lease ?? null;
    if (!lease) {
      rows.push({ ...baseRow(invite, rfq), kind: invite.status === "declined" ? "declined" : "waiting", monthly: null, dueAtSigning: null, counterHow: null, counterNote: null, expiresAt: null });
      continue;
    }
    const expired = isExpired(lease, now);
    const counter = isCounter(lease, prefs);
    rows.push({
      ...baseRow(invite, rfq),
      kind: expired ? "expired" : counter ? "counter" : "eligible",
      monthly: lease.monthlyPaymentPreTax,
      dueAtSigning: dueAtSigningTotal(lease.dueAtSigning),
      counterHow: counter ? counterHowLine(lease, prefs) : null,
      counterNote: counter && lease.counter?.note ? lease.counter.note : null,
      expiresAt: lease.expiresAt,
    });
  }

  const eligible = rows.filter((r) => r.kind === "eligible");
  const byMonthly = [...eligible].sort((a, b) => a.monthly! - b.monthly!);
  const byDas = [...eligible].sort((a, b) => a.dueAtSigning! - b.dueAtSigning!);
  const bestM = byMonthly[0] ?? null;
  const bestD = byDas[0] ?? null;
  if (bestM) bestM.bestMonthly = true;
  if (bestD) bestD.bestDas = true;

  // Chips: each eligible quote vs. the best eligible on the other axis / the runner-up.
  for (const r of eligible) {
    // Monthly chip first, then due-at-signing — wins phrased as "less", losses as "more".
    const chips: string[] = [];
    if (bestM && r === bestM && byMonthly[1]) chips.push(`${fmtMoney(byMonthly[1].monthly! - r.monthly!)}/mo less than ${byMonthly[1].dealerName}`);
    if (bestM && r !== bestM) chips.push(`${fmtMoney(r.monthly! - bestM.monthly!)}/mo more than ${bestM.dealerName}`);
    if (bestD && r === bestD && byDas[1]) chips.push(`${fmtMoney(byDas[1].dueAtSigning! - r.dueAtSigning!)} less at signing than ${byDas[1].dealerName}`);
    if (bestD && r !== bestD) chips.push(`${fmtMoney(r.dueAtSigning! - bestD.dueAtSigning!)} more at signing than ${bestD.dealerName}`);
    r.chips = chips;
  }
  for (const r of rows) {
    if (r.kind === "counter" && r.counterHow) r.chips = [`Counters to ${r.counterHow}`];
    if (r.kind === "expired") r.chips = ["Expired — ask the dealer to re-quote"];
  }

  const counters = rows.filter((r) => r.kind === "counter");
  const expiredRows = rows.filter((r) => r.kind === "expired");
  const waiting = rows.filter((r) => r.kind === "waiting");
  const declined = rows.filter((r) => r.kind === "declined");
  const ordered = [...byMonthly, ...counters.sort((a, b) => a.monthly! - b.monthly!), ...expiredRows, ...waiting, ...declined];

  const warn: string[] = [];
  if (counters.length) warn.push(`${counters.length} counter${counters.length === 1 ? "" : "s"} on term/miles`);
  if (expiredRows.length) warn.push(`${expiredRows.length} expired`);
  const quoted = eligible.length + counters.length + expiredRows.length;

  return {
    prefs,
    rows: ordered,
    glance: {
      lowestMonthly: bestM ? { dealerName: bestM.dealerName, amount: bestM.monthly!, quoteId: bestM.quoteId! } : null,
      lowestDas: bestD ? { dealerName: bestD.dealerName, amount: bestD.dueAtSigning!, quoteId: bestD.quoteId! } : null,
      watchOuts: warn.length ? `Watch-outs: ${warn.join(" · ")}.` : null,
      noEligible:
        eligible.length > 0
          ? null
          : quoted > 0
            ? `No quote matches your ${termMilesLabel(prefs.termMonths, prefs.milesPerYear)} yet — the ${counters.length ? "counters" : "quotes"} below differ from what you asked for.`
            : `Waiting on ${waiting.length} dealer${waiting.length === 1 ? "" : "s"} — quotes appear here as they reply.`,
    },
    counts: { quoted, eligible: eligible.length, counters: counters.length, expired: expiredRows.length, waiting: waiting.length },
  };
}
