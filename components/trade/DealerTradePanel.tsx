"use client";

import { ErrorBoundary } from "../ErrorBoundary";
import { coerceTradeIn } from "../../lib/trade/coerce";
import React, { useEffect, useState } from "react";
import { TradeSummary } from "./TradeSummary";
import { TradeAllowanceFields } from "./TradeAllowanceFields";
import { DealerTradeConfirm } from "./DealerTradeConfirm";
import type { DealerTradeFeed } from "./useDealerTrade";
import { appraisalState } from "../../scrapers/lightsail-crawler/src/tradeConfirm.js";
import { checkTradeForm, tradeFormFrom, tradeFormReady, type TradeFormState } from "../../lib/trade/dealerForm";
import { OPTIONAL_PHOTO_SLOTS, PHOTO_SLOT_INFO, type OptionalSlot } from "../../lib/trade/types";

const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-brand-500 focus:outline-none tabular-nums";

/**
 * Dealer side of the trade, shown only when the buyer included one: read-only summary + photo gallery; the desk's own allowance
 * after the quote is in (edit it, or re-affirm it when the buyer changed the trade); the one-click confirm-or-revise step once the
 * buyer has selected this desk; and an optional one-time ask for more photos. While the quote is still unsent, the allowance lives in
 * the quote form itself (it is part of the price), not here. Everything stays inside TrimScout; nothing here sends or reads email.
 */
export function DealerTradePanel({ token, feed, onChanged }: { token: string; feed: { data: DealerTradeFeed | null; error: string | null; reload: () => Promise<unknown> }; onChanged?: () => void }) {
  const { data, error } = feed;
  const reload = async () => { await feed.reload(); onChanged?.(); };

  const [form, setForm] = useState<TradeFormState>(tradeFormFrom(null));
  const [seeded, setSeeded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null); const [problem, setProblem] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [askSlots, setAskSlots] = useState<OptionalSlot[]>([]); const [askNote, setAskNote] = useState(""); const [askMsg, setAskMsg] = useState<string | null>(null);

  useEffect(() => {
    const a = data?.appraisal; if (!a) return;
    const key = `${a.createdAt}|${a.reconfirmedAt ?? ""}`;
    if (seeded === key) return;
    setSeeded(key); setForm(tradeFormFrom(a));
  }, [data?.appraisal, seeded]);

  const trade = coerceTradeIn(data?.tradeIn);
  if (error) return <p className="rounded-xl border border-border bg-surface p-3 text-xs text-ink-muted">{error}</p>;
  if (!data || !trade) return null;
  const closed = !(data.appraisalOpen ?? data.rfqStatus === "collecting") || data.inviteStatus === "declined";
  const lien = trade.ownership !== "owned" || trade.payoffEstimate > 0;
  const quoted = data.inviteStatus === "quoted";
  const confirming = Boolean(data.confirmation);
  const given = data.appraisal ? appraisalState(data.appraisal, { quoteExpiresAt: data.quoteExpiresAt ?? null, tradeUpdatedAt: trade.updatedAt }) as { kind: string; stale: boolean } : null;
  const stale = Boolean(given?.stale);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/quote-invite/trade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token, ...body }) });
    return { res, j: await res.json().catch(() => ({})) };
  };
  const submit = async () => {
    setBusy(true); setMsg(null); setProblem(null);
    try {
      const c = checkTradeForm(form, { payoffEstimate: trade.payoffEstimate, ownership: trade.ownership, quoteExpiresAt: data.quoteExpiresAt ?? null });
      if (!c.ok) { setProblem(c.errors.join(" ")); return; }
      const { res, j } = await post(form.mode === "decline" ? { kind: "decline", ...c.trade } : { kind: "appraisal", ...c.trade });
      if (res.status === 409 && j.needsConfirmation) { setNeedsConfirm(true); setProblem(j.error); return; }
      if (!res.ok) { setProblem(j.error || "Couldn't save the trade allowance."); return; }
      setNeedsConfirm(false); setMsg("Trade allowance sent to the buyer."); await reload();
    } finally { setBusy(false); }
  };
  const reconfirm = async () => {
    setBusy(true); setMsg(null); setProblem(null);
    try {
      const { res, j } = await post({ kind: "reconfirm" });
      if (!res.ok) { setProblem(j.error || "Couldn't reconfirm."); return; }
      setMsg("Thanks. The buyer sees your allowance as confirmed for their updated trade."); await reload();
    } finally { setBusy(false); }
  };
  const ask = async () => {
    setBusy(true); setAskMsg(null);
    try {
      const { res, j } = await post({ kind: "photo_request", slots: askSlots, note: askNote });
      if (!res.ok) { setAskMsg(j.error || "Couldn't send the request."); return; }
      setAskMsg("Request sent. The buyer sees it in TrimScout."); await reload();
    } finally { setBusy(false); }
  };
  const open = data.photoRequest?.status === "open";

  return (
    <section className="space-y-5 rounded-2xl border border-sky-500/40 bg-sky-950/10 p-5" data-testid="dealer-trade-panel">
      <div><h3 className="text-sm font-bold text-white">The buyer included a trade-in</h3><p className="text-[11px] text-ink-muted">The trade number goes with your vehicle quote and is part of the price the buyer compares.</p></div>
      <ErrorBoundary label="trade summary" resetKey={trade?.updatedAt}><TradeSummary trade={trade} signed={data.signed} /></ErrorBoundary>

      {confirming ? <DealerTradeConfirm token={token} feed={data} trade={trade} onChanged={reload} /> : null}

      {closed || confirming ? (closed && !confirming ? <p className="text-xs text-ink-muted">This request is closed. No trade number is needed.</p> : null) : (
        <>
          {quoted ? (
            <div className="space-y-3 border-t border-border/60 pt-4" data-testid="allowance-edit">
              <h4 className="text-sm font-bold text-white">Your trade allowance {data.appraisal ? <span className="ml-1 rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-brand-300">Sent</span> : <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-200">Needed</span>}</h4>
              {stale ? (
                <div className="space-y-2 rounded-lg border border-sky-500/40 bg-sky-950/20 p-3 text-xs text-sky-100" data-testid="stale-banner">
                  <p>The buyer changed the trade after you gave this number, so the buyer sees it marked <strong>Based on earlier details</strong>. Review the updated photos and details above, then update the number or say it still stands.</p>
                  <button type="button" disabled={busy} onClick={reconfirm} className="rounded-lg border border-sky-400/60 px-3 py-1.5 text-xs font-bold text-sky-100 hover:bg-sky-500/10 disabled:opacity-50" data-testid="reconfirm-appraisal">My number still stands</button>
                </div>
              ) : null}
              <TradeAllowanceFields state={form} set={(p) => setForm((s) => ({ ...s, ...p }))} trade={trade} needsOutlierConfirm={needsConfirm} />
              {problem ? <p className="rounded-lg border border-amber-500/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200" role="alert" data-testid="appraisal-problem">{problem}</p> : null}
              {msg ? <p className="text-[11px] text-emerald-300" data-testid="appraisal-ok">{msg}</p> : null}
              <button type="button" disabled={busy || !tradeFormReady(form, lien)} onClick={submit} className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-brand-400 disabled:opacity-50" data-testid="submit-appraisal">{busy ? "Sending…" : data.appraisal ? "Update trade allowance" : "Send trade allowance"}</button>
            </div>
          ) : null}

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
