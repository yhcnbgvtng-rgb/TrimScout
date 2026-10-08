"use client";

import React, { useState } from "react";
import { CounterSheetForm } from "./CounterSheetForm";
import { CounterComparison } from "./CounterComparison";
import { QuoteColumns, type QuoteColumn, type QuoteRowDef } from "./QuoteColumns";
import { counterSummary, type CounterEditsPayload } from "../lib/buyerCounter";
import { alternateAskSummary, askedVinForInvite, distinctInviteVehicles, isAlternateQuote } from "../lib/alternateAsk";
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
  const lane = rfq.lane ?? "same_spec";
  const rows = rfq.invites.map((i) => ({ invite: i, used: i.quote?.used ?? null, alternate: Boolean(i.quote) && isAlternateQuote({ lane: rfq.lane, vin: askedVinForInvite(rfq, i) }, i.quote?.vin) }));
  // A request with several cars invites each dealer about its own car: the columns are different cars, not one car at several stores.
  const vehicles = distinctInviteVehicles(rfq);
  const multiCar = lane !== "alternate" && vehicles.length > 1;
  // Same-spec lane: a quote for a different VIN is an alternate — its own block, never ranked
  // with the same-spec quotes, never "best". Alternate lane: every quote is an alternate and
  // they are the set being compared.
  const liveAll = rows.filter((r) => r.used && !isExpired({ expiresAt: r.used.expiresAt }));
  const live = lane === "alternate" ? liveAll : liveAll.filter((r) => !r.alternate);
  const sideAlternates = lane === "alternate" ? [] : liveAll.filter((r) => r.alternate);
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
  const ordered = [...ranked, ...sideAlternates, ...rows.filter((r) => !live.includes(r) && !sideAlternates.includes(r))];
  const quoted = rows.filter((r) => r.used).length;
  const vin = rfq.invites[0]?.vehicle?.vin || rfq.vin;
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

  const anyMiles = rows.some((r) => r.used?.miles != null);
  const rowDefs: QuoteRowDef[] = [
    ...(finance ? [{ key: "monthly", label: "Monthly" }, { key: "cashdue", label: "Cash due at signing" }, { key: "apr", label: "APR · financed" }] : []),
    { key: "price", label: "Selling price" },
    { key: "fees", label: "Fees (named)" },
    { key: "tax", label: "Sales tax" },
    { key: "addons", label: "Add-ons" },
    { key: "rebates", label: "Rebates / credits" },
    ...(anyMiles ? [{ key: "miles", label: "Miles · CPO" }] : []),
    { key: "expires", label: "Expires" },
    ...(!finance ? [{ key: "otd", label: "Out the door", total: true }] : []),
  ];
  const isTax = (n: string) => /tax/i.test(n);
  const counteringRow = countering ? rows.find((r) => r.invite.id === countering) : null;
  const toColumn = ({ invite, used, alternate }: (typeof rows)[number]): QuoteColumn => {
    const expired = used ? isExpired({ expiresAt: used.expiresAt }) : false;
    const picked = Boolean(invite.quote && rfq.pickedQuoteId === invite.quote.id);
    const unsubscribed = Boolean(invite.dealerUnsubscribedAt);
    const chip = (cls: string, text: string, testId?: string) => <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${cls}`} data-testid={testId}>{text}</span>;
    const status = !used
      ? invite.status === "declined" ? chip("bg-rose-500/15 text-rose-300", "Declined")
        : unsubscribed ? chip("bg-border text-ink-muted", "Unsubscribed — won't reply", "unsub-chip")
        : chip("bg-border text-ink-muted", "Waiting")
      : expired ? chip("bg-border text-ink-muted", "Expired")
      : picked ? chip("bg-brand-500/15 text-brand-300", "Chosen")
      : unsubscribed ? chip("bg-border text-ink-muted", "Unsubscribed — quote still valid", "unsub-chip")
      : <span className="text-[10px] text-ink-muted">Quoted to your locks</span>;
    const fin = used?.kind === "finance" ? used : null;
    const excluded = alternate && lane !== "alternate";
    const best: string[] = [];
    if (used && !expired && !excluded) {
      if (fin && financeCashDue(fin) === bestCashDue) best.push("cashdue");
      if (fin && fin.monthlyPaymentPreTax === bestMonthly) best.push("monthly");
      if (used.kind === "cash" && cashOutTheDoor(used) === bestOtd) best.push("otd");
    }
    const taxLines = used ? used.dueAtSigning.filter((l) => isTax(l.name)) : [];
    const feeLines = used ? used.dueAtSigning.filter((l) => !isTax(l.name)) : [];
    const cells: Record<string, React.ReactNode> = used ? {
      price: fmtMoney(used.sellingPrice),
      fees: feeLines.length ? lines(dueAtSigningSum(feeLines), feeLines) : <span className="text-ink-muted">None</span>,
      tax: taxLines.length ? lines(dueAtSigningSum(taxLines), taxLines) : <span className="text-ink-muted">—</span>,
      addons: used.noAddOns || !used.addOns?.length ? <span className="text-ink-muted">None</span> : lines(dueAtSigningSum(used.addOns), used.addOns),
      rebates: used.rebates?.length ? lines(dueAtSigningSum(used.rebates), used.rebates, true) : <span className="text-ink-muted">—</span>,
      miles: used.miles != null ? <>{used.miles.toLocaleString()} mi{used.cpo ? <span className="block text-[10px] text-sky-300">CPO</span> : null}</> : "—",
      expires: <span className={expired ? "text-rose-300" : ""}>{new Date(used.expiresAt).toLocaleDateString()}</span>,
      ...(fin ? {
        monthly: <>{fmtMoney(fin.monthlyPaymentPreTax)}<span className="text-[10px] text-ink-muted">/mo</span>{fin.monthlyPaymentWithEstTax != null ? <span className="block text-[10px] text-ink-muted">{fmtMoney(fin.monthlyPaymentWithEstTax)}/mo with est. tax</span> : null}</>,
        cashdue: fmtMoney(financeCashDue(fin)),
        apr: <>{fmtPct(fin.apr)} · {fin.termMonths} mo<span className="block text-[10px] text-ink-muted">{fmtMoney(fin.amountFinanced)} financed{fin.lenderName ? ` · ${fin.lenderName}` : ""}</span></>,
      } : {}),
      ...(used.kind === "cash" ? { otd: fmtMoney(cashOutTheDoor(used)) } : {}),
    } : {};
    const header = (
      <div className="space-y-1" data-testid={`used-row-${!used ? "waiting" : expired ? "expired" : "quoted"}`}>
        <span className="block text-sm font-bold leading-snug text-white">{invite.dealerName}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {status}
          {alternate ? <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-300" data-testid="alternate-badge">Alternate vehicle{lane !== "alternate" ? " — not ranked" : ""}</span> : null}
        </div>
        {multiCar && invite.vehicle ? <span className="block text-[11px] font-semibold text-ink-light" data-testid="column-vehicle">{[invite.vehicle.year, invite.vehicle.make, invite.vehicle.model, invite.vehicle.trim].filter(Boolean).join(" ")}</span> : null}
        {invite.desk?.contactName ? <span className="block text-[10px] text-ink-muted">{invite.desk.contactName}{invite.desk.emailMasked ? <span className="font-mono"> · {invite.desk.emailMasked}</span> : null}</span> : null}
        {used?.stockNumber ? <span className="block text-[10px] text-ink-faint">stock {used.stockNumber}</span> : null}
        {invite.buyerCounter && invite.status === "invited" ? <span className="block text-[10px] text-sky-200">You countered: {counterSummary(invite.buyerCounter)}</span> : null}
        <span className={`block text-[10px] ${expired ? "text-rose-300" : "text-ink-faint"}`}>{used ? `Expires ${new Date(used.expiresAt).toLocaleDateString()}` : "No quote yet"}</span>
      </div>
    );
    const detail = invite.buyerCounter?.sheet && invite.status === "invited" ? (
      <div className="space-y-1" data-testid="used-row-counter">
        <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Your counter, line by line — before vs after</p>
        <CounterComparison sheet={invite.buyerCounter.sheet} compact />
      </div>
    ) : null;
    const footer = collecting && used && !expired && invite.quote ? (
      <div className="flex flex-col items-stretch gap-1.5" data-testid="column-actions">
        <button type="button" onClick={() => onPick(invite.quote!.id)} disabled={busy} className="rounded-lg bg-brand-500 px-3 py-1.5 text-[11px] font-extrabold text-black hover:bg-brand-400 disabled:opacity-50" data-testid="choose-quote">Choose this quote</button>
        <div className="grid grid-cols-2 gap-1.5">
        {onCounter && !unsubscribed ? (
          <button type="button" onClick={() => setCountering(invite.id)} disabled={busy || countering === invite.id} className="rounded-lg border border-sky-500/50 px-3 py-1.5 text-[11px] font-bold text-sky-200 hover:bg-sky-500/10 disabled:opacity-50" data-testid="counter-quote">Counter</button>
        ) : null}
        <button type="button" onClick={onWalk} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="walk-away">Walk away</button>
        </div>
      </div>
    ) : null;
    return { id: invite.id, kind: !used ? "waiting" : expired ? "expired" : "quoted", header, cells, best, muted: expired || invite.status === "declined" || (unsubscribed && !used), picked, footer, detail };
  };
  const anyActions = collecting && rows.some((r) => r.used && !isExpired({ expiresAt: r.used.expiresAt }) && r.invite.quote);

  return (
    <section className="space-y-3" data-testid="used-compare">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted">
        <span>
          {quoted} of {rows.length} dealer{rows.length === 1 ? "" : "s"} quoted ·{" "}
          {lane === "alternate" ? (
            <span data-testid="alternate-lane-note">open to different vehicles — you asked for <span className="text-ink-light">{alternateAskSummary(rfq.alternateAsk)}</span>; every quote is a dealer&apos;s proposal, compared among alternate quotes</span>
          ) : (
            multiCar ? (
              <span data-testid="multi-car-note">{vehicles.length} cars in this request — each dealer quotes its own car, named under the dealer. The totals compare different cars, so read price against the car.</span>
            ) : (
            <>same car in every column: VIN <span className="font-mono text-ink-light">{vin}</span>{rfq.stockNumber ? <> · stock {rfq.stockNumber}</> : null}{sideAlternates.length ? <span className="text-sky-200"> · {sideAlternates.length} alternate vehicle{sideAlternates.length === 1 ? "" : "s"} proposed, shown separately</span> : null}</>
            )
          )}
        </span>
        {finance ? <span>Your locks: {prefs.finance.termMonths} mo · {fmtMoney(prefs.finance.downPayment)} down · {prefs.finance.creditBand} credit · ZIP {prefs.finance.zip}</span> : <span>ZIP {prefs.cash.zip} (tax context)</span>}
      </div>

      {quoted === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-ink-light" data-testid="used-glance-none">
          Waiting on {rows.length} dealer{rows.length === 1 ? "" : "s"} — quotes appear here as they reply. Nothing you need to do.
        </p>
      ) : best ? (
        <div className="rounded-xl border border-brand-500/40 bg-brand-500/5 px-4 py-3" data-testid="used-glance-best">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{finance ? "Best on monthly, then cash due at signing" : "Lowest out the door"}</p>
          <p className="text-lg font-extrabold text-white tabular-nums">
            {finance && best.used!.kind === "finance" ? <>{fmtMoney(best.used!.monthlyPaymentPreTax)}<span className="text-xs font-semibold text-ink-muted">/mo · {fmtMoney(financeCashDue(best.used as UsedFinanceQuote))} due at signing</span></> : fmtMoney(cashOutTheDoor(best.used!))}
          </p>
          <p className="text-[11px] text-ink-light">{best.invite.dealerName}</p>
        </div>
      ) : (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-ink-light">Every quote has expired — ask a dealer to re-quote, or walk away.</p>
      )}

      <QuoteColumns testId="used-table" caption="Quotes, one column per dealer" rows={rowDefs} columns={ordered.map(toColumn)} />
      {counteringRow && counteringRow.used && counteringRow.invite.quote && onCounter ? (
        <CounterSheetForm dealerName={counteringRow.invite.dealerName} quote={{ used: counteringRow.used }} quoteId={counteringRow.invite.quote.id} onSubmit={async (c) => { await onCounter(counteringRow.invite.id, c); setCountering(null); }} onCancel={() => setCountering(null)} />
      ) : null}
      {collecting ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3">
          <p className="text-[11px] text-ink-muted">Choose a quote under its dealer, or walk away — nothing is binding until you sign with the dealer.</p>
          {!anyActions ? <button type="button" onClick={onWalk} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="walk-away">Walk away from this request</button> : null}
        </div>
      ) : null}
    </section>
  );
}
