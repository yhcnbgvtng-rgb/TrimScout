"use client";

import React, { useState } from "react";
import type { RfqRequest } from "../lib/rfq";
import { needsTradePrompt, TRADE_PROMPT_COPY } from "../lib/acceptTrade";
import { TradeInStep, type TradeStepState } from "./trade/TradeInStep";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const dismissKey = (rfqId: string) => `trimscout.skipTrade.${rfqId}`;
const wasDismissed = (rfqId: string) => { try { return localStorage.getItem(dismissKey(rfqId)) === "1"; } catch { return false; } };

/**
 * Shown right after the buyer accepts a dealer's offer: "Add your trade-in" (the existing trade-in form from #414: year,
 * make, model, trim, mileage, VIN, condition, payoff, six photos) with an option to skip. The accepted price stays locked.
 * Cash / Finance and Lease both use it; the routes do the rest (lib/acceptTrade.ts).
 */
export function AddTradeInPrompt({ rfq, headers, defaultZip, onRfq }: { rfq: RfqRequest; headers: Record<string, string>; defaultZip?: string | null; onRfq: (r: RfqRequest) => void }) {
  const deal = needsTradePrompt(rfq);
  const [step, setStep] = useState<TradeStepState>({ ready: false, draftId: null, token: null, firstError: null });
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(() => (typeof window === "undefined" ? false : wasDismissed(rfq.id)));
  if (!deal || (skipped && !deal.tradeStageOpen)) return null;

  const post = async (url: string, body: unknown) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || "That didn't go through. Try again."); return null; }
      return json as { rfq: RfqRequest };
    } catch {
      setError("Could not reach TrimScout. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setAttempted(true);
    if (!step.ready || !step.draftId || !step.token) return;
    const json = await post(`/api/rfqs/${rfq.id}/trade-in`, { draftId: step.draftId, token: step.token });
    if (json) onRfq(json.rfq);
  };

  const skip = async () => {
    if (deal.tradeStageOpen) {
      // The trade stage is open (the buyer said a trade was coming): skipping moves the deal on to payment.
      const json = await post(`/api/rfqs/${rfq.id}/invites/${deal.invite.id}/stage`, { action: { type: "skip_trade" } });
      if (json) onRfq(json.rfq);
      return;
    }
    try { localStorage.setItem(dismissKey(rfq.id), "1"); } catch { /* private mode: dismissed for this view only */ }
    setSkipped(true);
  };

  return (
    <section className="space-y-4 rounded-2xl border border-brand-500/40 bg-brand-500/5 p-5" data-testid="add-trade-in-prompt" data-kind={deal.kind}>
      <div>
        <h2 className="text-sm font-bold text-white">{TRADE_PROMPT_COPY.title}</h2>
        <p className="mt-1 text-[11px] text-ink-muted" data-testid="trade-prompt-locked">
          {deal.kind === "lease" || deal.lockedOtd == null ? TRADE_PROMPT_COPY.leaseLine : TRADE_PROMPT_COPY.lockedLine(usd(deal.lockedOtd))}
        </p>
        <p className="mt-1 text-[11px] text-ink-faint">With {deal.invite.dealerName}. Only they see your trade-in.</p>
      </div>
      <TradeInStep enabled onToggle={(on) => { if (!on) void skip(); }} defaultZip={defaultZip} attempted={attempted} onState={setStep} />
      {error ? <p className="text-xs font-semibold text-rose-300" role="alert" data-testid="trade-prompt-error">{error}</p> : null}
      {!step.ready && step.firstError ? <p className="text-xs font-semibold text-amber-300" data-testid="trade-prompt-reason">{step.firstError}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={submit} disabled={busy} className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-brand-400 disabled:opacity-50" data-testid="trade-prompt-submit">{TRADE_PROMPT_COPY.submit}</button>
        <button type="button" onClick={skip} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="trade-prompt-skip">{TRADE_PROMPT_COPY.skip}</button>
      </div>
    </section>
  );
}
