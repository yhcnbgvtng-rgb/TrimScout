"use client";

import React, { useState } from "react";
import type { RfqInvite, RfqRequest } from "../lib/rfq";
import { FINANCE_TERM_OPTIONS, stageOf, stageSummary, type DealStageState, type StageAction } from "../lib/dealStages";
import { cashOutTheDoor } from "../lib/usedQuote";
import { isExpired } from "../lib/leaseQuote";
import { DealStageBar } from "./DealStageBar";

const usd = (n: number | null | undefined) => (typeof n === "number" ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—");
const NO_BINDING = "A request, not a bid: nothing here binds you, and you can walk away at any stage.";

/** One dealer's stage card: where the deal is, the numbers locked so far, and the next thing the buyer can do. */
function DealCard({ rfq, invite, stage, headers, onRfq }: { rfq: RfqRequest; invite: RfqInvite; stage: DealStageState; headers: Record<string, string>; onRfq: (r: RfqRequest) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counterValue, setCounterValue] = useState("");
  const [down, setDown] = useState("");
  const [term, setTerm] = useState("");
  const [outside, setOutside] = useState(false);
  const [confirmWalk, setConfirmWalk] = useState(false);
  const open = rfq.status === "collecting" && stage.stage !== "closed" && stage.stage !== "walked" && !invite.dealerUnsubscribedAt;
  const used = invite.quote?.used?.kind === "cash" ? invite.quote.used : null;
  const quoteLive = Boolean(used) && invite.status === "quoted" && !isExpired({ expiresAt: used!.expiresAt });

  const act = async (action: StageAction) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/rfqs/${rfq.id}/invites/${invite.id}/stage`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ action }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || "That didn't go through."); return; }
      onRfq(json.rfq as RfqRequest);
      setConfirmWalk(false);
    } catch {
      setError("Could not reach TrimScout. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const t = stage.trade;
  const p = stage.payment;
  const btn = "rounded-lg px-3 py-1.5 text-[11px] font-extrabold disabled:opacity-50";
  const primary = `${btn} bg-brand-500 text-black hover:bg-brand-400`;
  const ghost = `${btn} border border-border text-ink-light hover:text-white font-bold`;
  const input = "w-28 rounded-lg border border-border bg-surface px-2 py-1 text-[11px] text-white";

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4" data-testid="staged-deal-card" data-invite={invite.id} data-stage={stage.stage}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-white">{invite.dealerName}</h3>
        <span className="text-[11px] text-ink-muted" data-testid="stage-summary">{stageSummary(stage)}</span>
      </div>
      <DealStageBar state={stage} />

      {stage.otd.amount != null || stage.trueOtd != null ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4" data-testid="locked-numbers">
          {stage.otd.amount != null ? <div><dt className="text-ink-faint">Agreed out-the-door</dt><dd className="font-bold text-white">{usd(stage.otd.amount)}</dd></div> : null}
          {t.value != null ? <div><dt className="text-ink-faint">Trade value</dt><dd className="font-bold text-white">{usd(t.value)}</dd></div> : null}
          {stage.trueOtd != null ? <div><dt className="text-ink-faint">True out-the-door</dt><dd className="font-bold text-emerald-300" data-testid="true-otd">{usd(stage.trueOtd)}</dd></div> : null}
        </dl>
      ) : null}
      {t.status === "locked" && (t.value ?? 0) > 0 ? (
        <p className="text-[10px] text-ink-faint" data-testid="trade-tax-note">Trade-in may lower your sales tax — dealer will confirm</p>
      ) : null}

      {open && stage.stage === "otd" ? (
        <div className="space-y-2" data-testid="stage-otd-actions">
          {quoteLive ? (
            <>
              <p className="text-[11px] text-ink-muted">Accept this out-the-door price to lock it, or counter below. Finance terms come after your trade-in.</p>
              <button type="button" disabled={busy} onClick={() => act({ type: "accept_otd" })} className={primary} data-testid="accept-otd">Accept {usd(cashOutTheDoor(used!))} out the door</button>
            </>
          ) : invite.buyerCounter && invite.status === "invited" ? (
            <p className="text-[11px] text-ink-muted">Your counter is with the dealer. If they accept it, the price locks.</p>
          ) : (
            <p className="text-[11px] text-ink-muted">Waiting for this dealer&apos;s itemized out-the-door quote.</p>
          )}
        </div>
      ) : null}

      {open && stage.stage === "trade" ? (
        <div className="space-y-2" data-testid="stage-trade-actions">
          {!rfq.tradeIn ? (
            <p className="text-[11px] text-amber-200">Your trade-in details didn&apos;t attach to this request, so the dealer can&apos;t value it yet.</p>
          ) : !t.offer ? (
            <p className="text-[11px] text-ink-muted">Your trade-in is with the dealer. Waiting for their trade value.</p>
          ) : (
            <>
              <p className="text-[11px] text-white">
                Trade offer: <strong>{usd(t.offer.value)}</strong> <span className="text-ink-faint">({t.offer.basis === "firm" ? "firm" : "preliminary"}{t.offer.revised ? ", revised after your counter" : ""})</span>
                {t.counter ? <> · Your counter: <strong>{usd(t.counter.value)}</strong></> : null}
              </p>
              {t.counter && !t.counterAnswered ? (
                <p className="text-[11px] text-ink-muted">Your counter is with the dealer. You can wait for their answer or walk away.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={busy} onClick={() => act({ type: "trade_accept" })} className={primary} data-testid="accept-trade">Accept {usd(t.offer.value)}</button>
                  {!t.counterUsed ? (
                    <>
                      <input inputMode="decimal" aria-label="Your trade value" placeholder="Your number" value={counterValue} onChange={(e) => setCounterValue(e.target.value)} className={input} data-testid="trade-counter-input" />
                      <button type="button" disabled={busy || !counterValue.trim()} onClick={() => act({ type: "trade_counter", value: counterValue })} className={ghost} data-testid="counter-trade">Counter once</button>
                    </>
                  ) : <span className="text-[10px] text-ink-faint">You&apos;ve used your one counter.</span>}
                </div>
              )}
            </>
          )}
        </div>
      ) : null}

      {open && stage.stage === "payment" ? (
        <div className="space-y-2" data-testid="stage-payment-actions">
          <p className="text-[11px] text-ink-muted">True out-the-door {usd(stage.trueOtd)}. Pay cash at that number, or have the dealer quote financing on it.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} onClick={() => act({ type: "choose_cash" })} className={primary} data-testid="choose-cash">Pay cash {usd(stage.trueOtd)}</button>
          </div>
          {p.financeQuote ? (
            <div className="rounded-lg border border-border/70 p-2 text-[11px] text-white" data-testid="finance-quote">
              <strong>{usd(p.financeQuote.monthly)}/mo</strong> · {p.financeQuote.apr}% APR · {p.financeQuote.termMonths} months · {usd(p.financeQuote.amountFinanced)} financed ({usd(p.financeQuote.trueOtd)} less {usd(p.financeQuote.downPayment)} down)
              {p.outsideFinancing ? <span className="block text-ink-faint">Compare against your outside financing before you accept.</span> : null}
              <div className="mt-2"><button type="button" disabled={busy} onClick={() => act({ type: "finance_accept" })} className={primary} data-testid="accept-financing">Accept this financing</button></div>
            </div>
          ) : p.financeRequestedAt ? (
            <p className="text-[11px] text-ink-muted" data-testid="finance-waiting">Financing requested ({usd(p.downPayment)} down). Waiting for the dealer&apos;s APR and term.</p>
          ) : null}
          <details className="rounded-lg border border-border/60 p-2" open={!p.financeRequestedAt}>
            <summary className="cursor-pointer text-[11px] font-bold text-ink-light">{p.financeRequestedAt ? "Change my down payment" : "Get financing"}</summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input inputMode="decimal" aria-label="Down payment" placeholder="Down payment $" value={down} onChange={(e) => setDown(e.target.value)} className={input} data-testid="down-input" />
              <select aria-label="Preferred term" value={term} onChange={(e) => setTerm(e.target.value)} className={input}>
                <option value="">Any term</option>
                {FINANCE_TERM_OPTIONS.map((m: number) => <option key={m} value={m}>{m} months</option>)}
              </select>
              <label className="flex items-center gap-1 text-[10px] text-ink-muted"><input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} /> I have outside financing to compare</label>
              <button type="button" disabled={busy} onClick={() => act({ type: "request_finance", downPayment: down || 0, termMonths: term || null, outsideFinancing: outside })} className={ghost} data-testid="request-financing">Ask for a financing quote</button>
            </div>
          </details>
        </div>
      ) : null}

      {stage.stage === "closed" ? (
        <p className="text-[11px] text-emerald-300" data-testid="stage-closed">
          {p.method === "finance" ? `Financing accepted: ${usd(p.financeQuote?.monthly)}/mo on ${usd(p.financeQuote?.amountFinanced)}.` : `Paying cash: ${usd(stage.trueOtd)} out the door.`} The dealer has your pick.
        </p>
      ) : null}
      {stage.stage === "walked" ? (
        <p className="text-[11px] text-rose-200" data-testid="stage-walked">{stage.walk?.by === "dealer" ? "The dealer walked away from this deal." : "You walked away from this deal."} Nothing was binding.</p>
      ) : null}

      {error ? <p className="text-[11px] text-rose-300" role="alert">{error}</p> : null}
      {open ? (
        <div className="flex items-center gap-2">
          {confirmWalk ? (
            <>
              <span className="text-[11px] text-ink-muted">Walk away from {invite.dealerName}?</span>
              <button type="button" disabled={busy} onClick={() => act({ type: "walk" })} className={`${ghost} text-rose-300`} data-testid="confirm-walk">Yes, walk away</button>
              <button type="button" onClick={() => setConfirmWalk(false)} className={ghost}>Keep going</button>
            </>
          ) : <button type="button" onClick={() => setConfirmWalk(true)} className={ghost} data-testid="walk-stage">Walk away</button>}
        </div>
      ) : null}
    </section>
  );
}

/** The staged Cash / Finance deals for a request: a one-line-per-dealer overview, then each dealer's card. */
export function StagedDeals({ rfq, headers, onRfq, onWalkAll }: { rfq: RfqRequest; headers: Record<string, string>; onRfq: (r: RfqRequest) => void; /** Ends the whole request (every dealer) in one step. */ onWalkAll?: () => void }) {
  const cards = rfq.invites
    .filter((i) => i.status !== "declined" && i.status !== "expired")
    .map((i) => ({ invite: i, stage: stageOf(rfq, i) }))
    .filter((c): c is { invite: RfqInvite; stage: DealStageState } => Boolean(c.stage));
  if (cards.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="staged-deals">
      <h2 className="text-sm font-bold text-white">Your deal, step by step</h2>
      <p className="text-[11px] text-ink-muted">
        1. Agree the out-the-door price. 2. Value your trade-in{rfq.tradeInExpected ? "" : " (skipped: you have no trade-in)"}. 3. Pay cash, or have the dealer quote financing on the true out-the-door. Each dealer moves through these separately. {NO_BINDING}
      </p>
      {cards.length > 1 ? (
        <ul className="divide-y divide-border/60 rounded-xl border border-border text-[11px]" data-testid="stage-overview">
          {cards.map(({ invite, stage }) => (
            <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
              <span className="font-bold text-white">{invite.dealerName}</span>
              <span className="text-ink-muted">{stageSummary(stage)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {cards.map(({ invite, stage }) => <DealCard key={invite.id} rfq={rfq} invite={invite} stage={stage} headers={headers} onRfq={onRfq} />)}
      {onWalkAll && rfq.status === "collecting" ? (
        <button type="button" onClick={onWalkAll} className="text-[11px] font-bold text-ink-muted hover:text-rose-400" data-testid="walk-all">Walk away from every dealer</button>
      ) : null}
    </div>
  );
}
