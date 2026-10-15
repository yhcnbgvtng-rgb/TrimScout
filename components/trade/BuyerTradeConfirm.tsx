"use client";

import React, { useState } from "react";
import type { RfqRequest } from "../../lib/rfq";
import { chipLabel, effectiveStatus, isSettled, openConfirmationOf, REVISION_REASONS, type TradeConfirmation } from "../../lib/trade/confirm";
import { revisionEffects } from "../../lib/trade/confirmView";
import { BASIS_LABELS } from "../../lib/trade/types";

const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n * 100) / 100).toLocaleString()}`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The buyer's side of the trade confirm step, after they pick a quote on a request with a trade-in.
 *   waiting   the selected dealer confirms or revises their trade number (deadline shown; the original number stands if it lapses)
 *   revised   before and after, the reason, what it does to the deal; accept it, go back and pick another quote (everyone else's
 *             numbers untouched), or walk away
 *   settled   the final number
 * Walking away is always one click. Everything is in-app: there is no email to answer.
 */
export function BuyerTradeConfirm({ rfq, headers, onRfq }: { rfq: RfqRequest; headers: Record<string, string>; onRfq: (r: RfqRequest) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!rfq.tradeIn) return null;
  const now = new Date();
  const open = openConfirmationOf(rfq, now);
  // Settled summary for the dealer the buyer chose.
  const chosen = rfq.status === "picked" ? rfq.invites.find((i) => i.quote?.id === rfq.pickedQuoteId) : null;
  const settled = chosen?.tradeConfirmation && isSettled(chosen.tradeConfirmation, now) ? chosen : null;

  const act = async (action: "accept_revised" | "go_back" | "walk") => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/rfqs/${rfq.id}/trade-confirm`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ action }) });
      const json = await res.json().catch(() => ({}));
      if (json.rfq) onRfq(json.rfq);
      if (!res.ok) setError(json.error || "Couldn't record that.");
    } finally { setBusy(false); }
  };

  if (settled?.tradeConfirmation) {
    const c = settled.tradeConfirmation;
    const final = c.allowanceFinal ?? c.allowancePrelim;
    return (
      <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm text-ink-light" data-testid="trade-final">
        <p className="font-bold text-white">Your trade value is final: {usd(final)}</p>
        <p className="text-xs">{effectiveStatus(c, now) === "expired" ? `${settled.dealerName} didn't respond by the deadline, so the number they quoted stands.` : c.status === "revised" ? `You accepted ${settled.dealerName}'s revised number (they quoted ${usd(c.allowancePrelim)}).` : `${settled.dealerName} confirmed the number they quoted.`}</p>
      </section>
    );
  }
  if (!open) return null;

  const { invite, confirmation: c } = open;
  const status = effectiveStatus(c, now);
  const walk = <button type="button" onClick={() => act("walk")} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="confirm-walk-away">Walk away from this request</button>;

  if (status === "pending") {
    return (
      <section className="space-y-2 rounded-2xl border border-sky-500/40 bg-sky-950/20 p-4 text-sm text-sky-100" data-testid="trade-confirm-waiting">
        <p className="font-bold text-white">{invite.dealerName} is confirming your trade value</p>
        <p className="text-xs">They quoted <strong>{c.range ? `${usd(c.range.low)} to ${usd(c.range.high)}` : usd(c.allowancePrelim)}</strong> ({BASIS_LABELS[c.basis]}). They have until <strong>{when(c.deadlineAt)}</strong> to confirm it or revise it. If they don&apos;t, their quoted number stands. Nothing for you to do.</p>
        {error ? <p className="text-xs text-amber-200">{error}</p> : null}
        {walk}
      </section>
    );
  }

  // revised, waiting on the buyer
  const effects = revisionEffects(rfq, invite, c);
  const reason = c.revisionReasonCode ? REVISION_REASONS[c.revisionReasonCode] : "";
  const dropped = (c.revisionDelta ?? 0) < 0;
  return (
    <section className="space-y-3 rounded-2xl border border-amber-500/50 bg-amber-950/20 p-4 text-sm text-amber-50" data-testid="trade-confirm-revised">
      <div>
        <p className="font-bold text-white">{invite.dealerName} revised your trade value</p>
        <p className="text-xs text-amber-100/90">You chose this quote. They changed the trade number from {usd(c.allowancePrelim)} to {usd(c.allowanceFinal ?? c.allowancePrelim)} ({dropped ? "lower" : "higher"} by {usd(Math.abs(c.revisionDelta ?? 0))}).{c.basis === "firm" ? " They had quoted it as Firm." : ""}</p>
      </div>
      <table className="w-full border-collapse text-xs" data-testid="revision-table">
        <thead><tr className="text-left text-[10px] uppercase tracking-wide text-amber-200/80"><th className="py-1 pr-2">&nbsp;</th><th className="py-1 pr-2 text-right">Quoted</th><th className="py-1 text-right">Revised</th></tr></thead>
        <tbody>{effects.map((e) => <tr key={e.label} className="border-t border-amber-500/20"><td className="py-1 pr-2">{e.label}</td><td className="py-1 pr-2 text-right tabular-nums">{e.before}</td><td className="py-1 text-right font-bold tabular-nums text-white">{e.after}</td></tr>)}</tbody>
      </table>
      <div className="text-xs" data-testid="revision-reason">
        <p><strong className="text-white">Why:</strong> {reason}{c.revisionReasonText ? `. “${c.revisionReasonText}”` : ""}</p>
        {c.citedConditions.length ? <p className="text-amber-100/80">They pointed to what they listed with the quote: {c.citedConditions.map((k) => (k === "conditions_text" ? "their written conditions" : chipLabel(k))).join(", ")}.</p> : null}
      </div>
      <p className="text-[11px] text-amber-100/80">You can accept this number, or go back and pick another quote. The other dealers&apos; numbers are exactly as they were, and going back costs you nothing. {invite.dealerName} will show as Revised.</p>
      {error ? <p className="text-xs text-rose-200">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => act("accept_revised")} disabled={busy} className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-brand-400 disabled:opacity-50" data-testid="accept-revised">Accept revised number</button>
        <button type="button" onClick={() => act("go_back")} disabled={busy} className="rounded-lg border border-sky-400/60 px-4 py-2 text-xs font-bold text-sky-100 hover:bg-sky-500/10 disabled:opacity-50" data-testid="go-back">Go back and pick another quote</button>
        {walk}
      </div>
    </section>
  );
}
export type { TradeConfirmation };
