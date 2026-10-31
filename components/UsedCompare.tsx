"use client";

import React, { useState } from "react";
import { CounterSheetForm } from "./CounterSheetForm";
import { CounterComparison } from "./CounterComparison";
import { QuoteColumns, type QuoteColumn, type QuoteRowDef } from "./QuoteColumns";
import { counterSummary, type CounterEditsPayload } from "../lib/buyerCounter";
import { alternateAskSummary, askedVinForInvite, distinctInviteVehicles, isAlternateQuote } from "../lib/alternateAsk";
import { fmtMoney, fmtPct } from "../lib/leaseCompare";
import { applyToFinance, compareByOtdAfterThenEquity, otdBeforeAfter, tradeEquity, type TradeEquity } from "../lib/trade/otd";
import { TRADE_ESTIMATE_COPY } from "../lib/trade/types";
import { appraisalForCompare } from "../lib/trade/confirm";
import { bestDeal, financeAfterTrade, orderDesks, tradeEligible, type TradeSortMode } from "../lib/trade/rank";
import { RevisedNote, TradeAllowanceCell, TradeSortToggle } from "./trade/TradeCompareCells";
import { compareCashQuotes, msrpDiscount, otdExcludingAddOns } from "../lib/cashCompare";
import { cashOutTheDoor, compareFinanceQuotes, isCountyTaxSurcharge, surchargeLabel, dueAtSigningSum, financeCashDue, type QuotePrefs, type UsedCashQuote, type UsedFinanceQuote, type UsedQuote } from "../lib/usedQuote";
import { isExpired } from "../lib/leaseQuote";
import { waitingDeliveryLabel } from "../lib/quotePackage";
import type { RfqRequest } from "../lib/rfq";
import type { LineItem } from "../lib/leaseQuote";
import { stageOf } from "../lib/dealStages";
import { DealerAdjustedFlag } from "./DealerAdjustedFlag";
import { activeOverrides } from "../lib/feeOverride";
import { CONTACT_SHARED_LINE } from "../lib/acceptShare";
import { ACCEPT_ORIGINAL_LABEL, COUNTER_DECLINED_NOTE, COUNTER_DECLINED_STATUS } from "../lib/counterDeclined";
import { vehicleTitle } from "../lib/vehicleTitle";

/**
 * Finance / Cash compare — never the lease grid. Every row is the same
 * VIN and the same buyer locks, so the numbers line up. Finance ranks by
 * monthly first and cash due at signing second (down + fees + tax −
 * rebates) and always shows APR, amount financed and the itemized fees,
 * so a cheap monthly can't hide junk. Cash ranks by out the door.
 * Expired rows grey out; waiting rows show dashes.
 */
export function UsedCompare({ rfq, prefs, staged = false, initialSort = "post_trade", onPick, onWalk, onCounter, busy }: { rfq: RfqRequest; prefs: QuotePrefs; /** Cash / Finance stages: accepting, the trade-in and payment live in the steps above, so no shortcut pick or request-level walk here. */ staged?: boolean; /** Which order the table opens in (the buyer can switch). */ initialSort?: TradeSortMode; onPick: (quoteId: string) => void; onWalk: () => void; onCounter?: (inviteId: string, counter: CounterEditsPayload) => Promise<void>; busy: boolean }) {
  // Which row has the counter sheet open — one at a time.
  const [countering, setCountering] = useState<string | null>(null);
  // With a trade the table orders on what the buyer pays after it; "Vehicle OTD only" ignores the trade for ordering.
  const [sort, setSort] = useState<TradeSortMode>(initialSort);
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
  // Trade-in lines (request-level trade, per-dealer appraisal). The dealer's own quote is never edited; the trade
  // sits beside it. TODO(tax): no trade-in tax credit; sales tax stays as each dealer quoted it on the full price.
  const trade = rfq.tradeIn ?? null;
  // The number that counts is the confirmed one once the winner has settled it; before that, or after the buyer went back from a
  // revision, it is what the desk originally quoted. The allowance dies with the vehicle quote it came with.
  const eqOf = (r: { invite: (typeof rfq.invites)[number] }): TradeEquity =>
    tradeEquity(Boolean(trade), trade?.payoffEstimate, appraisalForCompare(r.invite.tradeAppraisal, r.invite.tradeConfirmation), new Date(), { quoteExpiresAt: r.invite.quote?.expiresAt ?? null, tradeUpdatedAt: trade?.updatedAt ?? null });
  const otdOf = (r: (typeof rows)[number]) => otdBeforeAfter(cashOutTheDoor(r.used!), eqOf(r));
  const hasTrade = Boolean(trade);
  const eligibleRow = (r: (typeof rows)[number]) => tradeEligible(eqOf(r));
  // Cash ranks on post-trade OTD (ties: more net equity), so a big trade offset by a higher price can't hide, and negative equity
  // can't hide behind a low price. Finance ranks on the monthly its dealer rate and term give on the amount financed after the equity
  // is applied, then cash due. A desk with no live trade number sorts after the desks that have one and never wears "best deal".
  const vehicleOrder = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    finance && a.used!.kind === "finance" && b.used!.kind === "finance"
      ? compareFinanceQuotes(a.used as UsedFinanceQuote, b.used as UsedFinanceQuote)
      : cashOutTheDoor(a.used as UsedCashQuote) - cashOutTheDoor(b.used as UsedCashQuote);
  const postTradeOrder = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
    if (finance && a.used!.kind === "finance" && b.used!.kind === "finance") {
      const fa = a.used as UsedFinanceQuote, fb = b.used as UsedFinanceQuote;
      return financeAfterTrade(fa, eqOf(a)).monthly - financeAfterTrade(fb, eqOf(b)).monthly || financeCashDue(fa) - financeCashDue(fb) || fa.amountFinanced - fb.amountFinanced;
    }
    return compareByOtdAfterThenEquity({ eq: eqOf(a), otdAfter: otdOf(a).after }, { eq: eqOf(b), otdAfter: otdOf(b).after });
  };
  const ranked = orderDesks(live, { mode: sort, hasTrade, eligible: eligibleRow, byPostTrade: postTradeOrder, byVehicle: hasTrade && !finance ? vehicleOrder : (a, b) => (finance && a.used!.kind === "finance" && b.used!.kind === "finance" ? compareFinanceQuotes(a.used as UsedFinanceQuote, b.used as UsedFinanceQuote) : compareByOtdAfterThenEquity({ eq: eqOf(a), otdAfter: otdOf(a).after }, { eq: eqOf(b), otdAfter: otdOf(b).after })) });
  const best = bestDeal(ranked, { hasTrade, eligible: eligibleRow });
  // Badges and gaps only count desks that can be compared on the post-trade basis (all of them when there is no trade).
  const badgeRows = hasTrade ? live.filter(eligibleRow) : live;
  const comparedOtd = (r: (typeof rows)[number]) => (hasTrade && sort === "vehicle" ? cashOutTheDoor(r.used as UsedCashQuote) : otdOf(r).after);
  const lowest = (pick: (u: UsedQuote, r: (typeof rows)[number]) => number | null) => {
    const vals = badgeRows.map((r) => pick(r.used!, r)).filter((v): v is number => v != null);
    return vals.length ? Math.min(...vals) : null;
  };
  const bestMonthly = finance ? lowest((u) => (u.kind === "finance" ? u.monthlyPaymentPreTax : null)) : null;
  const bestCashDue = finance ? lowest((u) => (u.kind === "finance" ? financeCashDue(u) : null)) : null;
  const bestOtd = !finance ? lowest((u, r) => (u.kind === "cash" ? otdOf(r).after : null)) : null;
  const bestAfter = finance && trade ? lowest((_u, r) => (eqOf(r).status === "quoted" ? otdOf(r).after : null)) : null;
  const quotedNets = trade ? badgeRows.map((r) => eqOf(r)).filter((e) => e.status === "quoted").map((e) => e.net as number) : [];
  const bestNet = quotedNets.length > 1 ? Math.max(...quotedNets) : null;
  // Cash only: best-value picks among the ranked quotes (alternates sit outside `live`, so they never move a badge or a gap).
  const cashLive = finance ? [] : badgeRows.filter((r) => r.used!.kind === "cash");
  const cmp = compareCashQuotes(cashLive.map((r) => ({ id: r.invite.id, otd: comparedOtd(r), quote: r.used as UsedCashQuote })));
  const ordered = [...ranked, ...sideAlternates, ...rows.filter((r) => !live.includes(r) && !sideAlternates.includes(r))];
  const bestDealId = best?.invite.id ?? null;
  const glanceBest = best ?? ranked[0] ?? null;
  // "Best deal" needs a real comparison: at least two quotes for the same thing. One exact-build quote next to alternates is not one.
  const comparableCount = badgeRows.length;
  // The best quote for the buyer's exact build, named separately whenever alternates are in the mix.
  const exactBest = lane !== "alternate" && sideAlternates.length > 0 ? (hasTrade ? best : best ?? ranked[0]) ?? null : null;
  const exactBuildId = exactBest?.invite.id ?? null;
  // The headline is the lowest out the door across every live quote, alternates included, and says so when it is one.
  const headlinePool = lane !== "alternate" && sideAlternates.length ? [...live, ...sideAlternates] : null;
  const headline = !headlinePool ? glanceBest
    : !hasTrade ? [...headlinePool].sort(vehicleOrder)[0] ?? null
    : [...headlinePool.filter(eligibleRow)].sort(sort === "vehicle" ? vehicleOrder : postTradeOrder)[0] ?? glanceBest;
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
  const anySurcharges = rows.some((r) => r.used && (r.used.noSurcharges || (r.used.surcharges?.length ?? 0) > 0));
  const rowDefs: QuoteRowDef[] = [
    ...(finance ? [{ key: "monthly", label: "Monthly" }, { key: "cashdue", label: "Cash due at signing" }, { key: "apr", label: "APR · financed" }] : []),
    { key: "price", label: "Selling price" },
    ...(!finance ? [{ key: "pctoff", label: "% off MSRP" }] : []),
    { key: "fees", label: "Fees (named)" },
    { key: "tax", label: "Sales tax" },
    { key: "addons", label: "Add-ons" },
    // Between Add-ons and Rebates. Quotes sent before surcharges existed carry no field, so the row only appears once a compared quote has one.
    ...(anySurcharges ? [{ key: "surcharges", label: "Surcharges" }] : []),
    { key: "rebates", label: "Rebates / credits" },
    ...(trade ? [{ key: "tradeallow", label: "Trade-in allowance" }, { key: "payoff", label: "Payoff to lender" }, { key: "netequity", label: "Net trade equity" }] : []),
    ...(!finance ? [{ key: "otdex", label: "Out the door, excluding add-ons" }] : []),
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
    const status = invite.notSelectedAt ? chip("bg-border text-ink-muted", "Not selected", "not-selected-chip")
      : !used
      ? invite.status === "declined" ? chip("bg-rose-500/15 text-rose-300", "Declined")
        : unsubscribed ? chip("bg-border text-ink-muted", "Unsubscribed — won't reply", "unsub-chip")
        : chip("bg-border text-ink-muted", `Waiting · ${waitingDeliveryLabel(invite)}`)
      : expired ? chip("bg-border text-ink-muted", "Expired")
      : picked ? chip("bg-brand-500/15 text-brand-300", "Chosen")
      : unsubscribed ? chip("bg-border text-ink-muted", "Unsubscribed — quote still valid", "unsub-chip")
      : invite.counterDeclined ? chip("bg-amber-500/15 text-amber-200", COUNTER_DECLINED_STATUS, "counter-declined-chip")
      : <span className="text-[10px] text-ink-muted">Quoted to your locks</span>;
    const fin = used?.kind === "finance" ? used : null;
    const excluded = alternate && lane !== "alternate";
    const best: string[] = [];
    if (used && !expired && !excluded) {
      if (fin && financeCashDue(fin) === bestCashDue) best.push("cashdue");
      if (fin && fin.monthlyPaymentPreTax === bestMonthly) best.push("monthly");
      if (used.kind === "cash" && (trade ? otdBeforeAfter(cashOutTheDoor(used), eq).after : cashOutTheDoor(used)) === bestOtd) best.push(trade ? "otdafter" : "otd");
      if (used.kind === "cash" && cmp.biggestDiscount.includes(invite.id)) best.push("pctoff");
      if (trade && eq.status === "quoted" && bestNet != null && eq.net === bestNet) best.push("netequity");
      if (trade && finance && eq.status === "quoted" && bestAfter != null && otdBeforeAfter(cashOutTheDoor(used), eq).after === bestAfter) best.push("otdafter");
    }
    const otd = used ? otdBeforeAfter(cashOutTheDoor(used), eq) : null;
    const disc = used?.kind === "cash" ? msrpDiscount(used) : null;
    const pctOffCell = !disc ? null : disc.status === "none" ? <span className="text-ink-muted" data-testid="msrp-not-provided">MSRP not provided</span>
      : <span data-testid="pct-off-msrp">
          {disc.status === "above" ? <span className="text-amber-200">{fmtMoney(disc.dollars)} · above MSRP</span>
            : disc.status === "at" ? <>At MSRP</>
            : <>{fmtMoney(disc.dollars)} · {disc.pct}% off</>}
          <span className="block text-[10px] font-normal text-ink-muted">MSRP {fmtMoney(disc.msrp)}</span>
        </span>;
    const gap = used?.kind === "cash" && !excluded && !expired ? cmp.gapToBest[invite.id] : undefined;
    const vsBest = gap === undefined || cashLive.length < 2 ? null
      : <span className="block text-[10px] font-normal text-ink-muted" data-testid="vs-best">{gap === 0 ? "Lowest quote" : `+${fmtMoney(gap)} vs. best`}</span>;
    const tradeCells: Record<string, React.ReactNode> = trade ? {
      tradeallow: <TradeAllowanceCell eq={eq} desk={used ? "quoted" : "waiting"} />,
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
          {used.kind === "cash" ? vsBest : null}
          {eq.status === "quoted" && eq.allowance?.isRange ? <span className="block text-[10px] font-normal text-ink-muted">{fmtMoney(otd!.afterLow)} to {fmtMoney(otd!.afterHigh)}</span> : null}
          {eq.status !== "quoted" ? <span className="block text-[10px] font-normal text-ink-muted" data-testid="otd-trade-note">{eq.status === "expired" ? "trade expired; not applied" : eq.status === "declined" ? "no trade quote; not applied" : used ? "no trade quote; not applied" : "trade pending; not applied"}</span> : null}
        </>,
        ...(used.kind === "finance" ? { applied: (() => {
          const a = applyToFinance(eq, used.amountFinanced);
          return a.how === "none" ? <span className="text-ink-muted">{eq.status === "quoted" ? "No equity to apply" : "—"}</span>
            : <span data-testid="equity-applied">{a.label}: {fmtMoney(a.amount)}<span className="block text-[10px] text-ink-muted">amount financed {fmtMoney(used.amountFinanced)} → {fmtMoney(a.adjusted)} (your monthly is the dealer&apos;s, not recomputed)</span><span className="block text-[10px] text-ink-muted" data-testid="monthly-after-trade">ranked on ≈ {fmtMoney(financeAfterTrade(used, eq).monthly)}/mo at their rate and term</span></span>;
        })() } : {}),
      } : {}),
    } : {};
    const taxLines = used ? used.dueAtSigning.filter((l) => isTax(l.name)) : [];
    const feeLines = used ? used.dueAtSigning.filter((l) => !isTax(l.name)) : [];
    const cells: Record<string, React.ReactNode> = used ? {
      price: fmtMoney(used.sellingPrice),
      fees: <>{feeLines.length ? lines(dueAtSigningSum(feeLines), feeLines) : <span className="text-ink-muted">None</span>}</>,
      tax: <>{taxLines.length ? lines(dueAtSigningSum(taxLines), taxLines) : <span className="text-ink-muted">—</span>}<DealerAdjustedFlag overrides={activeOverrides(used).filter((o) => o.key === "sales_tax")} /></>,
      addons: used.noAddOns || !used.addOns?.length ? <span className="text-ink-muted">None</span> : lines(dueAtSigningSum(used.addOns), used.addOns),
      surcharges: used.surcharges?.length ? (
        <div data-testid="itemized-lines">
          <span className="font-bold text-white">{fmtMoney(dueAtSigningSum(used.surcharges))}</span>
          <ul className="mt-1 space-y-1 text-[10px] text-ink-light tabular-nums">
            {used.surcharges.map((l, i) => (
              <li key={i}>
                <span className="flex justify-between gap-3"><span className="text-ink-muted">{surchargeLabel(l)}</span><span>{fmtMoney(l.amount)}</span></span>
                {isCountyTaxSurcharge(l)
                  ? (l.reason ? <span className="block text-[9px] font-normal text-ink-muted" data-testid="county-tax-reason">{l.reason}</span> : null)
                  : <span className="block text-[9px] font-normal text-amber-200/90" data-testid="dealer-imposed">Dealer-imposed{l.reason ? ` — ${l.reason}` : ""}</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : used.noSurcharges ? <span className="text-ink-muted">None</span> : <span className="text-ink-muted">—</span>,
      rebates: used.rebates?.length ? lines(dueAtSigningSum(used.rebates), used.rebates, true) : <span className="text-ink-muted">—</span>,
      miles: used.miles != null ? <>{used.miles.toLocaleString()} mi{used.cpo ? <span className="block text-[10px] text-sky-300">CPO</span> : null}</> : "—",
      expires: <span className={expired ? "text-rose-300" : ""}>{new Date(used.expiresAt).toLocaleDateString()}</span>,
      ...(fin ? {
        monthly: <>{fmtMoney(fin.monthlyPaymentPreTax)}<span className="text-[10px] text-ink-muted">/mo</span>{fin.monthlyPaymentWithEstTax != null ? <span className="block text-[10px] text-ink-muted">{fmtMoney(fin.monthlyPaymentWithEstTax)}/mo with est. tax</span> : null}</>,
        cashdue: fmtMoney(financeCashDue(fin)),
        apr: <>{fmtPct(fin.apr)} · {fin.termMonths} mo<span className="block text-[10px] text-ink-muted">{fmtMoney(fin.amountFinanced)} financed{fin.lenderName ? ` · ${fin.lenderName}` : ""}</span></>,
      } : {}),
      ...(used.kind === "cash" ? {
        pctoff: pctOffCell,
        otdex: <span data-testid="otd-excl-addons">{fmtMoney(otdExcludingAddOns(used))}</span>,
      } : {}),
      ...(used.kind === "cash" && !trade ? { otd: <>{fmtMoney(cashOutTheDoor(used))}{vsBest}</> } : {}),
      ...tradeCells,
    } : { ...tradeCells };
    const header = (
      <div className="space-y-1" data-testid={`used-row-${!used ? "waiting" : expired ? "expired" : "quoted"}`}>
        <span className="block text-sm font-bold leading-snug text-white">{invite.dealerName}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {status}
          {invite.tradeConfirmation?.status === "revised" ? chip("bg-sky-500/15 text-sky-300", "Revised", "revised-chip") : null}
          {bestDealId === invite.id && !excluded && !expired && comparableCount > 1 ? chip("bg-brand-500/15 text-brand-300", hasTrade && sort === "post_trade" ? "Best deal after trade" : "Best deal", "badge-best-deal") : null}
          {exactBuildId === invite.id && !expired ? chip("bg-sky-500/15 text-sky-300", "Best for your exact build", "badge-exact-build") : null}
          {used?.kind === "cash" && !expired && !excluded && cmp.lowestOtd.includes(invite.id) ? chip("bg-emerald-500/15 text-emerald-300", "Lowest out the door", "badge-lowest-otd") : null}
          {used?.kind === "cash" && !expired && !excluded && cmp.biggestDiscount.includes(invite.id) ? chip("bg-emerald-500/15 text-emerald-300", "Biggest discount", "badge-biggest-discount") : null}
          {used?.kind === "cash" && !expired && !excluded && cmp.lowestFees.includes(invite.id) ? chip("bg-emerald-500/15 text-emerald-300", "Lowest fees", "badge-lowest-fees") : null}
          {alternate ? <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-300" data-testid="alternate-badge">Alternate vehicle{lane !== "alternate" ? " — not ranked" : ""}</span> : null}
        </div>
        {multiCar && invite.vehicle ? <span className="block text-[11px] font-semibold text-ink-light" data-testid="column-vehicle">{vehicleTitle(invite.vehicle)}</span> : null}
        {invite.desk?.contactName ? <span className="block text-[10px] text-ink-muted">{invite.desk.contactName}{invite.desk.emailMasked ? <span className="font-mono"> · {invite.desk.emailMasked}</span> : null}</span> : null}
        {used?.stockNumber ? <span className="block text-[10px] text-ink-faint">stock {used.stockNumber}</span> : null}
        {hasTrade && used && !expired && eq.status !== "quoted" && eq.status !== "expired" ? <span className="block text-[10px] text-amber-200" data-testid="no-best-deal-note">{eq.status === "declined" ? "Not in the best-deal ranking: no trade quote." : "Not in the best-deal ranking: no trade quote yet."}</span> : null}
        <RevisedNote conf={invite.tradeConfirmation} />
        {used?.kind === "cash" && used.counterAccepted ? <span className="block text-[10px] font-bold text-emerald-300" data-testid="counter-accepted-badge">Dealer accepted your counter</span> : null}
        {invite.counterDeclined && !expired ? <span className="block text-[10px] text-amber-200/90" data-testid="counter-declined-note">{COUNTER_DECLINED_NOTE}</span> : null}
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
        {staged ? null : <button type="button" onClick={() => onPick(invite.quote!.id)} disabled={busy} className="rounded-lg bg-brand-500 px-3 py-1.5 text-[11px] font-extrabold text-black hover:bg-brand-400 disabled:opacity-50" data-testid="choose-quote">{invite.counterDeclined ? ACCEPT_ORIGINAL_LABEL : "Choose this quote"}</button>}
        <div className="grid grid-cols-2 gap-1.5">
        {onCounter && !unsubscribed && !invite.counterDeclined && !(staged && stageOf(rfq, invite)?.otd.status === "locked") ? (
          <button type="button" onClick={() => setCountering(invite.id)} disabled={busy || countering === invite.id} className="rounded-lg border border-sky-500/50 px-3 py-1.5 text-[11px] font-bold text-sky-200 hover:bg-sky-500/10 disabled:opacity-50" data-testid="counter-quote">Counter</button>
        ) : null}
        {staged ? null : <button type="button" onClick={onWalk} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="walk-away">Walk away</button>}
        </div>
        {staged ? null : <p className="text-[10px] text-ink-faint" data-testid="contact-shared-line">{CONTACT_SHARED_LINE}</p>}
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
        {finance ? <span>Your locks: {prefs.finance.termMonths} mo · {fmtMoney(prefs.finance.downPayment)} down · {prefs.finance.creditBand} credit · ZIP {prefs.finance.zip}</span> : <span>{prefs.cash?.zip ? `ZIP ${prefs.cash.zip} (tax context)` : "Tax is as each dealer quoted it"}</span>}
      </div>

      {quoted === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-ink-light" data-testid="used-glance-none">
          Waiting on {rows.length} dealer{rows.length === 1 ? "" : "s"} — quotes appear here as they reply. Nothing you need to do.
        </p>
      ) : headline ? (
        <div className="rounded-xl border border-brand-500/40 bg-brand-500/5 px-4 py-3" data-testid="used-glance-best">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{hasTrade && !best ? "Lowest vehicle out the door. No dealer has given a trade quote yet, so none is ranked best" : finance ? (trade && sort === "post_trade" ? "Best on monthly after trade, then cash due at signing" : "Best on monthly, then cash due at signing") : trade && sort === "post_trade" ? "Lowest out the door after trade" : "Lowest out the door"}</p>
          <p className="text-lg font-extrabold text-white tabular-nums">
            {finance && headline.used!.kind === "finance" ? <>{fmtMoney(headline.used!.monthlyPaymentPreTax)}<span className="text-xs font-semibold text-ink-muted">/mo · {fmtMoney(financeCashDue(headline.used as UsedFinanceQuote))} due at signing</span></> : fmtMoney(comparedOtd(headline))}
          </p>
          <p className="text-[11px] text-ink-light">{headline.invite.dealerName}{headline.alternate && lane !== "alternate" ? <span className="ml-2 rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-300" data-testid="glance-alternate">Alternate vehicle — not your exact build</span> : null}</p>
          {exactBest && exactBest !== headline ? <p className="mt-1 text-[11px] text-sky-200" data-testid="used-glance-exact">Best for your exact build: {exactBest.invite.dealerName} · {fmtMoney(comparedOtd(exactBest))}</p> : null}
        </div>
      ) : (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-ink-light">Every quote has expired — ask a dealer to re-quote, or walk away.</p>
      )}

      {trade ? <p className="text-[11px] text-ink-muted" data-testid="trade-estimate-copy">{TRADE_ESTIMATE_COPY} Sales tax is as each dealer quoted it, on the full price.</p> : null}
      {trade && quoted > 1 ? <TradeSortToggle mode={sort} onChange={setSort} /> : null}
      <QuoteColumns testId="used-table" caption="Quotes, one column per dealer" rows={rowDefs} columns={ordered.map(toColumn)} />
      {counteringRow && counteringRow.used && counteringRow.invite.quote && onCounter ? (
        <CounterSheetForm dealerName={counteringRow.invite.dealerName} quote={{ used: counteringRow.used }} zip={(finance ? prefs.finance?.zip : prefs.cash?.zip) || ""} quoteId={counteringRow.invite.quote.id} onSubmit={async (c) => { await onCounter(counteringRow.invite.id, c); setCountering(null); }} onCancel={() => setCountering(null)} />
      ) : null}
      {collecting && !staged ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3">
          <p className="text-[11px] text-ink-muted">Choose a quote under its dealer, or walk away — nothing is binding until you sign with the dealer.</p>
          {!anyActions ? <button type="button" onClick={onWalk} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="walk-away">Walk away from this request</button> : null}
        </div>
      ) : null}
    </section>
  );
}
