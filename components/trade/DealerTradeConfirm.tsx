"use client";

import React, { useMemo, useState } from "react";
import { applyConfirmAction, CONDITIONS_TEXT_KEY, chipLabel, DEFAULT_THRESHOLD_PCT, GUARDRAIL_MIN_TEXT, REVISION_REASON_LIST, type TradeConfirmation } from "../../lib/trade/confirm";
import { toNum } from "../../lib/trade/dealerForm";
import { BASIS_LABELS, type TradeInRecord } from "../../lib/trade/types";
import type { DealerTradeFeed } from "./useDealerTrade";

const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-brand-500 focus:outline-none tabular-nums";
const label = "block text-[10px] font-bold uppercase tracking-wide text-ink-faint";
const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n * 100) / 100).toLocaleString()}`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The selected dealer's one in-app step: "Confirm as quoted" (one click) or "Revise trade value" (new number, a required reason,
 * and, for a big drop that cites none of the conditions the desk listed, a written explanation). If the deadline passes, the
 * original number stands. The same rules as the server run here first, so the form says what is missing before anything is sent.
 */
export function DealerTradeConfirm({ token, feed, trade, onChanged }: { token: string; feed: DealerTradeFeed & { thresholdPct?: number }; trade: TradeInRecord; onChanged: () => void | Promise<unknown> }) {
  const conf = feed.confirmation as TradeConfirmation;
  const status = (feed.confirmationStatus ?? conf.status) as TradeConfirmation["status"];
  const threshold = feed.thresholdPct ?? DEFAULT_THRESHOLD_PCT;
  const [revising, setRevising] = useState(false);
  const [rangePick, setRangePick] = useState(conf.range ? String(conf.allowancePrelim) : "");
  const [amount, setAmount] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [cited, setCited] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const chips = conf.originalConditions.chips;
  const citable = [...chips, ...(conf.originalConditions.hasText ? [CONDITIONS_TEXT_KEY] : [])];
  const firm = conf.basis === "firm";
  const payoff = conf.payoffUsed;
  const preview = useMemo(() => {
    if (!revising) return null;
    const r = applyConfirmAction(conf, { type: "revise", allowance: amount, reasonCode: reasonCode || undefined, reasonText, citedConditions: cited }, { now: new Date(), thresholdPct: threshold });
    return r.ok ? null : r;
  }, [revising, conf, amount, reasonCode, reasonText, cited, threshold]);
  const drop = (() => { const n = toNum(amount); const base = conf.range ? conf.range.low : conf.allowancePrelim; return n && base > 0 ? ((base - n) / base) * 100 : 0; })();
  const bigDrop = drop > threshold && cited.length === 0;

  const send = async (body: Record<string, unknown>, okMsg: string) => {
    setBusy(true); setProblem(null);
    try {
      const res = await fetch("/api/quote-invite/trade-confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token, ...body }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setProblem(j.error || "Couldn't record that."); return; }
      setDone(okMsg); setRevising(false); await onChanged();
    } finally { setBusy(false); }
  };

  const quoted = conf.range ? `${usd(conf.range.low)} to ${usd(conf.range.high)} (midpoint ${usd(conf.allowancePrelim)})` : usd(conf.allowancePrelim);
  const head = (
    <div>
      <h4 className="text-sm font-bold text-white">The buyer selected your quote: confirm the trade value</h4>
      <p className="text-[11px] text-ink-muted">You quoted <strong className="text-white">{quoted}</strong> for their {[trade.year, trade.make, trade.model].filter(Boolean).join(" ")}, <strong>{BASIS_LABELS[conf.basis]}</strong>{payoff ? `, against an estimated payoff of ${usd(payoff)}` : ""}.</p>
    </div>
  );

  if (status === "confirmed") return <div className="space-y-1 border-t border-border/60 pt-4" data-testid="confirm-done"><h4 className="text-sm font-bold text-white">Trade value confirmed</h4><p className="text-xs text-emerald-300">Confirmed at {usd(conf.allowanceFinal ?? conf.allowancePrelim)}. The buyer has been told.</p></div>;
  if (status === "expired") return <div className="space-y-1 border-t border-border/60 pt-4" data-testid="confirm-expired"><h4 className="text-sm font-bold text-white">Deadline passed</h4><p className="text-xs text-ink-light">Nothing was confirmed by {when(conf.deadlineAt)}, so your original number of {usd(conf.allowanceFinal ?? conf.allowancePrelim)} stands.</p></div>;
  if (status === "revised") {
    return (
      <div className="space-y-1 border-t border-border/60 pt-4" data-testid="confirm-revised">
        <h4 className="text-sm font-bold text-white">You revised the trade value</h4>
        <p className="text-xs text-ink-light">{usd(conf.allowancePrelim)} → <strong className="text-white">{usd(conf.allowanceFinal ?? conf.allowancePrelim)}</strong>. {conf.buyerDecision === "accepted" ? "The buyer accepted the revised number." : conf.buyerDecision === "went_back" ? "The buyer went back to compare other quotes. If they pick you again they will see your revised number." : conf.buyerDecision === "walked" ? "The buyer walked away from this request." : "Waiting for the buyer to accept it or go back. Nothing else is needed from you."}</p>
        {firm ? <p className="text-[11px] text-amber-200">This was a Firm number, so the revision is recorded.</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-border/60 pt-4" data-testid="confirm-step">
      {head}
      <p className="rounded-lg border border-amber-500/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-100" data-testid="confirm-deadline">Respond by <strong>{when(conf.deadlineAt)}</strong>. If nothing is done by then, your original number stands.</p>
      {done ? <p className="text-[11px] text-emerald-300" data-testid="confirm-sent">{done}</p> : null}
      {!revising ? (
        <div className="space-y-2">
          {conf.range ? (
            <label className="block space-y-1"><span className={label}>You quoted a range. Confirm one number inside it ($)</span><input inputMode="decimal" value={rangePick} onChange={(e) => setRangePick(e.target.value)} className={input} aria-label="Single number to confirm" data-testid="confirm-range-pick" /></label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || (Boolean(conf.range) && !toNum(rangePick))} onClick={() => send({ action: "confirm", ...(conf.range ? { allowance: rangePick } : {}) }, "Confirmed. The buyer has been told.")} className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-brand-400 disabled:opacity-50" data-testid="confirm-as-quoted">Confirm as quoted</button>
            <button type="button" disabled={busy} onClick={() => setRevising(true)} className="rounded-lg border border-border px-4 py-2 text-xs font-bold text-ink-light hover:text-white" data-testid="revise-trade">Revise trade value</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-border bg-background/50 p-3" data-testid="revise-form">
          {firm ? <p className="rounded-lg border border-rose-500/40 bg-rose-950/20 px-3 py-2 text-[11px] text-rose-200" data-testid="firm-warning">You quoted this as <strong>Firm</strong> (if the vehicle matches the description and photos). A revision is recorded against your desk, and the buyer sees the reason.</p> : null}
          <label className="block space-y-1"><span className={label}>Revised trade allowance ($) <span className="text-rose-300">*</span></span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={input} aria-label="Revised allowance" data-testid="revise-amount" /></label>
          <fieldset className="space-y-1.5"><legend className={label}>Reason <span className="text-rose-300">*</span></legend>
            {REVISION_REASON_LIST.map((r) => <label key={r.code} className="flex items-center gap-2 text-xs text-ink-light"><input type="radio" name="reason" checked={reasonCode === r.code} onChange={() => setReasonCode(r.code)} data-testid={`reason-${r.code}`} />{r.label}</label>)}
          </fieldset>
          {citable.length ? (
            <fieldset className="space-y-1.5"><legend className={label}>Does this come from a condition you listed? <span className="font-normal normal-case">(optional)</span></legend>
              {citable.map((c) => <label key={c} className="flex items-center gap-2 text-xs text-ink-light"><input type="checkbox" checked={cited.includes(c)} onChange={() => setCited((l) => l.includes(c) ? l.filter((x) => x !== c) : [...l, c])} data-testid={`cite-${c}`} />{c === CONDITIONS_TEXT_KEY ? "The conditions I wrote" : chipLabel(c)}</label>)}
            </fieldset>
          ) : null}
          <label className="block space-y-1"><span className={label}>Explain {reasonCode === "other" || bigDrop || firm && reasonCode === "other" ? <span className="text-rose-300">*</span> : <span className="font-normal normal-case">(optional)</span>}</span>
            <textarea rows={3} maxLength={500} value={reasonText} onChange={(e) => setReasonText(e.target.value)} className={`${input} resize-none`} aria-label="Explanation" data-testid="revise-text" />
            {bigDrop ? <span className="block text-[10px] text-amber-200" data-testid="guardrail-hint">This lowers your number by {Math.round(drop * 10) / 10}%, more than {threshold}%, and cites none of your listed conditions. Write at least {GUARDRAIL_MIN_TEXT} characters explaining it; it&apos;s flagged for internal review.</span> : null}
          </label>
          {problem ? <p className="rounded-lg border border-amber-500/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200" role="alert" data-testid="confirm-problem">{problem}</p> : null}
          {preview && (amount || reasonCode) ? <p className="text-[11px] text-ink-faint" data-testid="revise-missing">{preview.error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || Boolean(preview)} onClick={() => send({ action: "revise", allowance: amount, reasonCode, reasonText, citedConditions: cited }, "Revision sent. The buyer decides whether to accept it.")} className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-brand-400 disabled:opacity-50" data-testid="send-revision">Send revision</button>
            <button type="button" disabled={busy} onClick={() => { setRevising(false); setProblem(null); }} className="rounded-lg border border-border px-4 py-2 text-xs font-bold text-ink-light hover:text-white">Back</button>
          </div>
          <p className="text-[10px] text-ink-faint">The buyer sees your before and after, the reason, and what it does to their out-the-door. They can accept it, go back and pick another quote, or walk away. Nothing here is a reply to an email.</p>
        </div>
      )}
      {problem && !revising ? <p className="rounded-lg border border-amber-500/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200" role="alert" data-testid="confirm-problem">{problem}</p> : null}
    </div>
  );
}
