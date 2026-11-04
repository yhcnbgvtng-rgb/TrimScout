"use client";

import React from "react";
import { fmtMoney } from "../../lib/leaseCompare";
import type { TrueOtdBreakdown } from "../../lib/trade/trueOtd";

/**
 * The "Out the door" summary once a trade allowance is on the quote: the original OTD, each step the trade changes, and a clearly
 * labelled True OTD. The same component (and the same breakdown from lib/trade/trueOtd.ts) serves the buyer and the dealer.
 * With no allowance it renders the single original line, exactly the number the quote carried before.
 */
export function TrueOtdCard({ b, compact = false }: { b: TrueOtdBreakdown; compact?: boolean }) {
  const range = (s: { low: number; high: number }) => `${fmtMoney(s.low)} to ${fmtMoney(s.high)}`;
  const row = (label: string, value: React.ReactNode, testId: string, tone = "text-ink-light") => (
    <div className={`flex items-start justify-between gap-3 ${tone}`} data-testid={testId}>
      <span>{label}</span>
      <span className="text-right font-mono tabular-nums">{value}</span>
    </div>
  );
  if (!b.applies) {
    return <div data-testid="true-otd-card" className={compact ? "text-[11px]" : "text-xs"}>{row("Out the door", fmtMoney(b.original), "otd-original", "font-bold text-white")}</div>;
  }
  const a = b.allowance!;
  return (
    <div data-testid="true-otd-card" className={`space-y-1.5 ${compact ? "text-[11px]" : "text-xs"}`}>
      {row("Original OTD", fmtMoney(b.original), "otd-original")}
      {row("Trade-in allowance", <>−{a.isRange ? range(a) : fmtMoney(a.mid)}</>, "otd-allowance", "text-emerald-300")}
      {b.taxSaving ? row("Tax savings from trade", <>−{a.isRange ? range(b.taxSaving) : fmtMoney(b.taxSaving.mid)}</>, "otd-tax-saving", "text-emerald-300") : null}
      {b.taxNote ? <p className="text-[10px] leading-snug text-ink-muted" data-testid="otd-tax-note">{b.taxNote}</p> : null}
      {b.payoff > 0 ? row("Payoff owed", `+${fmtMoney(b.payoff)}`, "otd-payoff") : null}
      {b.negativeEquity ? (
        <p className="rounded-lg border border-rose-500/40 bg-rose-950/20 px-2.5 py-1.5 text-[10px] font-bold text-rose-200" data-testid="otd-negative-equity">
          Negative equity: the payoff is {fmtMoney(Math.abs(b.netEquity!))} more than the allowance, so it adds to what you owe.
        </p>
      ) : null}
      <div className="border-t border-border/60 pt-2" data-testid="otd-true">
        {row("True OTD", b.trueOtd.isRange ? range(b.trueOtd) : fmtMoney(b.trueOtd.mid), "otd-true-value", "text-sm font-black text-white")}
        {b.trueOtd.isRange ? <p className="text-right text-[10px] text-ink-muted" data-testid="otd-true-mid">midpoint {fmtMoney(b.trueOtd.mid)}</p> : null}
      </div>
    </div>
  );
}
