"use client";

import React, { useState } from "react";
import type { RfqInvite, RfqRequest } from "../lib/rfq";
import { CREDIT_RANGES, CREDIT_RANGE_LABELS, FINANCE_TERM_OPTIONS, finalSummary, liveTrueOtd, PAYMENT_METHOD_LABELS, stageOf, stageSummary, type CreditRange, type DealStageState, type StageAction } from "../lib/dealStages";
import { cashOutTheDoor } from "../lib/usedQuote";
import { COUNTER_DECLINED_STATUS } from "../lib/counterDeclined";
import { isExpired } from "../lib/leaseQuote";
import { DealStageBar } from "./DealStageBar";

/** Off until the box patch is installed; read at build time. */
const ACCEPT_ORIGINAL_ON = process.env.NEXT_PUBLIC_STAGED_ACCEPT_ORIGINAL === "on";

const usd = (n: number | null | undefined) => (typeof n === "number" ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—");
const NO_BINDING = "A request, not a bid: nothing here binds you, and you can walk away at any stage.";

/** Step 4: everything the buyer is about to accept, and the one button that also releases their details to this dealer. */
function FinalReview({ stage, dealerName, busy, onAccept, onChange, primary, ghost }: { stage: DealStageState; dealerName: string; busy: boolean; onAccept: () => void; onChange: () => void; primary: string; ghost: string }) {
  const sm = finalSummary(stage);
  const row = (k: string, v: string, id?: string) => <div className="flex justify-between gap-3" data-testid={id}><dt className="text-ink-faint">{k}</dt><dd className="text-right font-bold text-white">{v}</dd></div>;
  return (
    <div className="space-y-2" data-testid="stage-final-actions">
      <dl className="space-y-1 rounded-lg border border-border/70 p-3 text-[11px]" data-testid="final-summary">
        {row("Agreed out-the-door", usd(sm.otd))}
        {sm.tradeValue != null ? row("Trade-in", `-${usd(sm.tradeValue)}`) : null}
        {sm.payoff > 0 ? row("Payoff", `+${usd(sm.payoff)}`) : null}
        {row("True out-the-door", usd(sm.trueOtd), "final-true-otd")}
        {row("Payment", sm.method ? PAYMENT_METHOD_LABELS[sm.method] : "")}
        {sm.method === "own_financing" && sm.lenderName ? row("Your lender", sm.lenderName) : null}
        {sm.method === "dealer_finance" ? (
          <>
            {row("Down payment", usd(sm.downPayment))}
            {row("Amount financed", usd(sm.amountFinanced))}
            {row("APR / term", `${sm.apr}% / ${sm.termMonths} months`, "final-apr")}
            {row("Monthly payment", usd(sm.monthly), "final-monthly")}
            {row("Lender", sm.lenderName ?? "")}
          </>
        ) : null}
      </dl>
      <p className="text-[10px] text-ink-faint" data-testid="release-notice">When you accept, {dealerName} gets your name, email, phone and ZIP so they can finish the deal. No other dealer ever receives them. Until then, nobody has them.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={onAccept} className={primary} data-testid="accept-final">Accept final deal</button>
        <button type="button" disabled={busy} onClick={onChange} className={ghost} data-testid="change-payment">Change how I pay</button>
      </div>
    </div>
  );
}

/** One dealer's stage card: where the deal is, the numbers locked so far, and the next thing the buyer can do. */
function DealCard({ rfq, invite, stage, headers, onRfq }: { rfq: RfqRequest; invite: RfqInvite; stage: DealStageState; headers: Record<string, string>; onRfq: (r: RfqRequest) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counterValue, setCounterValue] = useState("");
  const [down, setDown] = useState("");
  const [term, setTerm] = useState("");
  const [outside, setOutside] = useState(false);
  const [counterNote, setCounterNote] = useState("");
  const [credit, setCredit] = useState("");
  const [ownLender, setOwnLender] = useState("");
  const [aprCounter, setAprCounter] = useState("");
  const [termCounter, setTermCounter] = useState("");
  const [paySel, setPaySel] = useState<"cash" | "own" | "dealer">("cash");
  const [confirmWalk, setConfirmWalk] = useState(false);
  const open = rfq.status === "collecting" && stage.stage !== "closed" && stage.stage !== "walked" && !invite.dealerUnsubscribedAt && !invite.notSelectedAt;
  const used = invite.quote?.used?.kind === "cash" ? invite.quote.used : null;
  // A declined counter leaves the original standing. The staged accept runs on the box, which only takes it once scripts/box/2026-10-29-rfq-staged-accept-original.sh is
  // installed (docs/STAGED_ACCEPT_ORIGINAL.md); set NEXT_PUBLIC_STAGED_ACCEPT_ORIGINAL=on after that. Until then the state shows without an accept button.
  const quoteLive = Boolean(used) && invite.status === "quoted" && (!invite.counterDeclined || ACCEPT_ORIGINAL_ON) && !isExpired({ expiresAt: used!.expiresAt });

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
  const input = "w-full min-w-0 rounded-lg border border-border bg-surface px-2 py-2 text-[12px] text-white sm:w-32 sm:py-1";
  const live = liveTrueOtd(stage);

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4" data-testid="staged-deal-card" data-invite={invite.id} data-stage={stage.stage}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-white">{invite.dealerName}</h3>
        <span className="text-[11px] text-ink-muted" data-testid="stage-summary">{stageSummary(stage, Boolean(invite.notSelectedAt))}</span>
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
              <p className="text-[11px] text-ink-muted">{invite.counterDeclined ? `${COUNTER_DECLINED_STATUS}. Accept it to lock it.` : "Accept this out-the-door price to lock it, or counter below."} Finance terms come after your trade-in.</p>
              <button type="button" disabled={busy} onClick={() => act({ type: "accept_otd" })} className={primary} data-testid="accept-otd">Accept {usd(cashOutTheDoor(used!))} out the door</button>
            </>
          ) : invite.counterDeclined && used ? (
            <p className="text-[11px] text-amber-200" data-testid="counter-declined-staged">{COUNTER_DECLINED_STATUS}: {usd(cashOutTheDoor(used))} out the door.</p>
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
              <p className="text-[11px] text-white" data-testid="trade-status">
                Trade offer: <strong>{usd(t.offer.value)}</strong> <span className="text-ink-faint">({t.offer.held ? "holding firm" : t.offer.basis === "firm" ? "firm" : "preliminary"}{t.offer.revised ? ", revised" : ""})</span>
                {t.counter ? <> · Your last counter: <strong>{usd(t.counter.value)}</strong></> : null}
              </p>
              {live ? (
                <p className="text-[11px] text-ink-muted" data-testid="live-true-otd">
                  True out-the-door if you accept {usd(t.offer.value)}: <strong className="text-emerald-300">{usd(live.ifOffer)}</strong>
                  {live.payoff > 0 ? <span className="text-ink-faint"> ({usd(stage.otd.amount)} - {usd(t.offer.value)} + {usd(live.payoff)} payoff)</span> : null}
                  {live.ifCounter != null ? <> · at your counter: <strong>{usd(live.ifCounter)}</strong></> : null}
                </p>
              ) : null}
              {t.turn === "dealer" ? (
                <p className="text-[11px] text-ink-muted">Your counter is with the dealer. They can accept it, revise or hold firm. You can wait or walk away.</p>
              ) : (
                <div className="space-y-2">
                  <button type="button" disabled={busy} onClick={() => act({ type: "trade_accept" })} className={primary} data-testid="accept-trade">Accept {usd(t.offer.value)}</button>
                  <div className="flex flex-wrap items-center gap-2">
                    <input inputMode="decimal" aria-label="Your trade value" placeholder="Your number $" value={counterValue} onChange={(e) => setCounterValue(e.target.value)} className={input} data-testid="trade-counter-input" />
                    <input aria-label="Note to the dealer (optional)" placeholder="Note (optional)" maxLength={300} value={counterNote} onChange={(e) => setCounterNote(e.target.value)} className="w-full min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-2 text-[12px] text-white sm:py-1" data-testid="trade-counter-note" />
                    <button type="button" disabled={busy || !counterValue.trim()} onClick={() => act({ type: "trade_counter", value: counterValue, note: counterNote })} className={ghost} data-testid="counter-trade">Send counter</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : null}

      {open && stage.stage === "payment" ? (
        <div className="space-y-3" data-testid="stage-payment-actions">
          <p className="text-[11px] text-ink-muted">True out-the-door <strong className="text-white">{usd(stage.trueOtd)}</strong>. How do you want to pay? Pick one.</p>
          {p.method === "dealer_finance" && p.financeRequestedAt ? (
            <div className="space-y-2 rounded-lg border border-border/70 p-2" data-testid="finance-thread">
              <p className="text-[11px] text-ink-muted">Financing offer from {invite.dealerName}: {usd(p.downPayment)} down{p.preferredTermMonths ? `, you asked for ${p.preferredTermMonths} months` : ""}{p.creditRange ? `, credit ${CREDIT_RANGE_LABELS[p.creditRange as CreditRange]}` : ""}.</p>
              {!p.financeQuote ? (
                <p className="text-[11px] text-ink-muted" data-testid="finance-waiting">Waiting for the dealer&apos;s APR, term and lender.</p>
              ) : (
                <>
                  <p className="text-[11px] text-white" data-testid="finance-quote">
                    <strong>{usd(p.financeQuote.monthly)}/mo</strong> · {p.financeQuote.apr}% APR · {p.financeQuote.termMonths} months · {p.financeQuote.lenderName ?? "lender not named"}
                    {p.financeQuote.held ? <span className="text-ink-faint"> (holding firm)</span> : null}
                    <span className="block text-ink-faint" data-testid="finance-math">{usd(p.financeQuote.trueOtd)} true out-the-door - {usd(p.financeQuote.downPayment)} down = {usd(p.financeQuote.amountFinanced)} financed{p.financeQuote.interest != null ? `; ${usd(p.financeQuote.interest)} total interest` : ""}</span>
                  </p>
                  {p.financeTurn === "dealer" ? (
                    <p className="text-[11px] text-ink-muted" data-testid="finance-counter-sent">Your counter ({p.financeCounter?.apr}% for {p.financeCounter?.termMonths} months, {usd(p.financeCounter?.monthly)}/mo) is with the dealer. They can accept, revise or hold firm.</p>
                  ) : (
                    <div className="space-y-2">
                      <button type="button" disabled={busy} onClick={() => act({ type: "finance_accept" })} className={primary} data-testid="accept-financing">Accept this financing</button>
                      <div className="flex flex-wrap items-center gap-2">
                        <input inputMode="decimal" aria-label="Your APR" placeholder="Your APR %" value={aprCounter} onChange={(e) => setAprCounter(e.target.value)} className={input} data-testid="apr-counter-input" />
                        <select aria-label="Term" value={termCounter} onChange={(e) => setTermCounter(e.target.value)} className={input}>
                          <option value="">Same term</option>
                          {FINANCE_TERM_OPTIONS.map((m: number) => <option key={m} value={m}>{m} months</option>)}
                        </select>
                        <button type="button" disabled={busy || !aprCounter.trim()} onClick={() => act({ type: "finance_counter", apr: aprCounter, termMonths: termCounter || null })} className={ghost} data-testid="counter-financing">Counter the APR</button>
                      </div>
                    </div>
                  )}
                </>
              )}
              <button type="button" disabled={busy} onClick={() => act({ type: "choose_cash" })} className={`${ghost} text-ink-muted`} data-testid="switch-to-cash">Pay cash instead</button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="How do you want to pay?">
                {([["cash", "Paying cash"], ["own", "Bringing my own financing"], ["dealer", "Get a financing offer from the dealer"]] as const).map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={paySel === id} onClick={() => setPaySel(id)} className={`rounded-lg border px-3 py-2 text-left text-[11px] font-bold ${paySel === id ? "border-brand-500 bg-brand-500/10 text-white" : "border-border text-ink-light"}`} data-testid={`pay-${id}`}>{label}</button>
                ))}
              </div>
              {paySel === "cash" ? (
                <button type="button" disabled={busy} onClick={() => act({ type: "choose_cash" })} className={primary} data-testid="choose-cash">Continue: pay cash {usd(stage.trueOtd)}</button>
              ) : null}
              {paySel === "own" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input aria-label="Lender (optional)" placeholder="Lender name (optional)" maxLength={80} value={ownLender} onChange={(e) => setOwnLender(e.target.value)} className="w-full min-w-0 rounded-lg border border-border bg-surface px-2 py-2 text-[12px] text-white sm:w-56 sm:py-1" data-testid="own-lender-input" />
                  <button type="button" disabled={busy} onClick={() => act({ type: "choose_own_financing", lenderName: ownLender })} className={primary} data-testid="choose-own-financing">Continue with my own financing</button>
                </div>
              ) : null}
              {paySel === "dealer" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input inputMode="decimal" aria-label="Down payment" placeholder="Down payment $" value={down} onChange={(e) => setDown(e.target.value)} className={input} data-testid="down-input" />
                  <select aria-label="Preferred term" value={term} onChange={(e) => setTerm(e.target.value)} className={input}>
                    <option value="">Any term</option>
                    {FINANCE_TERM_OPTIONS.map((m: number) => <option key={m} value={m}>{m} months</option>)}
                  </select>
                  <select aria-label="Credit range (optional)" value={credit} onChange={(e) => setCredit(e.target.value)} className={input} data-testid="credit-input">
                    <option value="">Credit range (optional)</option>
                    {CREDIT_RANGES.map((c: string) => <option key={c} value={c}>{CREDIT_RANGE_LABELS[c as CreditRange]}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-[10px] text-ink-muted"><input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} /> I have outside financing to compare</label>
                  <button type="button" disabled={busy} onClick={() => act({ type: "request_finance", downPayment: down || 0, termMonths: term || null, outsideFinancing: outside, creditRange: (credit || null) as CreditRange | null })} className={primary} data-testid="request-financing">Ask for a financing offer</button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {open && stage.stage === "final" ? (
        <FinalReview stage={stage} dealerName={invite.dealerName} busy={busy} onAccept={() => act({ type: "accept_final" })} onChange={() => act({ type: "change_payment" })} primary={primary} ghost={ghost} />
      ) : null}

      {stage.stage === "closed" ? (
        <p className="text-[11px] text-emerald-300" data-testid="stage-closed">
          Final deal accepted: {PAYMENT_METHOD_LABELS[p.method ?? "cash"].toLowerCase()}{p.method === "dealer_finance" ? `, ${usd(p.financeQuote?.monthly)}/mo on ${usd(p.financeQuote?.amountFinanced)}` : ` at ${usd(stage.trueOtd)} out the door`}. {invite.dealerName} now has your name, email, phone and ZIP, and no other dealer does.
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
        1. Agree the out-the-door price. 2. Value your trade-in{rfq.tradeInExpected ? "" : " (skipped: you have no trade-in)"}. 3. Choose cash, your own financing, or a financing offer from the dealer. 4. Review and accept the final deal: only then does the dealer get your contact details. Each dealer moves through these separately. {NO_BINDING}
      </p>
      {cards.length > 1 ? (
        <ul className="divide-y divide-border/60 rounded-xl border border-border text-[11px]" data-testid="stage-overview">
          {cards.map(({ invite, stage }) => (
            <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
              <span className="font-bold text-white">{invite.dealerName}</span>
              <span className="text-ink-muted">{stageSummary(stage, Boolean(invite.notSelectedAt))}</span>
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
