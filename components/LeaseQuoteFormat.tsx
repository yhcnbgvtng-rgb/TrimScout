"use client";

import React from "react";
import { aprFromMoneyFactor, dueAtSigningTotal, isExpired, overMaxCashDue, termMilesLabel, type LeaseQuote, type LeaseRequestPrefs } from "../lib/leaseQuote";

export const AWAITING_DEALER_COPY = "Waiting on dealer — quote format below; numbers appear when they reply.";

const money = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? null : `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/**
 * The pricing format a dealer quotes in, on the buyer's invited-dealer
 * card — read-only. Before the dealer replies it's the empty scaffold
 * (every value "—", never $0); after, their calculator numbers fill it.
 * The buyer types nothing here.
 */
export function LeaseQuoteFormat({ lease, prefs }: { lease: LeaseQuote | null | undefined; prefs: LeaseRequestPrefs }) {
  const q = lease || null;
  // The term/miles row flags only term/miles; an over-cap due-at-signing is
  // called out on its own row, not blamed on the term.
  const counter = q ? q.termMonths !== prefs.termMonths || q.milesPerYear !== prefs.milesPerYear : false;
  const overCap = q ? overMaxCashDue(q.dueAtSigning, prefs) : false;
  const expired = q ? isExpired(q) : false;
  const cell = (v: string | null, cls = "") => (v == null ? <span className="text-ink-faint">—</span> : <span className={cls}>{v}</span>);
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Monthly (pre-tax)", value: cell(money(q?.monthlyPaymentPreTax, 2), "text-base font-extrabold text-white") },
    { label: "Monthly with est. tax", value: q ? (q.monthlyPaymentWithEstTax != null ? cell(money(q.monthlyPaymentWithEstTax, 2)) : <span className="text-ink-muted">tax estimated at signing</span>) : cell(null) },
    {
      label: "Due at signing",
      value: q ? (
        <details>
          <summary className={`cursor-pointer list-none font-bold ${overCap ? "text-amber-300" : "text-white"}`}>
            {money(dueAtSigningTotal(q.dueAtSigning), 2)}
            {overCap && prefs.maxCashDueAtSigning != null ? <span className="block text-[10px] font-bold text-amber-300">Over your ${prefs.maxCashDueAtSigning.toLocaleString()} max</span> : null}
          </summary>
          <ul className="mt-1 space-y-0.5 text-[10px] text-ink-muted tabular-nums">
            <li className="flex justify-between"><span>First month</span><span>{money(q.dueAtSigning.firstMonth, 2)}</span></li>
            <li className="flex justify-between"><span>Acquisition fee</span><span>{money(q.dueAtSigning.acquisitionFee, 2)}</span></li>
            <li className="flex justify-between"><span>Cap reduction</span><span>{money(q.dueAtSigning.capReduction, 2)}</span></li>
            <li className="flex justify-between"><span>Taxes</span><span>{money(q.dueAtSigning.taxes, 2)}</span></li>
            {q.dueAtSigning.otherFees.map((f, i) => (
              <li key={i} className="flex justify-between"><span>{f.name}</span><span>{money(f.amount, 2)}</span></li>
            ))}
          </ul>
        </details>
      ) : (
        <span className="text-ink-faint">— <span className="text-[10px]">(itemized: first month · acquisition · cap reduction · taxes · fees)</span></span>
      ),
    },
    { label: "Cap cost", value: cell(money(q?.capCost)) },
    { label: "Money factor (APR)", value: q ? cell(`${q.moneyFactor} ≈ ${aprFromMoneyFactor(q.moneyFactor)}% APR`, "font-mono") : cell(null) },
    { label: "Residual", value: q ? cell(`${q.residualPercent}% · ${money(q.residualAmount)}`) : cell(null) },
    {
      label: "Term / miles",
      value: q ? (
        <>
          <span className={counter ? "font-bold text-amber-300" : ""}>{termMilesLabel(q.termMonths, q.milesPerYear)}</span>
          {counter ? (
            <span className="block text-[10px] text-amber-300">
              Counter — you asked for {termMilesLabel(prefs.termMonths, prefs.milesPerYear)}
              {q.counter?.note ? `: “${q.counter.note}”` : ""}
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-ink-faint">— <span className="text-[10px]">(you asked for {termMilesLabel(prefs.termMonths, prefs.milesPerYear)})</span></span>
      ),
    },
    {
      label: "Incentives / add-ons",
      value: q
        ? [...q.incentives.map((x) => `−${money(x.amount)} ${x.name}`), ...q.addOns.map((x) => `+${money(x.amount)} ${x.name}`)].join(" · ") || <span className="text-ink-faint">none</span>
        : cell(null),
    },
    { label: "Good through", value: q ? <span className={expired ? "font-bold text-rose-300" : ""}>{expired ? "Expired " : ""}{new Date(q.expiresAt).toLocaleDateString()}</span> : cell(null) },
  ];
  return (
    <div className={`rounded-xl border border-border bg-background p-3 ${expired ? "opacity-60" : ""}`} data-testid={q ? "lease-quote-filled" : "lease-quote-awaiting"}>
      {!q ? <p className="mb-2 text-[11px] text-ink-muted">{AWAITING_DEALER_COPY}</p> : null}
      <dl className="divide-y divide-border/60">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-3 py-1.5">
            <dt className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{r.label}</dt>
            <dd className="text-right text-xs text-ink-light tabular-nums">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
