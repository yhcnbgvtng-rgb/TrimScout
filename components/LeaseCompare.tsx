"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fmtMf, fmtMoney, fmtPct, type LeaseCompare as LeaseCompareData, type LeaseCompareRow } from "../lib/leaseCompare";
import { termMilesLabel } from "../lib/leaseQuote";

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
  busy,
}: {
  data: LeaseCompareData;
  collecting: boolean;
  onPick: (quoteId: string) => void;
  onWalk: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { rows, glance, prefs, counts } = data;
  const eligible = rows.filter((r) => r.kind === "eligible");
  const counters = rows.filter((r) => r.kind === "counter");
  const rest = rows.filter((r) => r.kind === "expired" || r.kind === "waiting" || r.kind === "declined");
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
                <th className="px-3 py-2.5">Expires</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {eligible.map((r) => (
                <Row key={r.inviteId} r={r} open={!!open[r.inviteId]} toggle={() => setOpen((o) => ({ ...o, [r.inviteId]: !o[r.inviteId] }))} collecting={collecting} onPick={onPick} busy={busy} />
              ))}
              {counters.length ? (
                <tr className="bg-amber-950/10">
                  <td colSpan={9} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-300" data-testid="counter-divider">
                    Counters — differ from your {termMilesLabel(prefs.termMonths, prefs.milesPerYear)}
                  </td>
                </tr>
              ) : null}
              {counters.map((r) => (
                <Row key={r.inviteId} r={r} open={!!open[r.inviteId]} toggle={() => setOpen((o) => ({ ...o, [r.inviteId]: !o[r.inviteId] }))} collecting={collecting} onPick={onPick} busy={busy} />
              ))}
              {rest.map((r) => (
                <Row key={r.inviteId} r={r} open={!!open[r.inviteId]} toggle={() => setOpen((o) => ({ ...o, [r.inviteId]: !o[r.inviteId] }))} collecting={collecting} onPick={onPick} busy={busy} />
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

function Row({ r, open, toggle, collecting, onPick, busy }: { r: LeaseCompareRow; open: boolean; toggle: () => void; collecting: boolean; onPick: (id: string) => void; busy: boolean }) {
  const l = r.lease;
  const muted = r.kind === "expired" || r.kind === "declined";
  const hi = "bg-emerald-500/10 font-extrabold text-emerald-300";
  const cell = (v: React.ReactNode, extra = "") => <td className={`px-3 py-2.5 align-top tabular-nums ${extra}`}>{v}</td>;
  const status =
    r.kind === "eligible" ? (r.picked ? <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300">Chosen</span> : <span className="text-[10px] text-ink-muted">Matches your ask</span>)
    : r.kind === "counter" ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-300">Counter</span>
    : r.kind === "expired" ? <span className="rounded bg-border px-1.5 py-0.5 text-[9px] font-bold uppercase text-ink-muted">Expired</span>
    : r.kind === "declined" ? <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-300">Declined</span>
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
        {cell(r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "—", r.kind === "expired" ? "text-rose-300" : "")}
        <td className="px-3 py-2.5 align-top">
          <div className="flex flex-col items-start gap-1.5">
            {status}
            {collecting && l && r.kind !== "expired" && r.quoteId ? (
              <button type="button" onClick={() => onPick(r.quoteId!)} disabled={busy} className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-extrabold text-black hover:bg-emerald-400 disabled:opacity-50" data-testid="choose-quote">
                Choose this quote
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {open && l ? (
        <tr className="bg-background/60" data-testid="lease-row-detail">
          <td colSpan={9} className="px-4 py-3">
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
                {l.notes ? <p className="text-ink-muted">{l.notes}</p> : null}
                <p className="text-[10px] text-ink-faint">Good through {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "—"}</p>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
