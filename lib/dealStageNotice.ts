/**
 * The one email each side gets when the other moves a Cash / Finance deal to its next step. Copy only: "a request, not a
 * bid", never auction language, no deadline on anyone. Every email in the app goes through the SAFE MODE sender
 * (lib/dealerEmail.ts), so these land at the safe recipient whether the request is real, an audit or a test deal, and the
 * subject is tagged accordingly. Nothing here ever contains the other party's contact details.
 */
import type { DealStageState, StageAction, StageActor } from "./dealStages";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n: number | null | undefined) => (typeof n === "number" ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : "");

export interface StageNoticeInput {
  /** Who did the thing. The email goes to the other side. */
  actor: StageActor;
  action: StageAction;
  /** The deal state AFTER the action. */
  state: DealStageState;
  dealerName: string;
  vehicle: string;
  /** Where the recipient acts on it (buyer: their tracker; dealer: their tokened quote page). */
  url: string;
}

export interface StageNotice { subject: string; html: string; audience: StageActor }

/** What happened, in a sentence, plus what the recipient can do next; null for actions that need no email. */
function body(i: StageNoticeInput): { headline: string; text: string; cta: string } | null {
  const s = i.state;
  const a = i.action;
  const toDealer = i.actor === "buyer";
  switch (a.type) {
    case "accept_otd":
      if (toDealer) return s.stage === "trade"
        ? { headline: "Out-the-door price locked", text: `The buyer accepted your out-the-door price of ${usd(s.otd.amount)}. Next is their trade-in: you can offer a trade value on your quote page.`, cta: "Open the quote page" }
        : { headline: "Out-the-door price locked", text: `The buyer accepted your out-the-door price of ${usd(s.otd.amount)}. There is no trade-in, so the next step is theirs: pay cash or ask you for financing.`, cta: "Open the quote page" };
      return s.stage === "trade"
        ? { headline: "Out-the-door price locked", text: `${i.dealerName} accepted your out-the-door price of ${usd(s.otd.amount)}. Next is your trade-in: they'll offer a trade value.`, cta: "See your deal" }
        : { headline: "Out-the-door price locked", text: `${i.dealerName} accepted your out-the-door price of ${usd(s.otd.amount)}. Next you can pay cash or ask them for financing.`, cta: "Choose how to pay" };
    case "trade_offer":
      return { headline: "Trade-in offer", text: `${i.dealerName} offered ${usd(s.trade.offer?.value)} for your trade-in${s.trade.offer?.revised ? " (a revised offer after your counter)" : ""}. You can accept it${s.trade.counterUsed ? "" : ", counter once,"} or walk away.`, cta: "Review the offer" };
    case "trade_counter":
      return { headline: "Buyer countered the trade value", text: `The buyer asked for ${usd(s.trade.counter?.value)} for their trade-in (you offered ${usd(s.trade.offer?.value)}).${s.trade.counter?.note ? ` Their note: ${s.trade.counter.note}` : ""} You can accept it or send one revised offer.`, cta: "Answer the counter" };
    case "trade_accept":
    case "trade_accept_counter": {
      const saving = s.trade.taxSavings ? ` Estimated sales-tax saving from the trade: ${usd(s.trade.taxSavings)} (your final paperwork confirms it).` : "";
      return { headline: "Trade-in locked", text: `Trade value ${usd(s.trade.value)}. True out-the-door = ${usd(s.otd.amount)} - ${usd(s.trade.value)} = ${usd(s.trueOtd)}.${saving}${toDealer ? " The buyer picks cash or financing next." : " Next you can pay cash or ask for financing."}`, cta: toDealer ? "Open the quote page" : "Choose how to pay" };
    }
    case "choose_cash":
      return { headline: "Buyer is paying cash", text: `The buyer chose to pay cash at the true out-the-door of ${usd(s.trueOtd)}. This request is now closed with you.`, cta: "Open the quote page" };
    case "request_finance":
      return { headline: "Buyer wants a financing quote", text: `The true out-the-door is ${usd(s.trueOtd)} and the buyer's down payment is ${usd(s.payment.downPayment)}, so the amount to finance is ${usd((s.trueOtd ?? 0) - (s.payment.downPayment ?? 0))}.${s.payment.outsideFinancing ? " They also have outside financing to compare." : ""} Quote an APR and term on your quote page.`, cta: "Quote financing" };
    case "finance_quote": {
      const q = s.payment.financeQuote;
      return { headline: "Financing quote", text: q ? `${i.dealerName} quoted ${q.apr}% APR for ${q.termMonths} months: ${usd(q.monthly)}/mo on ${usd(q.amountFinanced)} financed (true out-the-door ${usd(q.trueOtd)} less ${usd(q.downPayment)} down). Accept it, or pay cash instead.` : "", cta: "Review the quote" };
    }
    case "finance_accept":
      return { headline: "Buyer accepted financing", text: `The buyer accepted your financing quote (${usd(s.payment.financeQuote?.monthly)}/mo). This request is now closed with you.`, cta: "Open the quote page" };
    case "walk":
      return { headline: toDealer ? "Buyer walked away" : "Dealer walked away", text: `${toDealer ? "The buyer" : i.dealerName} ended this deal${s.walk ? ` at the ${s.walk.atStage === "otd" ? "out-the-door price" : s.walk.atStage === "trade" ? "trade-in" : "payment"} stage` : ""}.${s.walk?.reason ? ` Reason given: ${s.walk.reason}` : ""} Nothing was binding.`, cta: toDealer ? "Open the quote page" : "See your request" };
    default:
      return null;
  }
}

export function buildStageNotice(i: StageNoticeInput): StageNotice | null {
  const b = body(i);
  if (!b) return null;
  const audience: StageActor = i.actor === "buyer" ? "dealer" : "buyer";
  const subject = `[SAFE MODE] ${b.headline}: ${i.vehicle}`;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;color:#111;">
    <p style="font-size:12px;color:#a16207;background:#fef9c3;border-radius:8px;padding:8px 10px;">
      <strong>SAFE MODE:</strong> this ${audience} notification was redirected here for approval instead of the ${audience}, per site-owner override.
    </p>
    <h1 style="font-size:18px;margin:16px 0 8px;">${esc(b.headline)}</h1>
    <p style="font-size:14px;line-height:1.6;color:#374151;">${esc(b.text)}</p>
    <p style="font-size:12px;color:#64748b;">${esc(i.vehicle)}. A request, not a bid: nothing here binds either side, and either side can walk away at any stage.</p>
    <a href="${esc(i.url)}" style="display:inline-block;margin-top:12px;padding:10px 18px;border-radius:10px;background:#22c55e;color:#000;font-weight:800;text-decoration:none;">${esc(b.cta)}</a>
  </div>`.trim();
  return { subject, html, audience };
}
