"use client";

import React from "react";
import { fmtMoney } from "../../lib/leaseCompare";
import { chipLabel, DECLINE_CODES, type TradeConfirmation } from "../../lib/trade/confirm";
import type { TradeEquity } from "../../lib/trade/otd";
import { TRADE_SORT_LABELS, type TradeSortMode } from "../../lib/trade/rank";
import { BASIS_LABELS } from "../../lib/trade/types";

const label = (code: string) => (DECLINE_CODES as Record<string, string>)[code] ?? code;

/**
 * One desk's trade allowance on the compare: the number (or range), Preliminary / Firm, good-until, "Based on earlier details" when
 * the buyer changed the trade after it was given, and the conditions the desk attached. A desk with no number says so plainly
 * ("No trade quote", or why it can't quote) instead of looking like it quoted zero.
 */
export function TradeAllowanceCell({ eq, desk }: { eq: TradeEquity; /** The desk has sent its vehicle quote. Before that the trade is simply not in yet. */ desk: "quoted" | "waiting" }) {
  if (eq.status === "declined" && eq.declined) {
    return (
      <div data-testid="trade-declined">
        <span className="font-bold text-amber-200">Can&apos;t quote this trade</span>
        <span className="block text-[10px] font-normal text-ink-muted">{label(eq.declined.code)}{eq.declined.note ? `: ${eq.declined.note}` : ""}</span>
        <span className="block text-[10px] font-normal text-ink-muted">Their vehicle quote still counts.</span>
      </div>
    );
  }
  if (eq.status === "expired") return <span className="font-bold text-rose-300" data-testid="trade-expired">Trade value expired</span>;
  if (eq.status !== "quoted" || !eq.allowance) {
    return desk === "quoted"
      ? <span className="font-bold text-amber-200" data-testid="no-trade-quote">No trade quote</span>
      : <span className="font-bold text-amber-200" data-testid="trade-pending">Trade value pending</span>;
  }
  return (
    <div data-testid="trade-allowance">
      <span className="font-bold text-white">{eq.allowance.isRange ? `${fmtMoney(eq.allowance.low)} to ${fmtMoney(eq.allowance.high)}` : fmtMoney(eq.allowance.mid)}</span>
      {eq.allowance.isRange ? <span className="block text-[10px] font-normal text-ink-muted" data-testid="trade-midpoint">compared at the midpoint, {fmtMoney(eq.allowance.mid)}</span> : null}
      <span className={`mt-1 block text-[10px] font-bold uppercase ${eq.basis === "firm" ? "text-emerald-300" : "text-amber-200"}`} data-testid="trade-basis">{BASIS_LABELS[eq.basis!]}</span>
      {eq.goodUntil ? <span className="block text-[10px] font-normal text-ink-muted" data-testid="trade-good-until">good until {new Date(eq.goodUntil).toLocaleDateString()}</span> : null}
      {eq.stale ? <span className="mt-1 block text-[10px] font-bold uppercase text-sky-300" data-testid="trade-stale">Based on earlier details</span> : null}
      {eq.conditionChips.length || eq.conditions ? (
        <span className="mt-1 block text-[10px] font-normal leading-snug text-ink-light" data-testid="trade-conditions">
          {eq.conditionChips.map(chipLabel).join(" · ")}{eq.conditionChips.length && eq.conditions ? " · " : ""}{eq.conditions ? `“${eq.conditions}”` : ""}
        </span>
      ) : null}
    </div>
  );
}

/** "Revised" marker and the number it was revised to, shown under a desk the buyer went back from or is deciding on. */
export function RevisedNote({ conf }: { conf: TradeConfirmation | null | undefined }) {
  if (!conf || conf.status !== "revised") return null;
  const wentBack = conf.buyerDecision === "went_back";
  return (
    <span className="block text-[10px] leading-snug text-sky-200" data-testid="revised-note">
      Revised trade value {fmtMoney(conf.allowanceFinal ?? conf.allowancePrelim)} (was {fmtMoney(conf.allowancePrelim)}){wentBack ? ". You went back; the number above is what they originally quoted." : "."}
    </span>
  );
}

export function TradeSortToggle({ mode, onChange }: { mode: TradeSortMode; onChange: (m: TradeSortMode) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted" data-testid="trade-sort">
      <span>Sort by</span>
      {(["post_trade", "vehicle"] as const).map((m) => (
        <button key={m} type="button" onClick={() => onChange(m)} aria-pressed={mode === m} data-testid={`sort-${m}`}
          className={`rounded-lg border px-2.5 py-1 font-bold ${mode === m ? "border-brand-500 bg-brand-500/10 text-white" : "border-border text-ink-light hover:text-white"}`}>
          {TRADE_SORT_LABELS[m]}
        </button>
      ))}
    </div>
  );
}
