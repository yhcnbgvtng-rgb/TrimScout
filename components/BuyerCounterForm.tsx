"use client";

import React, { useState } from "react";
import { COUNTER_COPY, buildBuyerCounter, counterDraftFrom, counterSummary, type CounterDraft } from "../lib/buyerCounter";
import { LEASE_MILES, LEASE_TERMS, type LeaseQuote, type LeaseRequestPrefs } from "../lib/leaseQuote";
import type { BuyerCounter } from "../lib/rfq";

/**
 * The buyer's counter to one dealer's quote — structured fields only
 * (target monthly, max due at signing, term / miles, a short note). Sent to
 * that dealer alone; they revise through the calculator or decline. Never
 * a free-text number, no competitive-sale chrome.
 */
export function BuyerCounterForm({
  dealerName,
  quote,
  quoteId,
  prefs,
  onSubmit,
  onCancel,
}: {
  dealerName: string;
  quote: LeaseQuote;
  quoteId: string;
  prefs: LeaseRequestPrefs;
  onSubmit: (counter: BuyerCounter) => Promise<void>;
  onCancel: () => void;
}) {
  const [d, setD] = useState<CounterDraft>(() => counterDraftFrom(quote, prefs));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof CounterDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD((p) => ({ ...p, [k]: e.target.value }));
  const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none tabular-nums";
  const label = "block text-[10px] font-bold uppercase tracking-wide text-ink-faint";
  const preview = buildBuyerCounter(d, quote, quoteId);

  const submit = async () => {
    const { counter, errors: errs } = buildBuyerCounter(d, quote, quoteId);
    if (!counter) {
      setErrors(errs);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      await onSubmit(counter);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "Could not send your counter."]);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-sky-500/40 bg-sky-950/20 p-4" data-testid="buyer-counter-form">
      <div>
        <p className="text-sm font-bold text-white">Counter {dealerName}&apos;s quote</p>
        <p className="text-[11px] text-ink-muted">
          They quoted <span className="font-semibold text-white">${Math.round(quote.monthlyPaymentPreTax).toLocaleString()}/mo</span> · {quote.termMonths} mo · {quote.milesPerYear.toLocaleString()} mi/yr. Ask for the numbers you want; they revise through their calculator or say they can&apos;t.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="space-y-1">
          <span className={label}>Target monthly (max)</span>
          <span className="relative block">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-faint">$</span>
            <input type="text" inputMode="numeric" value={d.targetMonthlyMax} onChange={set("targetMonthlyMax")} placeholder="e.g. 650" className={`${input} pl-6 font-mono`} aria-label="Target monthly, maximum" />
          </span>
        </label>
        <label className="space-y-1">
          <span className={label}>Max due at signing</span>
          <span className="relative block">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-faint">$</span>
            <input type="text" inputMode="numeric" value={d.maxCashDueAtSigning} onChange={set("maxCashDueAtSigning")} placeholder="e.g. 1500" className={`${input} pl-6 font-mono`} aria-label="Max due at signing" />
          </span>
        </label>
        <label className="space-y-1">
          <span className={label}>Term</span>
          <select value={d.termMonths} onChange={set("termMonths")} className={input} aria-label="Counter term">
            {LEASE_TERMS.map((t) => (
              <option key={t} value={t}>{t} mo{t === quote.termMonths ? " (as quoted)" : ""}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={label}>Miles / year</span>
          <select value={d.milesPerYear} onChange={set("milesPerYear")} className={input} aria-label="Counter miles per year">
            {LEASE_MILES.map((m) => (
              <option key={m} value={m}>{m.toLocaleString()}{m === quote.milesPerYear ? " (as quoted)" : ""}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1">
        <span className={label}>Note (optional)</span>
        <input type="text" value={d.note} onChange={set("note")} maxLength={300} placeholder="e.g. Can you get closer to $650 with the acquisition fee rolled in?" className={input} aria-label="Counter note" />
      </label>
      {preview.counter ? <p className="text-[11px] text-ink-light">You&apos;re asking {dealerName} for: <span className="font-semibold text-white">{counterSummary(preview.counter)}</span></p> : null}
      {errors.length ? (
        <ul className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300 space-y-0.5">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={submit} disabled={busy} className="rounded-lg bg-sky-400 px-4 py-2 text-xs font-extrabold text-black hover:bg-sky-300 disabled:opacity-50" data-testid="send-counter">
          {busy ? "Sending…" : "Send counter"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-xs font-bold text-ink-light hover:text-white">
          Cancel
        </button>
        <span className="text-[10px] text-ink-faint">{COUNTER_COPY}</span>
      </div>
    </div>
  );
}
