"use client";

import React from "react";
import { CONDITION_CHIP_KEYS, chipLabel, DECLINE_CODE_LIST } from "../../lib/trade/confirm";
import { liveEquity, type TradeFormState } from "../../lib/trade/dealerForm";
import { APPRAISAL_BASES, BASIS_COPY, BASIS_LABELS, TRADE_ESTIMATE_COPY, type TradeInRecord } from "../../lib/trade/types";

const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-brand-500 focus:outline-none tabular-nums";
const label = "block text-[10px] font-bold uppercase tracking-wide text-ink-faint";
const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;

/**
 * The trade allowance a dealer gives WITH the vehicle quote: one number or a low/high range, Preliminary or Firm, a good-until
 * date (blank = same as the quote's expiry), the payoff confirmation with live net equity, structured conditions plus free text,
 * or "Can't quote this trade" with a reason. Controlled: the quote form owns the state and blocks submit until it is complete.
 */
export function TradeAllowanceFields({ state, set, trade, needsOutlierConfirm }: { state: TradeFormState; set: (patch: Partial<TradeFormState>) => void; trade: TradeInRecord; needsOutlierConfirm?: boolean }) {
  const lien = trade.ownership !== "owned" || trade.payoffEstimate > 0;
  const live = liveEquity(state, trade.payoffEstimate);
  return (
    <div className="space-y-3" data-testid="appraisal-form">
      <div className="flex gap-2" role="radiogroup" aria-label="Quote the trade or not">
        {([["allowance", "Quote the trade"], ["decline", "Can't quote this trade"]] as const).map(([m, text]) => (
          <button key={m} type="button" role="radio" aria-checked={state.mode === m} onClick={() => set({ mode: m })} data-testid={`trade-mode-${m}`}
            className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${state.mode === m ? "border-brand-500 bg-brand-500/10 text-white" : "border-border text-ink-light"}`}>{text}</button>
        ))}
      </div>

      {state.mode === "decline" ? (
        <div className="space-y-2" data-testid="trade-decline-form">
          <label className="block space-y-1"><span className={label}>Why can&apos;t you quote it?</span>
            <select value={state.declineCode} onChange={(e) => set({ declineCode: e.target.value })} className={input} aria-label="Reason you can't quote the trade" data-testid="decline-code">
              <option value="">Choose a reason…</option>
              {DECLINE_CODE_LIST.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
            </select></label>
          <label className="block space-y-1"><span className={label}>Note {state.declineCode === "other" ? "" : <span className="font-normal normal-case">(optional)</span>}</span>
            <input value={state.declineNote} maxLength={300} onChange={(e) => set({ declineNote: e.target.value })} className={input} aria-label="Note" data-testid="decline-note" /></label>
          <p className="text-[10px] text-ink-faint">The buyer sees this on your card and your vehicle quote still counts. You won&apos;t be in the best-deal ranking, because there is no trade number to compare.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2" role="radiogroup" aria-label="Allowance type">
            {(["single", "range"] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={state.shape === m} onClick={() => set({ shape: m })} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${state.shape === m ? "border-brand-500 bg-brand-500/10 text-white" : "border-border text-ink-light"}`}>{m === "single" ? "One number" : "Low / high range"}</button>)}
          </div>
          {state.shape === "single" ? (
            <label className="block space-y-1"><span className={label}>Trade allowance ($) <span className="text-rose-300">*</span></span><input inputMode="decimal" value={state.single} onChange={(e) => set({ single: e.target.value })} className={input} aria-label="Trade allowance" data-testid="allowance-single" /></label>
          ) : (
            <div className="grid grid-cols-2 gap-3"><label className="space-y-1"><span className={label}>Low ($) <span className="text-rose-300">*</span></span><input inputMode="decimal" value={state.low} onChange={(e) => set({ low: e.target.value })} className={input} aria-label="Allowance low" data-testid="allowance-low" /></label><label className="space-y-1"><span className={label}>High ($) <span className="text-rose-300">*</span></span><input inputMode="decimal" value={state.high} onChange={(e) => set({ high: e.target.value })} className={input} aria-label="Allowance high" data-testid="allowance-high" /></label></div>
          )}
          {state.shape === "range" ? <p className="text-[10px] text-ink-faint">The buyer compares at the midpoint and sees your range. If they pick you, you&apos;ll confirm one number.</p> : null}
          <fieldset className="space-y-1.5"><legend className={label}>Valuation basis</legend>
            {APPRAISAL_BASES.map((b) => <label key={b} className="flex items-center gap-2 text-xs text-ink-light"><input type="radio" name="basis" checked={state.basis === b} onChange={() => set({ basis: b })} data-testid={`basis-${b}`} />{BASIS_COPY[b]} <span className="text-[10px] text-ink-faint">(shown to the buyer as “{BASIS_LABELS[b]}”)</span></label>)}
          </fieldset>
          <label className="block space-y-1"><span className={label}>Good until</span><input type="date" value={state.goodUntil} onChange={(e) => set({ goodUntil: e.target.value })} className={input} aria-label="Good until" data-testid="good-until" /><span className="text-[10px] text-ink-faint">Leave blank to match your vehicle quote&apos;s expiry. The allowance never outlives the quote.</span></label>
          <div className="space-y-1.5 rounded-lg border border-border bg-background/50 p-3 text-xs" data-testid="payoff-handling">
            <p className="text-ink-light">Estimated payoff used: <strong className="text-white">{usd(trade.payoffEstimate)}</strong>{trade.lenderName ? ` to ${trade.lenderName}` : ""}</p>
            {lien ? <label className="flex items-start gap-2 text-ink-light"><input type="checkbox" checked={state.payoffConfirmed} onChange={(e) => set({ payoffConfirmed: e.target.checked })} className="mt-0.5" data-testid="payoff-confirm" />I&apos;ll pay off the lien, and the buyer&apos;s estimated payoff above was used. <span className="text-rose-300">*</span></label> : null}
            {live ? <p className={`font-bold ${live.equity < 0 ? "text-rose-300" : "text-emerald-300"}`} data-testid="live-equity">Net equity = allowance − payoff = {usd(live.equity)}{live.isRange ? ` (range ${usd(live.lowEq)} to ${usd(live.highEq)})` : ""}{live.equity < 0 ? " · negative equity" : ""}</p> : <p className="text-ink-faint">Enter an allowance to see the equity.</p>}
          </div>
          <fieldset className="space-y-1.5"><legend className={label}>Conditions <span className="font-normal normal-case">(optional)</span></legend>
            <div className="flex flex-wrap gap-2">
              {CONDITION_CHIP_KEYS.map((k) => (
                <label key={k} className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${state.chips.includes(k) ? "border-brand-500 bg-brand-500/10 text-white" : "border-border text-ink-light"}`}>
                  <input type="checkbox" className="sr-only" checked={state.chips.includes(k)} onChange={() => set({ chips: state.chips.includes(k) ? state.chips.filter((c) => c !== k) : [...state.chips, k] })} data-testid={`chip-${k}`} />{chipLabel(k)}
                </label>
              ))}
            </div>
            <textarea rows={2} maxLength={500} value={state.conditions} onChange={(e) => set({ conditions: e.target.value })} placeholder='Anything else, e.g. "assumes no frame damage"' aria-label="Conditions" className={`${input} resize-none`} />
            <span className="block text-[10px] text-ink-faint">The buyer sees these next to your number. If you later revise it at the confirm step, you can point to a condition you listed here.</span>
          </fieldset>
          {needsOutlierConfirm ? (
            <label className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-950/20 p-2 text-[11px] text-amber-200"><input type="checkbox" checked={state.confirmOutlier} onChange={(e) => set({ confirmOutlier: e.target.checked })} className="mt-0.5" data-testid="outlier-confirm" />That value is far from the value guide and it&apos;s right.</label>
          ) : null}
          <p className="text-[10px] text-ink-faint">{TRADE_ESTIMATE_COPY} Non-binding.</p>
        </>
      )}
    </div>
  );
}
