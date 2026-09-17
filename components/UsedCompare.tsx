"use client";

import React, { useState } from "react";
import { CounterSheetForm } from "./CounterSheetForm";
import { CounterComparison } from "./CounterComparison";
import { counterSummary, type CounterEditsPayload } from "../lib/buyerCounter";
import { fmtMoney, fmtPct } from "../lib/leaseCompare";
import { cashOutTheDoor, compareFinanceQuotes, dueAtSigningSum, financeCashDue, type QuotePrefs, type UsedFinanceQuote, type UsedQuote } from "../lib/usedQuote";
import { isExpired } from "../lib/leaseQuote";
import type { RfqRequest } from "../lib/rfq";
import type { LineItem } from "../lib/leaseQuote";

/**
 * Finance / Cash compare — never the lease grid. Every row is the same
 * VIN and the same buyer locks, so the numbers line up. Finance ranks by
 * monthly first and cash due at signing second (down + fees + tax −
 * rebates) and always shows APR, amount financed and the itemized fees,
 * so a cheap monthly can't hide junk. Cash ranks by out the door.
 * Expired rows grey out; waiting rows show dashes.
 */
export function UsedCompare({ rfq, prefs, onPick, onWalk, onCounter, busy }: { rfq: RfqRequest; prefs: QuotePrefs; onPick: (quoteId: string) => void; onWalk: () => void; onCounter?: (inviteId: string, counter: CounterEditsPayload) => Promise<void>; busy: boolean }) {
  // Which row has the counter sheet open — one at a time.
  const [countering, setCountering] = useState<string | null>(null);
  const collecting = rfq.status === "collecting";
  const finance = prefs.quoteType === "finance";
  const rows = rfq.invites.map((i) => ({ invite: i, used: i.quote?.used ?? null }));
  const live = rows.filter((r) => r.used && !isExpired({ expiresAt: r.used.expiresAt }));
  const ranked = [...live].sort((a, b) =>
    finance && a.used!.kind === "finance" && b.used!.kind === "finance"
      ? compareFinanceQuotes(a.used as UsedFinanceQuote, b.used as UsedFinanceQuote)
      : cashOutTheDoor(a.used!) - cashOutTheDoor(b.used!)
  );
  const best = ranked[0] || null;
  const lowest = (pick: (u: UsedQuote) => number | null) => {
    const vals = live.map((r) => pick(r.used!)).filter((v): v is number => v != null);
    return vals.length ? Math.min(...vals) : null;
  };
  const bestMonthly = finance ? lowest((u) => (u.kind === "finance" ? u.monthlyPaymentPreTax : null)) : null;
  const bestCashDue = finance ? lowest((u) => (u.kind === "finance" ? financeCashDue(u) : null)) : null;
  const bestOtd = !finance ? lowest((u) => (u.kind === "cash" ? cashOutTheDoor(u) : null)) : null;
  const ordered = [...ranked, ...rows.filter((r) => !live.includes(r))];
  const quoted = rows.filter((r) => r.used).length;
  const vin = rfq.invites[0]?.vehicle?.vin || rfq.vin;
  const cell = (v: React.ReactNode, extra = "") => <td className={`px-3 py-2.5 align-top tabular-nums ${extra}`}>{v}</td>;
  const hi = "bg-emerald-500/10 font-extrabold text-emerald-300";
  // Every line is named, always visible — a buyer has to see WHAT a dealer is adding on, not just the total.
  const lines = (total: number, items: LineItem[] | undefined, negative = false) =>
    items && items.length ? (
      <div data-testid="itemized-lines">
        <span className="font-bold text-white">{negative ? "−" : ""}{fmtMoney(total)}</span>
        <ul className="mt-1 space-y-0.5 text-[10px] text-ink-light tabular-nums">
          {items.map((l, i) => (<li key={i} className="flex justify-between gap-3"><span className="text-ink-muted">{l.name}</span><span>{negative ? "−" : ""}{fmtMoney(l.amount)}</span></li>))}
        </ul>
      </div>
    ) : (
      <span className="font-bold text-white">{fmtMoney(total)}</span>
    );

  return (
    <section className="space-y-3" data-testid="used-compare">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted">
        <span>
          {quoted} of {rows.length} dealer{rows.length === 1 ? "" : "s"} quoted · same car on every row: VIN <span className="font-mono text-ink-light">{vin}</span>{rfq.stockNumber ? <> · stock {rfq.stockNumber}</> : null}
        </span>
        {finance ? <span>Your locks: {prefs.finance.termMonths} mo · {fmtMoney(prefs.finance.downPayment)} down · {prefs.finance.creditBand} credit · ZIP {prefs.finance.zip}</span> : <span>ZIP {prefs.cash.zip} (tax context)</span>}
      </div>

      {quoted === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-ink-light" data-testid="used-glance-none">
          Waiting on {rows.length} dealer{rows.length === 1 ? "" : "s"} — quotes appear here as they reply. Nothing you need to do.
        </p>
      ) : best ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-3" data-testid="used-glance-best">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{finance ? "Best on monthly, then cash due at signing" : "Lowest out the door"}</p>
          <p className="text-lg font-extrabold text-white tabular-nums">
            {finance && best.used!.kind === "finance" ? <>{fmtMoney(best.used!.monthlyPaymentPreTax)}<span className="text-xs font-semibold text-ink-muted">/mo · {fmtMoney(financeCashDue(best.used as UsedFinanceQuote))} due at signing</span></> : fmtMoney(cashOutTheDoor(best.used!))}
          </p>
          <p className="text-[11px] text-ink-light">{best.invite.dealerName}</p>
        </div>
      ) : (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-ink-light">Every quote has expired — ask a dealer to re-quote, or walk away.</p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead>
            <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-ink-faint">
              <th className="sticky left-0 z-10 bg-surface px-3 py-2.5">Dealer</th>
              {finance ? (
                <>
                  <th className="px-3 py-2.5">Monthly</th>
                  <th className="px-3 py-2.5">Cash due at signing</th>
                  <th className="px-3 py-2.5">APR · financed</th>
                </>
              ) : (
                <th className="px-3 py-2.5">Out the door</th>
              )}
              <th className="px-3 py-2.5">Selling price</th>
              <th className="px-3 py-2.5">Fees & tax</th>
              <th className="px-3 py-2.5">Add-ons</th>
              <th className="px-3 py-2.5">Rebates</th>
              {rows.some((r) => r.used?.miles != null) ? <th className="px-3 py-2.5">Miles · CPO</th> : null}
              <th className="px-3 py-2.5">Expires</th>
              <th className="px-3 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {ordered.map(({ invite, used }) => {
              const expired = used ? isExpired({ expiresAt: used.expiresAt }) : false;
              const picked = Boolean(invite.quote && rfq.pickedQuoteId === invite.quote.id);
              const status = !used
                ? invite.status === "declined" ? <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-300">Declined</span> : <span className="rounded bg-border px-1.5 py-0.5 text-[9px] font-bold uppercase text-ink-muted">Waiting</span>
                : expired ? <span className="rounded bg-border px-1.5 py-0.5 text-[9px] font-bold uppercase text-ink-muted">Expired</span>
                : picked ? <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300">Chosen</span>
                : <span className="text-[10px] text-ink-muted">Quoted to your locks</span>;
              const fin = used?.kind === "finance" ? used : null;
              const colCount = 8 + (finance ? 2 : 0) + (rows.some((r) => r.used?.miles != null) ? 1 : 0);
              return (
                <React.Fragment key={invite.id}>
                <tr className={`${expired || invite.status === "declined" ? "opacity-50" : ""} ${picked ? "bg-emerald-500/5" : ""}`} data-testid={`used-row-${!used ? "waiting" : expired ? "expired" : "eligible"}`}>
                  <td className="sticky left-0 z-10 bg-surface px-3 py-2.5 align-top">
                    <span className="block text-sm font-bold text-white">{invite.dealerName}</span>
                    {invite.desk?.contactName ? <span className="block text-[10px] text-ink-muted">{invite.desk.contactName}{invite.desk.emailMasked ? <span className="font-mono"> · {invite.desk.emailMasked}</span> : null}</span> : null}
                    {used?.stockNumber ? <span className="block text-[10px] text-ink-faint">stock {used.stockNumber}</span> : null}
                  </td>
                  {finance ? (
                    <>
                      {cell(fin ? <>{fmtMoney(fin.monthlyPaymentPreTax)}<span className="text-[10px] text-ink-muted">/mo</span>{fin.monthlyPaymentWithEstTax != null ? <span className="block text-[10px] text-ink-muted">{fmtMoney(fin.monthlyPaymentWithEstTax)} with est. tax</span> : <span className="block text-[10px] text-ink-muted">tax estimated at signing</span>}</> : "—", fin && !expired && fin.monthlyPaymentPreTax === bestMonthly ? hi : "")}
                      {cell(fin ? (
                        <div>
                          <span className="font-bold text-white">{fmtMoney(financeCashDue(fin))}</span>
                          <ul className="mt-1 space-y-0.5 text-[10px] text-ink-muted tabular-nums">
                            <li className="flex justify-between gap-3"><span>Down</span><span>{fmtMoney(fin.downPayment)}</span></li>
                            {fin.dueAtSigning.map((l, i) => (<li key={`f${i}`} className="flex justify-between gap-3"><span>{l.name}</span><span>{fmtMoney(l.amount)}</span></li>))}
                            {fin.addOns?.map((l, i) => (<li key={`a${i}`} className="flex justify-between gap-3"><span>{l.name} (add-on)</span><span>{fmtMoney(l.amount)}</span></li>))}
                            {fin.rebates?.map((l, i) => (<li key={`r${i}`} className="flex justify-between gap-3"><span>{l.name} (rebate)</span><span>−{fmtMoney(l.amount)}</span></li>))}
                          </ul>
                        </div>
                      ) : "—", fin && !expired && financeCashDue(fin) === bestCashDue ? hi : "")}
                      {cell(fin ? <>{fmtPct(fin.apr)} · {fin.termMonths} mo<span className="block text-[10px] text-ink-muted">{fmtMoney(fin.amountFinanced)} financed{fin.lenderName ? ` · ${fin.lenderName}` : ""}</span></> : "—")}
                    </>
                  ) : (
                    cell(used?.kind === "cash" ? fmtMoney(cashOutTheDoor(used)) : "—", used && !expired && used.kind === "cash" && cashOutTheDoor(used) === bestOtd ? hi : "")
                  )}
                  {cell(used ? fmtMoney(used.sellingPrice) : "—")}
                  {cell(used ? lines(dueAtSigningSum(used.dueAtSigning), used.dueAtSigning) : "—")}
                  {cell(used ? (used.noAddOns || !used.addOns?.length ? <span className="text-ink-muted">None</span> : lines(dueAtSigningSum(used.addOns), used.addOns)) : "—")}
                  {cell(used ? (used.rebates?.length ? lines(dueAtSigningSum(used.rebates), used.rebates, true) : <span className="text-ink-muted">—</span>) : "—")}
                  {rows.some((r) => r.used?.miles != null) ? cell(used?.miles != null ? <>{used.miles.toLocaleString()} mi{used.cpo ? <span className="block text-[10px] text-sky-300">CPO</span> : null}</> : "—") : null}
                  {cell(used ? new Date(used.expiresAt).toLocaleDateString() : "—", expired ? "text-rose-300" : "")}
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex flex-col items-start gap-1.5">
                      {status}
                      {invite.buyerCounter && invite.status === "invited" ? <span className="text-[10px] text-sky-200">You countered: {counterSummary(invite.buyerCounter)}</span> : null}
                      {collecting && used && !expired && invite.quote ? (
                        <>
                          <button type="button" onClick={() => onPick(invite.quote!.id)} disabled={busy} className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-extrabold text-black hover:bg-emerald-400 disabled:opacity-50" data-testid="choose-quote">Choose this quote</button>
                          {onCounter ? (
                            <button type="button" onClick={() => setCountering(invite.id)} disabled={busy || countering === invite.id} className="rounded-lg border border-sky-500/50 px-2.5 py-1 text-[10px] font-bold text-sky-200 hover:bg-sky-500/10 disabled:opacity-50" data-testid="counter-quote">Counter</button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {countering === invite.id && used && invite.quote && onCounter ? (
                  <tr className="bg-background/60">
                    <td colSpan={colCount} className="px-4 py-3">
                      <CounterSheetForm dealerName={invite.dealerName} quote={{ used }} quoteId={invite.quote.id} onSubmit={async (c) => { await onCounter(invite.id, c); setCountering(null); }} onCancel={() => setCountering(null)} />
                    </td>
                  </tr>
                ) : null}
                {invite.buyerCounter?.sheet && invite.status === "invited" ? (
                  <tr className="bg-background/60" data-testid="used-row-counter">
                    <td colSpan={colCount} className="px-4 py-3 space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Your counter to {invite.dealerName}, line by line — before vs after{invite.buyerCounter.note ? ` · “${invite.buyerCounter.note}”` : ""}</p>
                      <CounterComparison sheet={invite.buyerCounter.sheet} />
                    </td>
                  </tr>
                ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {collecting ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3">
          <p className="text-[11px] text-ink-muted">Choose a quote from the table, or walk away — nothing is binding until you sign with the dealer.</p>
          <button type="button" onClick={onWalk} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="walk-away">Walk away from this request</button>
        </div>
      ) : null}
    </section>
  );
}
