"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fmtMf, fmtMoney, fmtPct, type LeaseCompare as LeaseCompareData, type LeaseCompareRow } from "../lib/leaseCompare";
import { termMilesLabel } from "../lib/leaseQuote";
import type { BuyerCounter } from "../lib/rfq";
import { counterSummary } from "../lib/buyerCounter";
import { CounterSheetForm } from "./CounterSheetForm";
import { CounterComparison } from "./CounterComparison";
import type { CounterEditsPayload } from "../lib/buyerCounter";

/**
 * Deal page lease comparison: at a glance → one row per dealer in the same
 * columns → expand for the itemized detail → Choose / Walk away. Server-
 * computed eligibility (counters, expired, best) is rendered as given; no
 * composite rating, no prose, no dealer-site price, lease deals only.
 */
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
  const { rows, glance, prefs, counts } = data;
  const eligible = rows.filter((r) => r.kind === "eligible");
  const counters = rows.filter((r) => r.kind === "counter");
  const rest = rows.filter((r) => r.kind === "countered" || r.kind === "expired" || r.kind === "waiting" || r.kind === "declined");
  const anyQuote = counts.quoted > 0;

  return (
    <section className="space-y-4" data-testid="lease-compare">
      {/* 1 — at a glance */}
      <div className="grid gap-2 sm:grid-cols-3" data-testid="lease-glance">
        {glance.noEligible ? (
          <p className="sm:col-span-3 rounded-xl border border-border bg-surface px-4 py-3 text-xs text-ink-light" data-testid="glance-none">
            {glance.noEligible}
          </p>
        ) : (
          <>
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Lowest monthly</p>
              <p className="text-lg font-extrabold text-white tabular-nums">{fmtMoney(glance.lowestMonthly!.amount)}<span className="text-xs font-semibold text-ink-muted">/mo</span></p>
              <p className="text-[11px] text-ink-light">{glance.lowestMonthly!.dealerName}</p>
            </div>
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Lowest due at signing</p>
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

      {/* 2 — table */}
      {anyQuote || rest.length ? (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                <th className="sticky left-0 z-10 bg-surface px-3 py-2.5">Dealer</th>
                <th className="px-3 py-2.5">Monthly</th>
                <th className="px-3 py-2.5">Due at signing</th>
                <th className="px-3 py-2.5">Cap cost</th>
                <th className="px-3 py-2.5">MF (APR)</th>
                <th className="px-3 py-2.5">Residual %</th>
                <th className="px-3 py-2.5">Term / miles</th>
                <th className="px-3 py-2.5">Add-ons / incentives</th>
                <th className="px-3 py-2.5">Expires</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {eligible.map((r) => (
                <Row key={r.inviteId} r={r} open={!!open[r.inviteId]} toggle={() => setOpen((o) => ({ ...o, [r.inviteId]: !o[r.inviteId] }))} collecting={collecting} onPick={onPick} busy={busy} prefs={prefs} countering={countering === r.inviteId} onStartCounter={onCounter ? () => setCountering(r.inviteId) : undefined} onCancelCounter={() => setCountering(null)} onCounter={onCounter ? async (c) => { await onCounter(r.inviteId, c); setCountering(null); } : undefined} />
              ))}
              {counters.length ? (
                <tr className="bg-amber-950/10">
                  <td colSpan={10} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-300" data-testid="counter-divider">
                    Counters — differ from your {termMilesLabel(prefs.termMonths, prefs.milesPerYear)}
                  </td>
                </tr>
              ) : null}
              {counters.map((r) => (
                <Row key={r.inviteId} r={r} open={!!open[r.inviteId]} toggle={() => setOpen((o) => ({ ...o, [r.inviteId]: !o[r.inviteId] }))} collecting={collecting} onPick={onPick} busy={busy} prefs={prefs} countering={countering === r.inviteId} onStartCounter={onCounter ? () => setCountering(r.inviteId) : undefined} onCancelCounter={() => setCountering(null)} onCounter={onCounter ? async (c) => { await onCounter(r.inviteId, c); setCountering(null); } : undefined} />
              ))}
              {rest.map((r) => (
                <Row key={r.inviteId} r={r} open={!!open[r.inviteId]} toggle={() => setOpen((o) => ({ ...o, [r.inviteId]: !o[r.inviteId] }))} collecting={collecting} onPick={onPick} busy={busy} prefs={prefs} countering={countering === r.inviteId} onStartCounter={onCounter ? () => setCountering(r.inviteId) : undefined} onCancelCounter={() => setCountering(null)} onCounter={onCounter ? async (c) => { await onCounter(r.inviteId, c); setCountering(null); } : undefined} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* 5 — actions */}
      {collecting ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3">
          <p className="text-[11px] text-ink-muted">
            {counts.eligible > 0 ? "Choose a quote from the table, or walk away — nothing is binding until you sign with the dealer." : "Choose becomes available when a quote is current; you can walk away any time."}
          </p>
          <button type="button" onClick={onWalk} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="walk-away">
            Walk away from this request
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Row({ r, open, toggle, collecting, onPick, busy, prefs, countering, onStartCounter, onCancelCounter, onCounter }: { r: LeaseCompareRow; open: boolean; toggle: () => void; collecting: boolean; onPick: (id: string) => void; busy: boolean; prefs: LeaseCompareData["prefs"]; countering: boolean; onStartCounter?: () => void; onCancelCounter: () => void; onCounter?: (c: CounterEditsPayload) => Promise<void> }) {
  const l = r.lease;
  const muted = r.kind === "expired" || r.kind === "declined" || r.kind === "countered";
  const hi = "bg-emerald-500/10 font-extrabold text-emerald-300";
  const cell = (v: React.ReactNode, extra = "") => <td className={`px-3 py-2.5 align-top tabular-nums ${extra}`}>{v}</td>;
  const status =
    r.kind === "eligible" ? (r.picked ? <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300">Chosen</span> : <span className="text-[10px] text-ink-muted">Matches your ask</span>)
    : r.kind === "counter" ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-300">Counter</span>
    : r.kind === "expired" ? <span className="rounded bg-border px-1.5 py-0.5 text-[9px] font-bold uppercase text-ink-muted">Expired</span>
    : r.kind === "declined" ? <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-300">Declined</span>
    : r.kind === "countered" ? <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-300">Buyer countered</span>
    : <span className="rounded bg-border px-1.5 py-0.5 text-[9px] font-bold uppercase text-ink-muted">Waiting</span>;
  return (
    <>
      <tr className={`${muted ? "opacity-50" : ""} ${r.picked ? "bg-emerald-500/5" : ""}`} data-testid={`lease-row-${r.kind}`}>
        <td className="sticky left-0 z-10 bg-surface px-3 py-2.5 align-top">
          <button type="button" onClick={toggle} className="flex items-start gap-1.5 text-left" aria-expanded={open} disabled={!l}>
            {l ? (open ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" />) : <span className="w-3.5" />}
            <span>
              <span className="block text-sm font-bold text-white">{r.dealerName}</span>
              {r.contactName ? <span className="block text-[10px] text-ink-muted">{r.contactName}{r.emailMasked ? <span className="font-mono"> · {r.emailMasked}</span> : null}</span> : null}
              {r.chips.length ? (
                <span className="mt-1 flex flex-wrap gap-1">
                  {r.chips.map((c) => (
                    <span key={c} className="rounded bg-border px-1.5 py-0.5 text-[9px] font-semibold text-ink-light">{c}</span>
                  ))}
                </span>
              ) : null}
            </span>
          </button>
        </td>
        {cell(l ? <>{fmtMoney(r.monthly)}<span className="text-[10px] text-ink-muted">/mo</span></> : "—", r.bestMonthly ? hi : "")}
        {cell(fmtMoney(r.dueAtSigning), r.bestDas ? hi : "")}
        {cell(l ? fmtMoney(l.capCost) : "—")}
        {cell(l ? <span className="font-mono text-[11px]">{fmtMf(l.moneyFactor)}</span> : "—")}
        {cell(l ? fmtPct(l.residualPercent) : "—")}
        {cell(l ? <>{termMilesLabel(l.termMonths, l.milesPerYear)}{r.counterHow ? <span className="block text-[10px] text-amber-300">{r.counterHow}</span> : null}</> : "—", r.kind === "counter" ? "text-amber-200" : "")}
        {cell(
          l ? (
            l.addOns.length + l.incentives.length ? (
              <ul className="space-y-0.5 text-[10px] tabular-nums" data-testid="lease-row-lines">
                {l.addOns.map((x, i) => (<li key={`a${i}`} className="flex justify-between gap-3"><span className="text-amber-200">{x.name}</span><span className="text-amber-200">+{fmtMoney(x.amount)}</span></li>))}
                {l.incentives.map((x, i) => (<li key={`i${i}`} className="flex justify-between gap-3"><span className="text-ink-muted">{x.name}</span><span className="text-emerald-300">−{fmtMoney(x.amount)}</span></li>))}
              </ul>
            ) : (
              <span className="text-[10px] text-ink-faint">no add-ons</span>
            )
          ) : (
            "—"
          )
        )}
        {cell(r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "—", r.kind === "expired" ? "text-rose-300" : "")}
        <td className="px-3 py-2.5 align-top">
          <div className="flex flex-col items-start gap-1.5">
            {status}
            {r.revised ? <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-300">Revised</span> : null}
            {r.kind === "countered" && r.buyerCounter ? <span className="text-[10px] text-sky-200">You asked: {counterSummary(r.buyerCounter)}</span> : null}
            {collecting && l && (r.kind === "eligible" || r.kind === "counter") && r.quoteId ? (
              <>
                <button type="button" onClick={() => onPick(r.quoteId!)} disabled={busy} className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-extrabold text-black hover:bg-emerald-400 disabled:opacity-50" data-testid="choose-quote">
                  Choose this quote
                </button>
                {onStartCounter ? (
                  <button type="button" onClick={onStartCounter} disabled={busy || countering} className="rounded-lg border border-sky-500/50 px-2.5 py-1 text-[10px] font-bold text-sky-200 hover:bg-sky-500/10 disabled:opacity-50" data-testid="counter-quote">
                    Counter
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </td>
      </tr>
      {countering && l && r.quoteId && onCounter ? (
        <tr className="bg-background/60">
          <td colSpan={10} className="px-4 py-3">
            <CounterSheetForm dealerName={r.dealerName} quote={{ lease: l }} quoteId={r.quoteId} onSubmit={onCounter} onCancel={onCancelCounter} />
          </td>
        </tr>
      ) : null}
      {open && l ? (
        <tr className="bg-background/60" data-testid="lease-row-detail">
          <td colSpan={10} className="px-4 py-3">
            <div className="grid gap-4 text-[11px] text-ink-light sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Due at signing — itemized</p>
                <ul className="mt-1 space-y-0.5 tabular-nums">
                  <li className="flex justify-between"><span>First month</span><span>{fmtMoney(l.dueAtSigning.firstMonth)}</span></li>
                  <li className="flex justify-between"><span>Acquisition fee</span><span>{fmtMoney(l.dueAtSigning.acquisitionFee)}</span></li>
                  <li className="flex justify-between"><span>Cap reduction</span><span>{fmtMoney(l.dueAtSigning.capReduction)}</span></li>
                  <li className="flex justify-between"><span>Taxes</span><span>{fmtMoney(l.dueAtSigning.taxes)}</span></li>
                  {l.dueAtSigning.otherFees.map((f, i) => (
                    <li key={i} className="flex justify-between"><span>{f.name}</span><span>{fmtMoney(f.amount)}</span></li>
                  ))}
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
              <div className="space-y-2">
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
                  <p className="text-[10px] text-ink-faint">
                    Earlier version{r.priorQuotes.length === 1 ? "" : "s"}: {r.priorQuotes.map((q) => (q.lease ? `${fmtMoney(q.lease.monthlyPaymentPreTax)}/mo · ${termMilesLabel(q.lease.termMonths, q.lease.milesPerYear)}` : fmtMoney(q.price))).join(" → ")} (superseded)
                  </p>
                ) : null}
                {l.notes ? <p className="text-ink-muted">{l.notes}</p> : null}
                <p className="text-[10px] text-ink-faint">Good through {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "—"}</p>
              </div>
            </div>
            {r.buyerCounter?.sheet ? (
              <div className="mt-3 space-y-1" data-testid="lease-row-counter">
                <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Your counter, line by line — before vs after</p>
                <CounterComparison sheet={r.buyerCounter.sheet} />
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}
