"use client";

import React from "react";
import { aprFromMoneyFactor, dueAtSigningTotal, isCounter, isExpired, termMilesLabel, type LeaseRequestPrefs } from "../lib/leaseQuote";
import type { RfqInvite, RfqRequest } from "../lib/rfq";

/**
 * Side-by-side lease quotes: monthly · due at signing · cap cost · MF (APR)
 * · residual % · term/miles. A quote whose term or miles differ from the
 * buyer's prefs is flagged as a counter; an expired one is greyed and can't
 * be picked. Nothing here is a bid, and no dealer-site price appears.
 */
export function LeaseCompareTable({
  rfq,
  prefs,
  invites,
  onPick,
  picking,
}: {
  rfq: RfqRequest;
  prefs: LeaseRequestPrefs;
  invites: RfqInvite[];
  onPick: (quoteId: string) => void;
  picking: boolean;
}) {
  const quoted = invites.filter((i) => i.quote?.lease);
  if (quoted.length === 0) return null;
  const money = (n: number | null | undefined, digits = 0) =>
    n == null || !Number.isFinite(n) ? "—" : `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

  const rows: Array<{ label: string; cell: (i: RfqInvite) => React.ReactNode; strong?: boolean }> = [
    {
      label: "Monthly",
      strong: true,
      cell: (i) => {
        const l = i.quote!.lease!;
        return (
          <>
            <span className="text-base font-extrabold text-white">{money(l.monthlyPaymentPreTax)}</span>
            <span className="block text-[10px] text-ink-muted">
              {l.monthlyPaymentWithEstTax != null ? `${money(l.monthlyPaymentWithEstTax)} with est. tax` : "tax estimated at signing"}
            </span>
          </>
        );
      },
    },
    {
      label: "Due at signing",
      cell: (i) => {
        const d = i.quote!.lease!.dueAtSigning;
        return (
          <details>
            <summary className="cursor-pointer list-none font-bold text-white">{money(dueAtSigningTotal(d))}</summary>
            <ul className="mt-1 space-y-0.5 text-[10px] text-ink-muted">
              <li>First month {money(d.firstMonth)}</li>
              <li>Acquisition fee {money(d.acquisitionFee)}</li>
              <li>Cap reduction {money(d.capReduction)}</li>
              <li>Taxes {money(d.taxes)}</li>
              {d.otherFees.map((f, k) => (
                <li key={k}>
                  {f.name} {money(f.amount)}
                </li>
              ))}
            </ul>
          </details>
        );
      },
    },
    { label: "Cap cost", cell: (i) => money(i.quote!.lease!.capCost) },
    {
      label: "Money factor (APR)",
      cell: (i) => (
        <>
          <span className="font-mono">{i.quote!.lease!.moneyFactor}</span>
          <span className="block text-[10px] text-ink-muted">≈ {aprFromMoneyFactor(i.quote!.lease!.moneyFactor)}% APR</span>
        </>
      ),
    },
    {
      label: "Residual",
      cell: (i) => (
        <>
          {i.quote!.lease!.residualPercent}%<span className="block text-[10px] text-ink-muted">{money(i.quote!.lease!.residualAmount)}</span>
        </>
      ),
    },
    {
      label: "Term / miles",
      cell: (i) => {
        const l = i.quote!.lease!;
        const counter = isCounter(l, prefs);
        return (
          <>
            <span className={counter ? "font-bold text-amber-300" : ""}>{termMilesLabel(l.termMonths, l.milesPerYear)}</span>
            {counter ? (
              <span className="block text-[10px] text-amber-300">
                Counter — you asked for {termMilesLabel(prefs.termMonths, prefs.milesPerYear)}
                {l.counter?.note ? `: “${l.counter.note}”` : ""}
              </span>
            ) : null}
          </>
        );
      },
    },
    {
      label: "Incentives / add-ons",
      cell: (i) => {
        const l = i.quote!.lease!;
        const parts = [...l.incentives.map((x) => `−${money(x.amount)} ${x.name}`), ...l.addOns.map((x) => `+${money(x.amount)} ${x.name}`)];
        return parts.length ? <span className="text-[10px] text-ink-muted">{parts.join(" · ")}</span> : <span className="text-[10px] text-ink-faint">none</span>;
      },
    },
    {
      label: "Good through",
      cell: (i) => {
        const l = i.quote!.lease!;
        const expired = isExpired(l);
        return <span className={expired ? "text-rose-300 font-bold" : ""}>{expired ? "Expired " : ""}{new Date(l.expiresAt).toLocaleDateString()}</span>;
      },
    },
  ];

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface" data-testid="lease-compare">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">Lease quote</th>
            {quoted.map((i) => {
              const picked = rfq.pickedQuoteId === i.quote!.id;
              return (
                <th key={i.id} className={`px-3 py-2.5 align-top ${picked ? "bg-emerald-500/5" : ""}`}>
                  <div className="text-sm font-bold text-white">{i.dealerName}</div>
                  <div className="text-[10px] text-ink-muted">
                    {[i.desk?.contactName, i.desk?.role ? i.desk.role.replace(/_/g, " ") : null].filter(Boolean).join(" · ")}
                    {i.desk?.emailMasked ? <span className="font-mono"> · {i.desk.emailMasked}</span> : null}
                  </div>
                  {i.quote!.vin && i.quote!.vin !== rfq.vin ? <div className="text-[10px] font-bold text-rose-300">Different VIN: {i.quote!.vin}</div> : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint align-top">{r.label}</td>
              {quoted.map((i) => (
                <td key={i.id} className={`px-3 py-2.5 align-top text-ink-light ${rfq.pickedQuoteId === i.quote!.id ? "bg-emerald-500/5" : ""} ${isExpired(i.quote!.lease!) ? "opacity-60" : ""}`}>
                  {r.cell(i)}
                </td>
              ))}
            </tr>
          ))}
          {rfq.status === "collecting" ? (
            <tr>
              <td className="px-3 py-3" />
              {quoted.map((i) => {
                const expired = isExpired(i.quote!.lease!);
                return (
                  <td key={i.id} className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => onPick(i.quote!.id)}
                      disabled={picking || expired}
                      title={expired ? "This quote has expired — ask the dealer to re-quote." : undefined}
                      className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {expired ? "Expired" : "Choose this quote"}
                    </button>
                  </td>
                );
              })}
            </tr>
          ) : null}
          {rfq.status !== "collecting" ? (
            <tr>
              <td className="px-3 py-3" />
              {quoted.map((i) => (
                <td key={i.id} className="px-3 py-3 text-center text-[11px] font-bold">
                  {rfq.pickedQuoteId === i.quote!.id ? <span className="text-emerald-400">You chose this quote</span> : rfq.status === "walked" ? <span className="text-ink-muted">No quote chosen</span> : null}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
