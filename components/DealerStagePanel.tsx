"use client";

import React, { useState } from "react";
import { FINANCE_TERM_OPTIONS, MAX_APR, monthlyPayment, stageSummary, type DealStageState, type StageAction } from "../lib/dealStages";
import { DealStageBar } from "./DealStageBar";

const usd = (n: number | null | undefined) => (typeof n === "number" ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—");

/**
 * The dealer's side of a staged Cash / Finance deal, on their tokened quote page: where the deal is, and the one thing
 * they can do next (offer a trade value, answer the buyer's counter, quote financing) or walk away. The itemized OTD
 * quote itself is the sheet on this page; accepting the buyer's OTD counter is the "Accept buyer's counter" button there.
 */
export function DealerStagePanel({ token, stage, quotedOtd, hasTrade, rfqOpen, onChanged }: { token: string; stage: DealStageState; quotedOtd: number | null; hasTrade: boolean; rfqOpen: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [basis, setBasis] = useState<"preliminary" | "firm">("preliminary");
  const [apr, setApr] = useState("");
  const [term, setTerm] = useState("60");
  const [lender, setLender] = useState("");
  const [confirmWalk, setConfirmWalk] = useState(false);
  const t = stage.trade;
  const p = stage.payment;
  const open = rfqOpen && stage.stage !== "closed" && stage.stage !== "walked";

  const act = async (action: StageAction) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/quote-invite/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token, action }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || "That didn't go through."); return; }
      setValue(""); setConfirmWalk(false);
      onChanged();
    } catch {
      setError("Could not reach TrimScout. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const financeAmount = stage.trueOtd != null && p.downPayment != null ? Math.round((stage.trueOtd - p.downPayment) * 100) / 100 : null;
  const previewMonthly = financeAmount != null && apr.trim() !== "" ? monthlyPayment(financeAmount, Number(apr), Number(term)) : null;
  const btn = "rounded-lg px-3 py-1.5 text-xs font-extrabold disabled:opacity-50";
  const primary = `${btn} bg-brand-500 text-black hover:bg-brand-400`;
  const ghost = `${btn} border border-border text-ink-light hover:text-white font-bold`;
  const input = "w-32 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-white";

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-5" data-testid="dealer-stage-panel" data-stage={stage.stage}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-white">Deal progress</h2>
        <span className="text-xs text-ink-muted">{stageSummary(stage)}</span>
      </div>
      <DealStageBar state={stage} />

      {stage.otd.amount != null ? (
        <p className="text-xs text-ink-light">Out-the-door locked at <strong className="text-white">{usd(stage.otd.amount)}</strong>{stage.trueOtd != null && stage.trueOtd !== stage.otd.amount ? <> · true out-the-door after the trade <strong className="text-white">{usd(stage.trueOtd)}</strong></> : null}.</p>
      ) : null}

      {open && stage.stage === "otd" ? (
        <p className="text-xs text-ink-muted" data-testid="dealer-stage-otd">
          Stage 1: your itemized out-the-door quote{quotedOtd != null ? <> ({usd(quotedOtd)})</> : null} is the sheet on this page. It locks when the buyer accepts it, or when you accept their counter. No financing terms yet.
        </p>
      ) : null}

      {open && stage.stage === "trade" ? (
        <div className="space-y-2" data-testid="dealer-stage-trade">
          {!hasTrade ? (
            <p className="text-xs text-amber-200">The buyer hasn&apos;t added the trade-in yet, so there is nothing to value.</p>
          ) : t.counter && !t.counterAnswered ? (
            <>
              <p className="text-xs text-white">You offered <strong>{usd(t.offer?.value)}</strong>. The buyer countered <strong>{usd(t.counter.value)}</strong>.{t.counter.note ? ` "${t.counter.note}"` : ""} Accept it, or send one revised offer (then they accept or walk).</p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy} onClick={() => act({ type: "trade_accept_counter" })} className={primary} data-testid="accept-trade-counter">Accept {usd(t.counter.value)}</button>
                <input inputMode="decimal" aria-label="Revised trade value" placeholder="Revised value $" value={value} onChange={(e) => setValue(e.target.value)} className={input} />
                <button type="button" disabled={busy || !value.trim()} onClick={() => act({ type: "trade_offer", value, basis })} className={ghost} data-testid="revise-trade-offer">Send revised offer</button>
              </div>
            </>
          ) : t.offer ? (
            <p className="text-xs text-ink-muted">Your offer of {usd(t.offer.value)} is with the buyer. They accept, counter once, or walk away.</p>
          ) : (
            <>
              <p className="text-xs text-ink-muted">Stage 2: value the buyer&apos;s trade-in (details and photos are in the trade section below). Your number is a request, not a bid.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input inputMode="decimal" aria-label="Trade value" placeholder="Trade value $" value={value} onChange={(e) => setValue(e.target.value)} className={input} data-testid="trade-offer-input" />
                <select aria-label="Valuation basis" value={basis} onChange={(e) => setBasis(e.target.value as "preliminary" | "firm")} className={input}>
                  <option value="preliminary">Preliminary</option>
                  <option value="firm">Firm</option>
                </select>
                <button type="button" disabled={busy || !value.trim()} onClick={() => act({ type: "trade_offer", value, basis })} className={primary} data-testid="send-trade-offer">Offer this trade value</button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {open && stage.stage === "payment" ? (
        <div className="space-y-2" data-testid="dealer-stage-payment">
          {!p.financeRequestedAt ? (
            <p className="text-xs text-ink-muted">Stage 3: the buyer is choosing between paying cash at {usd(stage.trueOtd)} and asking you for financing.</p>
          ) : (
            <>
              <p className="text-xs text-white">
                The buyer wants financing: true out-the-door {usd(stage.trueOtd)} less {usd(p.downPayment)} down = <strong>{usd(financeAmount)}</strong> to finance.
                {p.preferredTermMonths ? ` They'd like ${p.preferredTermMonths} months.` : ""}
                {p.outsideFinancing ? " They have outside financing to compare." : ""}
              </p>
              {p.financeQuote ? <p className="text-xs text-ink-muted" data-testid="dealer-finance-sent">Quoted {p.financeQuote.apr}% for {p.financeQuote.termMonths} months ({usd(p.financeQuote.monthly)}/mo). You can send a revised quote until they accept.</p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <input inputMode="decimal" aria-label="APR percent" placeholder={`APR % (0-${MAX_APR})`} value={apr} onChange={(e) => setApr(e.target.value)} className={input} data-testid="apr-input" />
                <select aria-label="Term" value={term} onChange={(e) => setTerm(e.target.value)} className={input}>
                  {FINANCE_TERM_OPTIONS.map((m: number) => <option key={m} value={m}>{m} months</option>)}
                </select>
                <input aria-label="Lender (optional)" placeholder="Lender (optional)" value={lender} onChange={(e) => setLender(e.target.value)} className="w-40 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-white" />
                <button type="button" disabled={busy || apr.trim() === ""} onClick={() => act({ type: "finance_quote", apr, termMonths: term, lenderName: lender })} className={primary} data-testid="send-finance-quote">Send financing quote</button>
              </div>
              {previewMonthly != null ? <p className="text-[11px] text-ink-faint" data-testid="finance-preview">Payment on those terms: {usd(previewMonthly)}/mo (calculated from amount financed, APR and term; you don&apos;t type it).</p> : null}
            </>
          )}
        </div>
      ) : null}

      {stage.stage === "closed" ? (
        <p className="text-xs text-emerald-300" data-testid="dealer-stage-closed">
          {p.method === "finance" ? `The buyer accepted financing: ${usd(p.financeQuote?.monthly)}/mo on ${usd(p.financeQuote?.amountFinanced)}.` : `The buyer is paying cash: ${usd(stage.trueOtd)} out the door.`} Nothing is binding until you both sign.
        </p>
      ) : null}
      {stage.stage === "walked" ? <p className="text-xs text-rose-200" data-testid="dealer-stage-walked">{stage.walk?.by === "buyer" ? "The buyer walked away." : "You walked away."} Nothing was binding.</p> : null}

      {error ? <p className="text-xs text-rose-300" role="alert">{error}</p> : null}
      {open ? (
        <div className="flex items-center gap-2">
          {confirmWalk ? (
            <>
              <span className="text-xs text-ink-muted">Walk away from this deal?</span>
              <button type="button" disabled={busy} onClick={() => act({ type: "walk" })} className={`${ghost} text-rose-300`} data-testid="dealer-confirm-walk">Yes, walk away</button>
              <button type="button" onClick={() => setConfirmWalk(false)} className={ghost}>Keep going</button>
            </>
          ) : <button type="button" onClick={() => setConfirmWalk(true)} className={ghost} data-testid="dealer-walk-stage">Walk away from this deal</button>}
        </div>
      ) : null}
    </section>
  );
}
