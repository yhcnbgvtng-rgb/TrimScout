"use client";

import React, { useEffect, useMemo, useState } from "react";
import { TradeSummary, type SignedView } from "./TradeSummary";
import { allowanceOf, computeEquity } from "../../lib/trade/otd";
import { APPRAISAL_BASES, BASIS_COPY, BASIS_LABELS, OPTIONAL_PHOTO_SLOTS, PHOTO_SLOT_INFO, TRADE_ESTIMATE_COPY, type AppraisalBasis, type DealerTradeAppraisal, type OptionalSlot, type TradeInRecord, type TradePhotoRequest } from "../../lib/trade/types";

interface Loaded { tradeIn: TradeInRecord | null; signed: SignedView[]; appraisal: DealerTradeAppraisal | null; photoRequest: TradePhotoRequest | null; inviteStatus: string; rfqStatus: string }
const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-brand-500 focus:outline-none tabular-nums";
const label = "block text-[10px] font-bold uppercase tracking-wide text-ink-faint";
const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;
const toNum = (v: string): number | null => { const t = v.replace(/[$,\s]/g, ""); return t === "" || !Number.isFinite(Number(t)) ? null : Number(t); };

/**
 * Dealer side of the trade, shown only when the buyer included one: read-only summary + photo gallery, then the
 * appraisal (allowance single or range, Preliminary/Firm, good-until, payoff handling with live equity) and an
 * optional one-time ask for more photos. Everything stays inside TrimScout; nothing here sends or reads email.
 */
export function DealerTradePanel({ token, defaultGoodUntil }: { token: string; defaultGoodUntil?: string | null }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => fetch(`/api/quote-invite/trade?t=${encodeURIComponent(token)}`).then((r) => r.json()).then((j) => (j.error ? setError(j.error) : setData(j))).catch(() => setError("Couldn't load the trade-in."));
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  const [mode, setMode] = useState<"single" | "range">("single");
  const [single, setSingle] = useState(""); const [low, setLow] = useState(""); const [high, setHigh] = useState("");
  const [basis, setBasis] = useState<AppraisalBasis>("preliminary");
  const [goodUntil, setGoodUntil] = useState((defaultGoodUntil || "").slice(0, 10));
  const [payoffConfirmed, setPayoffConfirmed] = useState(false);
  const [conditions, setConditions] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null); const [problem, setProblem] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [askSlots, setAskSlots] = useState<OptionalSlot[]>([]); const [askNote, setAskNote] = useState(""); const [askMsg, setAskMsg] = useState<string | null>(null);

  useEffect(() => {
    const a = data?.appraisal; if (!a) return;
    if (a.allowanceSingle != null) { setMode("single"); setSingle(String(a.allowanceSingle)); } else { setMode("range"); setLow(String(a.allowanceLow ?? "")); setHigh(String(a.allowanceHigh ?? "")); }
    setBasis(a.basis); setGoodUntil(a.goodUntil.slice(0, 10)); if (a.conditions) setConditions(a.conditions);
  }, [data?.appraisal]);

  const trade = data?.tradeIn ?? null;
  const lien = Boolean(trade && (trade.ownership !== "owned" || trade.payoffEstimate > 0));
  const live = useMemo(() => {
    const v = allowanceOf(mode === "single" ? { allowanceSingle: toNum(single), allowanceLow: null, allowanceHigh: null } : { allowanceSingle: null, allowanceLow: toNum(low), allowanceHigh: toNum(high) });
    return v && trade ? { allowance: v, equity: computeEquity(v, trade.payoffEstimate), lowEq: v.low - trade.payoffEstimate, highEq: v.high - trade.payoffEstimate } : null;
  }, [mode, single, low, high, trade]);

  if (error) return <p className="rounded-xl border border-border bg-surface p-3 text-xs text-ink-muted">{error}</p>;
  if (!data || !trade) return null;
  const closed = data.rfqStatus !== "collecting" || data.inviteStatus === "declined";

  const submit = async (confirmOutlier = false) => {
    setBusy(true); setMsg(null); setProblem(null);
    try {
      const res = await fetch("/api/quote-invite/trade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token, kind: "appraisal", allowance: mode === "single" ? { mode, single } : { mode, low, high }, basis, goodUntil: goodUntil ? new Date(`${goodUntil}T23:59:59`).toISOString() : "", payoffConfirmed, conditions, confirmOutlier }) });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409 && j.needsConfirmation) { setNeedsConfirm(true); setProblem(j.error); return; }
      if (!res.ok) { setProblem(j.error || "Couldn't save the appraisal."); return; }
      setNeedsConfirm(false); setMsg("Trade appraisal sent to the buyer."); await reload();
    } finally { setBusy(false); }
  };
  const ask = async () => {
    setBusy(true); setAskMsg(null);
    try {
      const res = await fetch("/api/quote-invite/trade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token, kind: "photo_request", slots: askSlots, note: askNote }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setAskMsg(j.error || "Couldn't send the request."); return; }
      setAskMsg("Request sent. The buyer sees it in TrimScout."); await reload();
    } finally { setBusy(false); }
  };
  const open = data.photoRequest?.status === "open";

  return (
    <section className="space-y-5 rounded-2xl border border-sky-500/40 bg-sky-950/10 p-5" data-testid="dealer-trade-panel">
      <div><h3 className="text-sm font-bold text-white">The buyer included a trade-in</h3><p className="text-[11px] text-ink-muted">Appraise it here as its own line. Quote the car separately, exactly as you would without a trade.</p></div>
      <TradeSummary trade={trade} signed={data.signed} />

      {closed ? <p className="text-xs text-ink-muted">This request is closed. No appraisal is needed.</p> : (
        <>
          <div className="space-y-3 border-t border-border/60 pt-4" data-testid="appraisal-form">
            <h4 className="text-sm font-bold text-white">Your trade appraisal {data.appraisal ? <span className="ml-1 rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-brand-300">Sent. Edit to update</span> : null}</h4>
            <div className="flex gap-2" role="radiogroup" aria-label="Allowance type">
              {(["single", "range"] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${mode === m ? "border-brand-500 bg-brand-500/10 text-white" : "border-border text-ink-light"}`}>{m === "single" ? "One number" : "Low / high range"}</button>)}
            </div>
            {mode === "single" ? (
              <label className="block space-y-1"><span className={label}>Trade allowance ($)</span><input inputMode="decimal" value={single} onChange={(e) => setSingle(e.target.value)} className={input} aria-label="Trade allowance" data-testid="allowance-single" /></label>
            ) : (
              <div className="grid grid-cols-2 gap-3"><label className="space-y-1"><span className={label}>Low ($)</span><input inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} className={input} aria-label="Allowance low" data-testid="allowance-low" /></label><label className="space-y-1"><span className={label}>High ($)</span><input inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} className={input} aria-label="Allowance high" data-testid="allowance-high" /></label></div>
            )}
            <fieldset className="space-y-1.5"><legend className={label}>Valuation basis</legend>
              {APPRAISAL_BASES.map((b) => <label key={b} className="flex items-center gap-2 text-xs text-ink-light"><input type="radio" name="basis" checked={basis === b} onChange={() => setBasis(b)} data-testid={`basis-${b}`} />{BASIS_COPY[b]} <span className="text-[10px] text-ink-faint">(shown to the buyer as “{BASIS_LABELS[b]}”)</span></label>)}
            </fieldset>
            <label className="block space-y-1"><span className={label}>Good until</span><input type="date" value={goodUntil} onChange={(e) => setGoodUntil(e.target.value)} className={input} aria-label="Good until" data-testid="good-until" /><span className="text-[10px] text-ink-faint">Defaults to the same expiry as your vehicle quote.</span></label>
            <div className="space-y-1.5 rounded-lg border border-border bg-background/50 p-3 text-xs" data-testid="payoff-handling">
              <p className="text-ink-light">Estimated payoff used: <strong className="text-white">{usd(trade.payoffEstimate)}</strong>{trade.lenderName ? ` to ${trade.lenderName}` : ""}</p>
              {lien ? <label className="flex items-start gap-2 text-ink-light"><input type="checkbox" checked={payoffConfirmed} onChange={(e) => setPayoffConfirmed(e.target.checked)} className="mt-0.5" data-testid="payoff-confirm" />I&apos;ll pay off the lien, and the buyer&apos;s estimated payoff above was used.</label> : null}
              {live ? <p className={`font-bold ${live.equity < 0 ? "text-rose-300" : "text-emerald-300"}`} data-testid="live-equity">Net equity = allowance − payoff = {usd(live.equity)}{live.allowance.isRange ? ` (range ${usd(live.lowEq)} to ${usd(live.highEq)})` : ""}{live.equity < 0 ? " · negative equity" : ""}</p> : <p className="text-ink-faint">Enter an allowance to see the equity.</p>}
            </div>
            <label className="block space-y-1"><span className={label}>Conditions or notes <span className="font-normal normal-case">(optional)</span></span><textarea rows={2} maxLength={500} value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder='e.g. "assumes no frame damage", "needs 2nd key"' className={`${input} resize-none`} /></label>
            {problem ? <p className="rounded-lg border border-amber-500/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200" role="alert" data-testid="appraisal-problem">{problem}</p> : null}
            {msg ? <p className="text-[11px] text-emerald-300" data-testid="appraisal-ok">{msg}</p> : null}
            <p className="text-[10px] text-ink-faint">{TRADE_ESTIMATE_COPY} Non-binding.</p>
            <button type="button" disabled={busy} onClick={() => submit(needsConfirm)} className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-brand-400 disabled:opacity-50" data-testid="submit-appraisal">{busy ? "Sending…" : needsConfirm ? "Yes, that value is right. Send it" : data.appraisal ? "Update trade appraisal" : "Send trade appraisal"}</button>
          </div>

          <div className="space-y-2 border-t border-border/60 pt-4" data-testid="photo-request-form">
            <h4 className="text-sm font-bold text-white">Need more photos?</h4>
            {open ? <p className="text-xs text-ink-light" data-testid="photo-request-open">You asked for {data.photoRequest!.slots.map((s) => PHOTO_SLOT_INFO[s].label).join(", ") || "more detail"}{data.photoRequest!.note ? ` — “${data.photoRequest!.note}”` : ""}. The buyer sees it in TrimScout and the photos appear above when they upload them.</p> : data.photoRequest?.status === "fulfilled" ? <p className="text-xs text-emerald-300">The buyer added the photos you asked for. They&apos;re in the gallery above.</p> : null}
            {!open ? (
              <>
                <div className="flex flex-wrap gap-2">{OPTIONAL_PHOTO_SLOTS.map((s) => <label key={s} className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${askSlots.includes(s) ? "border-brand-500 bg-brand-500/10 text-white" : "border-border text-ink-light"}`}><input type="checkbox" className="sr-only" checked={askSlots.includes(s)} onChange={() => setAskSlots((c) => c.includes(s) ? c.filter((x) => x !== s) : [...c, s])} />{PHOTO_SLOT_INFO[s].label}</label>)}</div>
                <input value={askNote} onChange={(e) => setAskNote(e.target.value)} maxLength={300} placeholder="Or say what you'd like to see (optional)" className={input} aria-label="Photo request note" />
                {askMsg ? <p className="text-[11px] text-ink-light" role="status" data-testid="photo-request-msg">{askMsg}</p> : null}
                <button type="button" disabled={busy || (!askSlots.length && !askNote.trim())} onClick={ask} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="send-photo-request">Request more photos</button>
                <p className="text-[10px] text-ink-faint">One in-app request to the buyer; no email thread. The six core photos are always required, so they can&apos;t be requested again.</p>
              </>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
