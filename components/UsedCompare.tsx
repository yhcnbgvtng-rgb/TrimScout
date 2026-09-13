"use client";

import React from "react";
import { fmtMoney, fmtPct } from "../lib/leaseCompare";
import { cashOutTheDoor, isFinanceCounter, type QuotePrefs, type UsedFinanceQuote, type UsedQuote } from "../lib/usedQuote";
import { isExpired } from "../lib/leaseQuote";
import type { RfqInvite, RfqRequest } from "../lib/rfq";
import { MustConfirmList } from "./MustConfirmList";
import type { MustConfirmItem } from "../lib/mustConfirm";

/**
 * Used-car compare — Finance or Cash column sets (never the lease MF /
 * residual grid). One row per dealer; best out-the-door (cash) or best
 * monthly (finance) highlighted among current, in-pref quotes; expired
 * greyed; waiting rows with dashes; checklist answers per row.
 */
export function UsedCompare({ rfq, prefs, mustConfirm, onPick, onWalk, busy }: { rfq: RfqRequest; prefs: QuotePrefs; mustConfirm: MustConfirmItem[]; onPick: (quoteId: string) => void; onWalk: () => void; busy: boolean }) {
  const collecting = rfq.status === "collecting";
  const rows = rfq.invites.map((i) => ({ invite: i, used: i.quote?.used ?? null }));
  const live = rows.filter((r) => r.used && !isExpired({ expiresAt: r.used.expiresAt }));
  const eligible = live.filter((r) => !(prefs.quoteType === "finance" && r.used!.kind === "finance" && isFinanceCounter(r.used as UsedFinanceQuote, prefs.finance)));
  const key = (u: UsedQuote) => (u.kind === "cash" ? cashOutTheDoor(u) : u.monthlyPaymentPreTax);
  const best = eligible.length ? eligible.reduce((a, b) => (key(a.used!) <= key(b.used!) ? a : b)) : null;
  const quoted = rows.filter((r) => r.used).length;
  const finance = prefs.quoteType === "finance";
  const cell = (v: React.ReactNode, extra = "") => <td className={`px-3 py-2.5 align-top tabular-nums ${extra}`}>{v}</td>;
  const hi = "bg-emerald-500/10 font-extrabold text-emerald-300";

  return (
    <section className="space-y-3" data-testid="used-compare">
      {quoted === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-ink-light" data-testid="used-glance-none">
          Waiting on {rows.length} dealer{rows.length === 1 ? "" : "s"} — quotes appear here as they reply.
        </p>
      ) : best ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{finance ? "Lowest monthly" : "Lowest out the door"}</p>
          <p className="text-lg font-extrabold text-white tabular-nums">{fmtMoney(key(best.used!))}{finance ? <span className="text-xs font-semibold text-ink-muted">/mo</span> : null}</p>
          <p className="text-[11px] text-ink-light">{best.invite.dealerName}</p>
        </div>
      ) : (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-ink-light">No quote matches your ask yet — the counters below differ from what you asked for.</p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead>
            <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-ink-faint">
              <th className="sticky left-0 z-10 bg-surface px-3 py-2.5">Dealer</th>
              {finance ? (
                <>
                  <th className="px-3 py-2.5">Monthly</th>
                  <th className="px-3 py-2.5">Down</th>
                  <th className="px-3 py-2.5">APR · term</th>
                  <th className="px-3 py-2.5">Amount financed</th>
                </>
              ) : (
                <th className="px-3 py-2.5">Out the door</th>
              )}
              <th className="px-3 py-2.5">Selling price</th>
              <th className="px-3 py-2.5">Due at signing</th>
              <th className="px-3 py-2.5">Miles · CPO</th>
              <th className="px-3 py-2.5">Must confirm</th>
              <th className="px-3 py-2.5">Expires</th>
              <th className="px-3 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map(({ invite, used }) => {
              const expired = used ? isExpired({ expiresAt: used.expiresAt }) : false;
              const counter = used?.kind === "finance" && finance ? isFinanceCounter(used, prefs.finance) : false;
              const isBest = best?.invite.id === invite.id;
              const picked = Boolean(invite.quote && rfq.pickedQuoteId === invite.quote.id);
              const das = used ? used.dueAtSigning.reduce((t, l) => t + l.amount, 0) : null;
              const status = !used
                ? invite.status === "declined" ? <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-300">Declined</span> : <span className="rounded bg-border px-1.5 py-0.5 text-[9px] font-bold uppercase text-ink-muted">Waiting</span>
                : expired ? <span className="rounded bg-border px-1.5 py-0.5 text-[9px] font-bold uppercase text-ink-muted">Expired</span>
                : counter ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-300">Counter</span>
                : picked ? <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300">Chosen</span>
                : <span className="text-[10px] text-ink-muted">Matches your ask</span>;
              return (
                <tr key={invite.id} className={`${expired || invite.status === "declined" ? "opacity-50" : ""} ${picked ? "bg-emerald-500/5" : ""}`} data-testid={`used-row-${!used ? "waiting" : expired ? "expired" : counter ? "counter" : "eligible"}`}>
                  <td className="sticky left-0 z-10 bg-surface px-3 py-2.5 align-top">
                    <span className="block text-sm font-bold text-white">{invite.dealerName}</span>
                    {invite.desk?.contactName ? <span className="block text-[10px] text-ink-muted">{invite.desk.contactName}{invite.desk.emailMasked ? <span className="font-mono"> · {invite.desk.emailMasked}</span> : null}</span> : null}
                  </td>
                  {finance ? (
                    <>
                      {cell(used?.kind === "finance" ? <>{fmtMoney(used.monthlyPaymentPreTax)}<span className="text-[10px] text-ink-muted">/mo</span>{used.monthlyPaymentWithEstTax != null ? <span className="block text-[10px] text-ink-muted">{fmtMoney(used.monthlyPaymentWithEstTax)} with est. tax</span> : <span className="block text-[10px] text-ink-muted">tax estimated at signing</span>}</> : "—", isBest ? hi : "")}
                      {cell(used?.kind === "finance" ? fmtMoney(used.downPayment) : "—")}
                      {cell(used?.kind === "finance" ? <>{fmtPct(used.apr)} · {used.termMonths} mo{counter ? <span className="block text-[10px] text-amber-300">you asked {prefs.finance.termMonths} mo / {fmtMoney(prefs.finance.downPayment)} down{used.counter?.note ? `: “${used.counter.note}”` : ""}</span> : null}<span className="block text-[10px] text-ink-faint">assumes {used.creditAssumption} credit</span></> : "—")}
                      {cell(used?.kind === "finance" ? fmtMoney(used.amountFinanced) : "—")}
                    </>
                  ) : (
                    cell(used?.kind === "cash" ? fmtMoney(cashOutTheDoor(used)) : "—", isBest ? hi : "")
                  )}
                  {cell(used ? fmtMoney(used.sellingPrice) : "—")}
                  {cell(used ? (
                    <details>
                      <summary className="cursor-pointer list-none font-bold text-white">{fmtMoney(das)}</summary>
                      <ul className="mt-1 space-y-0.5 text-[10px] text-ink-muted tabular-nums">
                        {used.dueAtSigning.map((l, i) => (<li key={i} className="flex justify-between gap-3"><span>{l.name}</span><span>{fmtMoney(l.amount)}</span></li>))}
                      </ul>
                    </details>
                  ) : "—")}
                  {cell(used ? <>{used.miles.toLocaleString()} mi{used.cpo ? <span className="block text-[10px] text-sky-300">CPO</span> : null}</> : "—")}
                  {cell(used ? <MustConfirmList items={mustConfirm} acks={used.checklist} compact /> : "—")}
                  {cell(used ? new Date(used.expiresAt).toLocaleDateString() : "—", expired ? "text-rose-300" : "")}
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex flex-col items-start gap-1.5">
                      {status}
                      {collecting && used && !expired && invite.quote ? (
                        <button type="button" onClick={() => onPick(invite.quote!.id)} disabled={busy} className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-extrabold text-black hover:bg-emerald-400 disabled:opacity-50" data-testid="choose-quote">Choose this quote</button>
                      ) : null}
                    </div>
                  </td>
                </tr>
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
