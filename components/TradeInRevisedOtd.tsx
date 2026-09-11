"use client";

import React from "react";
import { formatCurrency } from "../lib/otdCalculator";
import { revisedOtd, type RevisedOtdInput } from "../lib/tradeInMath";

/**
 * The deal after the trade-in is priced: what the state now taxes, what
 * registration comes to, and what the buyer actually brings. One component
 * so the buyer's confirmation and the dealer's appraisal preview never show
 * different arithmetic for the same numbers.
 */
export const TradeInRevisedOtd: React.FC<{ input: RevisedOtdInput; compact?: boolean }> = ({ input, compact }) => {
  const r = revisedOtd(input);
  const state = (input.registrationState || "").toUpperCase();
  const row = (label: string, value: string, tone: "plain" | "credit" | "total" = "plain") => (
    <div
      className={`flex justify-between gap-3 ${
        tone === "total"
          ? "border-t border-border pt-2 text-sm font-black text-white"
          : tone === "credit"
            ? "text-emerald-400"
            : "text-ink-muted"
      }`}
    >
      <span>{label}</span>
      <span className={`font-mono ${tone === "plain" ? "text-white" : ""}`}>{value}</span>
    </div>
  );

  return (
    <div className={`space-y-1.5 ${compact ? "text-[11px]" : "text-xs"}`}>
      {row("Quoted price (vehicle + dealer fees)", formatCurrency(r.quotedOtdPrice))}
      {row("Trade-in allowance", `−${formatCurrency(r.tradeInAllowance)}`, "credit")}
      {r.loanPayoff > 0 && row("Loan payoff on the trade", `+${formatCurrency(r.loanPayoff)}`)}
      {row(
        r.tradeInTaxCredit
          ? `Sales tax${state ? ` (${state})` : ""} — on ${formatCurrency(r.taxableAmount)} after the trade`
          : `Sales tax${state ? ` (${state})` : ""} — ${state || "this state"} taxes the full price`,
        formatCurrency(r.salesTax)
      )}
      {r.taxSavedByTradeIn > 0 && row("Tax saved by trading in", `−${formatCurrency(r.taxSavedByTradeIn)}`, "credit")}
      {row("Registration & title (estimate)", formatCurrency(r.registrationFees))}
      {row("Amount due", formatCurrency(r.amountDue), "total")}
      <p className="pt-1 text-[10px] leading-snug text-ink-faint">
        Tax and registration are estimates for planning. The dealer&apos;s paperwork and your state&apos;s DMV set
        the final figures.
      </p>
    </div>
  );
};
