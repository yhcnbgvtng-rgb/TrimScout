"use client";

import React, { useState } from "react";
import { CounterSheetForm } from "./CounterSheetForm";
import { CounterComparison } from "./CounterComparison";
import { QuoteColumns, type QuoteColumn, type QuoteRowDef } from "./QuoteColumns";
import { counterSummary, type CounterEditsPayload } from "../lib/buyerCounter";
import { alternateAskSummary, isAlternateQuote } from "../lib/alternateAsk";
import { fmtMoney, fmtPct } from "../lib/leaseCompare";
import { allowanceOf, applyToFinance, compareByOtdAfterThenEquity, otdBeforeAfter, tradeEquity, type TradeEquity } from "../lib/trade/otd";
import { BASIS_LABELS, TRADE_ESTIMATE_COPY } from "../lib/trade/types";
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
  const rows = rfq.invites.map((i) => ({ invite: i, used: i.quote?.used ?? null, alternate: Boolean(i.quote) && isAlternateQuote(rfq, i.quote?.vin) }));
  // Same-spec lane: a quote for a different VIN is an alternate — its own block, never ranked
  // with the same-spec quotes, never "best". Alternate lane: every quote is an alternate and
  // they are the set being compared.
  const liveAll = rows.filter((r) => r.used && !isExpired({ expiresAt: r.used.expiresAt }));
  const live = lane === "alternate" ? liveAll : liveAll.filter((r) => !r.alternate);
  const sideAlternates = lane === "alternate" ? [] : liveAll.filter((r) => r.alternate);
  // Trade-in lines (request-level trade, per-dealer appraisal). The dealer's own quote is never edited; the trade
  // sits beside it. TODO(tax): no trade-in tax credit; sales tax stays as each dealer quoted it on the full price.
  const trade = rfq.tradeIn ?? null;
  const eqOf = (r: { invite: (typeof rfq.invites)[number] }): TradeEquity => tradeEquity(Boolean(trade), trade?.payoffEstimate, r.invite.tradeAppraisal);
  const otdOf = (r: (typeof rows)[number]) => otdBeforeAfter(cashOutTheDoor(r.used!), eqOf(r));
  // Cash ranks on post-trade OTD (ties: more net equity), so a big trade offset by a higher price can't hide.
  // Finance keeps its monthly-first order, with the trade shown beside it.
  const ranked = [...live].sort((a, b) =>
    finance && a.used!.kind === "finance" && b.used!.kind === "finance"
      ? compareFinanceQuotes(a.used as UsedFinanceQuote, b.used as UsedFinanceQuote)
      : compareByOtdAfterThenEquity({ eq: eqOf(a), otdAfter: otdOf(a).after }, { eq: eqOf(b), otdAfter: otdOf(b).after })
  );
  const best = ranked[0] || null;
  const lowest = (pick: (u: UsedQuote, r: (typeof rows)[number]) => number | null) => {
    const vals = live.map((r) => pick(r.used!, r)).filter((v): v is number => v != null);
    return vals.length ? Math.min(...vals) : null;
  };
  const bestMonthly = finance ? lowest((u) => (u.kind === "finance" ? u.monthlyPaymentPreTax : null)) : null;
  const bestCashDue = finance ? lowest((u) => (u.kind === "finance" ? financeCashDue(u) : null)) : null;
  const bestOtd = !finance ? lowest((u, r) => (u.kind === "cash" ? otdOf(r).after : null)) : null;
  const bestAfter = finance && trade ? lowest((_u, r) => (eqOf(r).status === "quoted" ? otdOf(r).after : null)) : null;
  const quotedNets = trade ? live.map((r) => eqOf(r)).filter((e) => e.status === "quoted").map((e) => e.net as number) : [];
  const bestNet = quotedNets.length > 1 ? Math.max(...quotedNets) : null;
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
    ...(trade ? [{ key: "tradeallow", label: "Trade-in allowance" }, { key: "payoff", label: "Payoff to lender" }, { key: "netequity", label: "Net trade equity" }] : []),
    ...(anyMiles ? [{ key: "miles", label: "Miles · CPO" }] : []),
    { key: "expires", label: "Expires" },
    ...(trade
      ? [{ key: "otdbefore", label: "OTD before trade" }, ...(finance ? [{ key: "applied", label: "How equity is applied" }] : []), { key: "otdafter", label: "OTD after trade", total: true }]
      : !finance ? [{ key: "otd", label: "Out the door", total: true }] : []),
  ];
  const isTax = (n: string) => /tax/i.test(n);
  const counteringRow = countering ? rows.find((r) => r.invite.id === countering) : null;
  const toColumn = ({ invite, used, alternate }: (typeof rows)[number]): QuoteColumn => {
    const expired = used ? isExpired({ expiresAt: used.expiresAt }) : false;
    const picked = Boolean(invite.quote && rfq.pickedQuoteId === invite.quote.id);
    const unsubscribed = Boolean(invite.dealerUnsubscribedAt);
    const eq = eqOf({ invite });
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
      if (used.kind === "cash" && (trade ? otdBeforeAfter(cashOutTheDoor(used), eq).after : cashOutTheDoor(used)) === bestOtd) best.push(trade ? "otdafter" : "otd");
      if (trade && eq.status === "quoted" && bestNet != null && eq.net === bestNet) best.push("netequity");
      if (trade && finance && eq.status === "quoted" && bestAfter != null && otdBeforeAfter(cashOutTheDoor(used), eq).after === bestAfter) best.push("otdafter");
    }
    const otd = used ? otdBeforeAfter(cashOutTheDoor(used), eq) : null;
    const tradeCells: Record<string, React.ReactNode> = trade ? {
      tradeallow: eq.status === "quoted" && eq.allowance
        ? <div data-testid="trade-allowance"><span className="font-bold text-white">{eq.allowance.isRange ? `${fmtMoney(eq.allowance.low)} to ${fmtMoney(eq.allowance.high)}` : fmtMoney(eq.allowance.mid)}</span>
            <span className={`mt-1 block text-[10px] font-bold uppercase ${eq.basis === "firm" ? "text-emerald-300" : "text-amber-200"}`} data-testid="trade-basis">{BASIS_LABELS[eq.basis!]}</span>
            <span className="block text-[10px] font-normal text-ink-muted">good until {new Date(eq.goodUntil!).toLocaleDateString()}</span></div>
        : eq.status === "expired" ? <span className="font-bold text-rose-300" data-testid="trade-expired">Trade value expired</span>
        : <span className="font-bold text-amber-200" data-testid="trade-pending">Trade value pending</span>,
      payoff: eq.payoff ? fmtMoney(eq.payoff) : <span className="text-ink-muted">None</span>,
      netequity: eq.status !== "quoted" ? <span className="text-ink-muted">—</span>
        : <span className={eq.negative ? "font-bold text-rose-300" : "font-bold text-emerald-300"} data-testid={eq.negative ? "negative-equity" : "positive-equity"}>
            {eq.negative ? "−" : "+"}{fmtMoney(Math.abs(eq.net!))}
            {eq.allowance?.isRange ? <span className="block text-[10px] font-normal text-ink-muted">{fmtMoney(eq.netLow!)} to {fmtMoney(eq.netHigh!)}</span> : null}
            {eq.negative ? <span className="block text-[10px] font-bold uppercase">Negative equity</span> : null}
          </span>,
      ...(used ? {
        otdbefore: fmtMoney(otd!.before),
        otdafter: <>
          {fmtMoney(otd!.after)}
          {eq.status === "quoted" && eq.allowance?.isRange ? <span className="block text-[10px] font-normal text-ink-muted">{fmtMoney(otd!.afterLow)} to {fmtMoney(otd!.afterHigh)}</span> : null}
          {eq.status !== "quoted" ? <span className="block text-[10px] font-normal text-ink-muted" data-testid="otd-trade-note">{eq.status === "expired" ? "trade expired; not applied" : "trade pending; not applied"}</span> : null}
        </>,
        ...(used.kind === "finance" ? { applied: (() => {
          const a = applyToFinance(eq, used.amountFinanced);
          return a.how === "none" ? <span className="text-ink-muted">{eq.status === "quoted" ? "No equity to apply" : "—"}</span>
            : <span data-testid="equity-applied">{a.label}: {fmtMoney(a.amount)}<span className="block text-[10px] text-ink-muted">amount financed {fmtMoney(used.amountFinanced)} → {fmtMoney(a.adjusted)} (your monthly is the dealer&apos;s, not recomputed)</span></span>;
        })() } : {}),
      } : {}),
    } : {};
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
      ...(used.kind === "cash" && !trade ? { otd: fmtMoney(cashOutTheDoor(used)) } : {}),
      ...tradeCells,
    } : { ...tradeCells };
    const header = (
      <div className="space-y-1" data-testid={`used-row-${!used ? "waiting" : expired ? "expired" : "quoted"}`}>
        <span className="block text-sm font-bold leading-snug text-white">{invite.dealerName}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {status}
          {alternate ? <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-300" data-testid="alternate-badge">Alternate vehicle{lane !== "alternate" ? " — not ranked" : ""}</span> : null}
        </div>
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
            <>same car in every column: VIN <span className="font-mono text-ink-light">{vin}</span>{rfq.stockNumber ? <> · stock {rfq.stockNumber}</> : null}{sideAlternates.length ? <span className="text-sky-200"> · {sideAlternates.length} alternate vehicle{sideAlternates.length === 1 ? "" : "s"} proposed, shown separately</span> : null}</>
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
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{finance ? "Best on monthly, then cash due at signing" : trade ? "Lowest out the door after trade" : "Lowest out the door"}</p>
          <p className="text-lg font-extrabold text-white tabular-nums">
            {finance && best.used!.kind === "finance" ? <>{fmtMoney(best.used!.monthlyPaymentPreTax)}<span className="text-xs font-semibold text-ink-muted">/mo · {fmtMoney(financeCashDue(best.used as UsedFinanceQuote))} due at signing</span></> : fmtMoney(otdOf(best).after)}
          </p>
          <p className="text-[11px] text-ink-light">{best.invite.dealerName}</p>
        </div>
      ) : (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-ink-light">Every quote has expired — ask a dealer to re-quote, or walk away.</p>
      )}

      {trade ? <p className="text-[11px] text-ink-muted" data-testid="trade-estimate-copy">{TRADE_ESTIMATE_COPY} Sales tax is as each dealer quoted it, on the full price.</p> : null}
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
