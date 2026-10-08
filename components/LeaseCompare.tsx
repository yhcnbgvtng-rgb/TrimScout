"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fmtMf, fmtMoney, fmtPct, type LeaseCompare as LeaseCompareData, type LeaseCompareRow } from "../lib/leaseCompare";
import { termMilesLabel } from "../lib/leaseQuote";
import { counterSummary } from "../lib/buyerCounter";
import { CounterSheetForm } from "./CounterSheetForm";
import { CounterComparison } from "./CounterComparison";
import { QuoteColumns, type QuoteColumn, type QuoteRowDef } from "./QuoteColumns";
import type { CounterEditsPayload } from "../lib/buyerCounter";

/**
 * Deal page lease comparison: at a glance → dealers as COLUMNS (one line item read
 * straight across) → expand a column for its itemized detail → Choose / Counter / Walk
 * away in that column's footer. Counters sit in their own block under the main table on
 * the same column grid. Server-computed eligibility is rendered as given; no composite
 * rating, no prose, no dealer-site price, lease deals only.
 */
export const LEASE_ROWS: QuoteRowDef[] = [
  { key: "monthly", label: "Monthly" },
  { key: "das", label: "Due at signing" },
  { key: "cap", label: "Cap cost" },
  { key: "mf", label: "MF (APR)" },
  { key: "residual", label: "Residual %" },
  { key: "term", label: "Term / miles" },
  { key: "addons", label: "Add-ons" },
  { key: "fees", label: "Fees" },
  { key: "tax", label: "Sales tax" },
  { key: "rebates", label: "Rebates / credits" },
  { key: "expires", label: "Expires" },
];

const badge = (cls: string, text: React.ReactNode, testId?: string) => <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${cls}`} data-testid={testId}>{text}</span>;

export function LeaseCompare({
  data,
  collecting,
  onPick,
  onWalk,
  onCounter,
  busy,
}: {
  data: LeaseCompareData;
  collecting: boolean;
  onPick: (quoteId: string) => void;
  onWalk: () => void;
  /** Buyer counter to one desk; resolves once the box has it. */
  onCounter?: (inviteId: string, counter: CounterEditsPayload) => Promise<void>;
  busy: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [countering, setCountering] = useState<string | null>(null);
  const { rows, glance, prefs, counts, lane, askSummary } = data;
  const eligible = rows.filter((r) => r.kind === "eligible" && (lane === "alternate" || !r.alternate));
  const alternates = lane === "alternate" ? [] : rows.filter((r) => r.kind === "eligible" && r.alternate);
  const counters = rows.filter((r) => r.kind === "counter");
  const rest = rows.filter((r) => r.kind === "countered" || r.kind === "expired" || r.kind === "waiting" || r.kind === "declined" || r.kind === "unsubscribed");
  const anyQuote = counts.quoted > 0;
  const mainRows = [...eligible, ...alternates, ...rest];
  const canAct = (r: LeaseCompareRow) => collecting && Boolean(r.lease) && (r.kind === "eligible" || r.kind === "counter") && Boolean(r.quoteId);
  const anyActions = rows.some(canAct);

  const toColumn = (r: LeaseCompareRow): QuoteColumn => {
    const l = r.lease;
    const muted = r.kind === "expired" || r.kind === "declined" || r.kind === "countered" || r.kind === "unsubscribed";
    const monthlyNote = r.chips.find((c) => /\/mo /.test(c)) || null;
    const dasNote = r.chips.find((c) => / at signing /.test(c)) || null;
    const statusNotes = r.chips.filter((c) => c !== monthlyNote && c !== dasNote);
    const status =
      r.kind === "eligible" ? (r.picked ? badge("bg-brand-500/15 text-brand-300", "Chosen") : <span className="text-[10px] text-ink-muted">{r.alternate && lane !== "alternate" ? "Different vehicle" : "Matches your ask"}</span>)
      : r.unsubscribed && r.kind === "counter" ? badge("bg-border text-ink-muted", "Unsubscribed — quote still valid", "unsub-chip")
      : r.kind === "counter" ? badge("bg-amber-500/15 text-amber-300", "Counter", "counter-badge")
      : r.kind === "expired" ? badge("bg-border text-ink-muted", "Expired")
      : r.kind === "declined" ? badge("bg-rose-500/15 text-rose-300", "Declined")
      : r.kind === "countered" ? badge("bg-sky-500/15 text-sky-300", "Buyer countered")
      : r.kind === "unsubscribed" ? badge("bg-border text-ink-muted", "Unsubscribed — won't reply", "unsub-chip")
      : badge("bg-border text-ink-muted", "Waiting");
    const isOpen = !!open[r.inviteId];
    const names = (items: { name: string; amount: number }[], sign = "") => items.length ? (
      <ul className="space-y-0.5 text-[11px]" data-testid="itemized-lines">
        {items.map((x, i) => (<li key={i} className="flex justify-between gap-2"><span className="min-w-0 text-ink-muted">{x.name}</span><span className="shrink-0">{sign}{fmtMoney(x.amount)}</span></li>))}
      </ul>
    ) : <span className="text-ink-muted">None</span>;
    const header = (
      <div className="space-y-1" data-testid={`lease-row-${r.kind}`}>
        <button type="button" onClick={() => setOpen((o) => ({ ...o, [r.inviteId]: !o[r.inviteId] }))} className="flex items-start gap-1.5 text-left" aria-expanded={isOpen} disabled={!l}>
          {l ? (isOpen ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" />) : null}
          <span className="min-w-0">
            <span className="block text-sm font-bold leading-snug text-white">{r.dealerName}</span>
            {r.contactName ? <span className="block text-[10px] text-ink-muted">{r.contactName}</span> : null}
            {r.alternate && r.quotedVin ? <span className="block font-mono text-[10px] text-sky-200">VIN {r.quotedVin}</span> : null}
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-1.5" data-testid="status-cell">
          {status}
          {r.alternate ? badge("bg-sky-500/15 text-sky-300", "Alternate vehicle", "alternate-badge") : null}
          {r.revised ? badge("bg-sky-500/15 text-sky-300", "Revised") : null}
        </div>
        {statusNotes.map((c) => <span key={c} className="block text-[10px] leading-snug text-ink-muted">{c}</span>)}
        {r.kind === "countered" && r.buyerCounter ? <span className="block text-[10px] leading-snug text-sky-200">You asked: {counterSummary(r.buyerCounter)}</span> : null}
        <span className={`block text-[10px] ${r.kind === "expired" ? "text-rose-300" : "text-ink-faint"}`}>{r.expiresAt ? `Expires ${new Date(r.expiresAt).toLocaleDateString()}` : "No quote yet"}</span>
      </div>
    );
    const cells: Record<string, React.ReactNode> = l ? {
      monthly: <><span className="text-base">{fmtMoney(r.monthly)}</span><span className="text-[10px] font-semibold text-ink-muted">/mo</span>{monthlyNote ? <span className="mt-1 block text-[10px] font-normal leading-snug text-ink-muted" data-testid="money-note">{monthlyNote}</span> : null}</>,
      das: <><span className="text-base">{fmtMoney(r.dueAtSigning)}</span>{r.chips.length && dasNote ? <span className="mt-1 block text-[10px] font-normal leading-snug text-ink-muted" data-testid="money-note">{dasNote}</span> : null}{l.addOns.length || l.incentives.length ? (
        <span className="mt-1 block text-[10px] font-normal leading-snug" data-testid="lines-summary">
          {l.addOns.length ? <span className="text-amber-200">{l.addOns.length} add-on{l.addOns.length === 1 ? "" : "s"} +{fmtMoney(l.addOns.reduce((t, x) => t + x.amount, 0))}</span> : null}
          {l.addOns.length && l.incentives.length ? <span className="text-ink-faint"> · </span> : null}
          {l.incentives.length ? <span className="text-brand-300">{l.incentives.length} incentive{l.incentives.length === 1 ? "" : "s"}</span> : null}
        </span>) : null}</>,
      cap: fmtMoney(l.capCost),
      mf: <span className="font-mono text-[11px]">{fmtMf(l.moneyFactor)}</span>,
      residual: fmtPct(l.residualPercent),
      term: <span className={r.kind === "counter" ? "text-amber-200" : ""}>{termMilesLabel(l.termMonths, l.milesPerYear)}{r.counterHow ? <span className="mt-1 block text-[10px] text-amber-300">{r.counterHow}</span> : null}</span>,
      addons: names(l.addOns, "+"),
      fees: (<ul className="space-y-0.5 text-[11px]" data-testid="itemized-lines">
        <li className="flex justify-between gap-2"><span className="text-ink-muted">Acquisition fee</span><span>{fmtMoney(l.dueAtSigning.acquisitionFee)}</span></li>
        {l.dueAtSigning.otherFees.map((f, i) => (<li key={i} className="flex justify-between gap-2"><span className="min-w-0 text-ink-muted">{f.name}</span><span className="shrink-0">{fmtMoney(f.amount)}</span></li>))}
      </ul>),
      tax: fmtMoney(l.dueAtSigning.taxes),
      rebates: names(l.incentives, "−"),
      expires: <span className={r.kind === "expired" ? "text-rose-300" : ""}>{r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "—"}</span>,
    } : {};
    const detail = isOpen && l ? (
      <div className="space-y-3" data-testid="lease-row-detail">
        {r.contactName || r.emailMasked ? <p className="text-[10px] text-ink-muted">Quoted by <span className="text-ink-light">{r.contactName || r.dealerName}</span>{r.emailMasked ? <span className="font-mono"> · {r.emailMasked}</span> : null}</p> : null}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Due at signing — itemized</p>
          <ul className="mt-1 space-y-0.5 tabular-nums">
            <li className="flex justify-between"><span>First month</span><span>{fmtMoney(l.dueAtSigning.firstMonth)}</span></li>
            <li className="flex justify-between"><span>Acquisition fee</span><span>{fmtMoney(l.dueAtSigning.acquisitionFee)}</span></li>
            <li className="flex justify-between"><span>Cap reduction</span><span>{fmtMoney(l.dueAtSigning.capReduction)}</span></li>
            <li className="flex justify-between"><span>Taxes</span><span>{fmtMoney(l.dueAtSigning.taxes)}</span></li>
            {l.dueAtSigning.otherFees.map((f, i) => (<li key={i} className="flex justify-between"><span>{f.name}</span><span>{fmtMoney(f.amount)}</span></li>))}
            <li className="flex justify-between border-t border-border/60 pt-1 font-bold text-white"><span>Total</span><span>{fmtMoney(r.dueAtSigning)}</span></li>
          </ul>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Cap cost ladder</p>
          <ul className="mt-1 space-y-0.5 tabular-nums">
            <li className="flex justify-between"><span>Net cap cost</span><span>{fmtMoney(l.capCost)}</span></li>
            <li className="flex justify-between"><span>Cap reduction</span><span>{fmtMoney(l.capReduction)}</span></li>
            <li className="flex justify-between"><span>Residual</span><span>{fmtPct(l.residualPercent)} · {fmtMoney(l.residualAmount)}</span></li>
            <li className="flex justify-between"><span>Money factor</span><span className="font-mono">{fmtMf(l.moneyFactor)}</span></li>
            <li className="flex justify-between"><span>Monthly with est. tax</span><span>{l.monthlyPaymentWithEstTax != null ? fmtMoney(l.monthlyPaymentWithEstTax) : "tax estimated at signing"}</span></li>
          </ul>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Incentives / add-ons</p>
          {l.incentives.length + l.addOns.length ? (
            <ul className="mt-1 space-y-0.5 tabular-nums">
              {l.incentives.map((x, i) => (<li key={`i${i}`} className="flex justify-between"><span>{x.name}</span><span>−{fmtMoney(x.amount)}</span></li>))}
              {l.addOns.map((x, i) => (<li key={`a${i}`} className="flex justify-between"><span>{x.name}</span><span>+{fmtMoney(x.amount)}</span></li>))}
            </ul>
          ) : <p className="mt-1 text-ink-faint">none</p>}
        </div>
        {r.counterNote ? <p className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-2 py-1.5 text-amber-100"><span className="font-bold">Counter note:</span> {r.counterNote}</p> : null}
        {r.buyerCounter ? <p className="rounded-lg border border-sky-500/30 bg-sky-950/20 px-2 py-1.5 text-sky-100"><span className="font-bold">Your counter{r.buyerCounter.sentAt ? ` (${new Date(r.buyerCounter.sentAt).toLocaleDateString()})` : ""}:</span> {counterSummary(r.buyerCounter)}{r.buyerCounter.note ? ` — “${r.buyerCounter.note}”` : ""}</p> : null}
        {r.priorQuotes.length ? (
          <p className="text-[10px] text-ink-faint" data-testid="prior-quotes">
            Earlier version{r.priorQuotes.length === 1 ? "" : "s"}: {r.priorQuotes.map((q) => (q.lease ? `${fmtMoney(q.lease.monthlyPaymentPreTax)}/mo · ${termMilesLabel(q.lease.termMonths, q.lease.milesPerYear)}` : fmtMoney(q.price))).join(" → ")} (superseded)
          </p>
        ) : null}
        {l.notes ? <p className="text-ink-muted">{l.notes}</p> : null}
        <p className="text-[10px] text-ink-faint">Good through {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "—"}</p>
        {r.buyerCounter?.sheet ? (
          <div className="space-y-1" data-testid="lease-row-counter">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Your counter, line by line — before vs after</p>
            <CounterComparison sheet={r.buyerCounter.sheet} compact />
          </div>
        ) : null}
      </div>
    ) : null;
    const footer = canAct(r) ? (
      <div className="flex flex-col items-stretch gap-1.5" data-testid="column-actions">
        <button type="button" onClick={() => onPick(r.quoteId!)} disabled={busy} className="rounded-lg bg-brand-500 px-3 py-1.5 text-[11px] font-extrabold text-black hover:bg-brand-400 disabled:opacity-50" data-testid="choose-quote">Choose this quote</button>
        <div className="grid grid-cols-2 gap-1.5">
        {onCounter && !r.unsubscribed ? (
          <button type="button" onClick={() => setCountering(r.inviteId)} disabled={busy || countering === r.inviteId} className="rounded-lg border border-sky-500/50 px-3 py-1.5 text-[11px] font-bold text-sky-200 hover:bg-sky-500/10 disabled:opacity-50" data-testid="counter-quote">Counter</button>
        ) : null}
        <button type="button" onClick={onWalk} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="walk-away">Walk away</button>
          </div>
      </div>
    ) : null;
    return {
      id: r.inviteId,
      kind: r.kind,
      header,
      cells,
      best: [r.bestMonthly ? "monthly" : "", r.bestDas ? "das" : ""].filter(Boolean),
      muted,
      picked: r.picked,
      footer,
      detail,
    };
  };

  const counteringRow = countering ? rows.find((r) => r.inviteId === countering) : null;

  return (
    <section className="space-y-4" data-testid="lease-compare" data-lane={lane}>
      {lane === "alternate" ? (
        <p className="rounded-xl border border-sky-500/30 bg-sky-950/20 px-4 py-2.5 text-[11px] text-sky-100" data-testid="alternate-lane-note">
          <span className="font-bold">Open to different vehicles.</span> You asked for {askSummary}. Every quote below is a dealer&apos;s proposal — the cards compare <span className="font-bold">among alternate quotes</span>; open a row to see which car each one is.
        </p>
      ) : null}
      {/* 1 — at a glance */}
      <div className="grid gap-2 sm:grid-cols-3" data-testid="lease-glance">
        {glance.noEligible ? (
          <p className="sm:col-span-3 rounded-xl border border-border bg-surface px-4 py-3 text-xs text-ink-light" data-testid="glance-none">
            {glance.noEligible}
          </p>
        ) : (
          <>
            <div className="rounded-xl border border-brand-500/40 bg-brand-500/5 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Lowest monthly{lane === "alternate" ? " · among alternate quotes" : ""}</p>
              <p className="text-lg font-extrabold text-white tabular-nums">{fmtMoney(glance.lowestMonthly!.amount)}<span className="text-xs font-semibold text-ink-muted">/mo</span></p>
              <p className="text-[11px] text-ink-light">{glance.lowestMonthly!.dealerName}</p>
            </div>
            <div className="rounded-xl border border-brand-500/40 bg-brand-500/5 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Lowest due at signing{lane === "alternate" ? " · among alternate quotes" : ""}</p>
              <p className="text-lg font-extrabold text-white tabular-nums">{fmtMoney(glance.lowestDas!.amount)}</p>
              <p className="text-[11px] text-ink-light">{glance.lowestDas!.dealerName}</p>
            </div>
            <div className={`rounded-xl border px-4 py-3 ${glance.watchOuts ? "border-amber-500/40 bg-amber-950/20" : "border-border bg-surface"}`}>
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Watch-outs</p>
              <p className="text-[11px] text-ink-light">{glance.watchOuts ? glance.watchOuts.replace(/^Watch-outs: /, "") : "None — every quote matches your ask and is current."}</p>
            </div>
          </>
        )}
        {glance.noEligible && glance.watchOuts ? <p className="sm:col-span-3 text-[11px] text-amber-200">{glance.watchOuts}</p> : null}
      </div>

      {/* 2 — dealers as columns */}
      {mainRows.length ? <QuoteColumns testId="lease-table" caption="Lease quotes, one column per dealer" rows={LEASE_ROWS} columns={mainRows.map(toColumn)} /> : null}

      {counters.length ? (
        <div className="space-y-1.5" data-testid="counters-block">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-300" data-testid="counter-divider">
            Counters — differ from your {termMilesLabel(prefs.termMonths, prefs.milesPerYear)}
          </p>
          <QuoteColumns testId="lease-counters-table" caption="Dealer counters to your term and miles" rows={LEASE_ROWS} columns={counters.map(toColumn)} />
        </div>
      ) : null}

      {alternates.length ? <p className="text-[10px] font-bold uppercase tracking-wide text-sky-300" data-testid="alternate-divider">Alternate vehicles proposed — a different car than you asked for; not ranked with the quotes above</p> : null}

      {counteringRow && counteringRow.lease && counteringRow.quoteId && onCounter ? (
        <CounterSheetForm dealerName={counteringRow.dealerName} quote={{ lease: counteringRow.lease }} quoteId={counteringRow.quoteId} onSubmit={async (c) => { await onCounter(counteringRow.inviteId, c); setCountering(null); }} onCancel={() => setCountering(null)} />
      ) : null}

      {/* actions live in each column footer; this bar only carries the walk-away when no column can act */}
      {collecting ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3">
          <p className="text-[11px] text-ink-muted">
            {counts.eligible > 0 ? "Choose a quote under its dealer, or walk away — nothing is binding until you sign with the dealer." : "Choose becomes available when a quote is current; you can walk away any time."}
          </p>
          {!anyActions ? (
            <button type="button" onClick={onWalk} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="walk-away">
              Walk away from this request
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
