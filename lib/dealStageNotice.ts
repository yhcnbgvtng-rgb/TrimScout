/**
 * The one email each side gets when the other moves a Cash / Finance deal to its next step. Copy only: "a request, not a
 * bid", never auction language, no deadline on anyone. Every email in the app goes through the SAFE MODE sender
 * (lib/dealerEmail.ts), so these land at the safe recipient whether the request is real, an audit or a test deal, and the
 * subject is tagged accordingly. No stage notice ever contains the other party's contact details; the ONE email that does is
 * buildAcceptedOfferEmail below, sent to the winning dealer after the buyer taps "Accept final deal".
 */
import type { BuyerContact, DealStageState, FinalSummary, StageAction, StageActor } from "./dealStages";
import { PAYMENT_METHOD_LABELS } from "./dealStages";

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
    case "add_trade":
      return { headline: "Buyer added a trade-in", text: `The buyer accepted your out-the-door price of ${usd(s.otd.amount)} (it stays locked) and added a trade-in. Open your quote page to see the vehicle, mileage, payoff and photos, then offer a trade value so the true out-the-door can be reached.`, cta: "Offer a trade value" };
    case "skip_trade":
      return { headline: "No trade-in on this deal", text: `The buyer decided not to add a trade-in. The out-the-door price of ${usd(s.otd.amount)} is the true out-the-door; the buyer picks cash or financing next.`, cta: "Open the quote page" };
    case "trade_offer":
      return { headline: "Trade-in offer", text: `${i.dealerName} offered ${usd(s.trade.offer?.value)} for your trade-in${s.trade.offer?.revised ? " (a revised offer after your counter)" : ""}. You can accept it, counter with your own number, or walk away. True out-the-door if you accept: ${usd(s.trade.offer ? (s.otd.amount ?? 0) - s.trade.offer.value + (s.trade.payoff ?? 0) : null)}.`, cta: "Review the offer" };
    case "trade_counter":
      return { headline: "Buyer countered the trade value", text: `The buyer asked for ${usd(s.trade.counter?.value)} for their trade-in (you offered ${usd(s.trade.offer?.value)}).${s.trade.counter?.note ? ` Their note: ${s.trade.counter.note}` : ""} You can accept it, send a revised offer, or hold firm.`, cta: "Answer the counter" };
    case "trade_hold":
      return { headline: "Dealer is holding firm on the trade value", text: `${i.dealerName} is holding at ${usd(s.trade.offer?.value)} for your trade-in (you asked for ${usd(s.trade.counter?.value)}). You can accept it, counter again, or walk away.`, cta: "Review the offer" };
    case "trade_accept":
    case "trade_accept_counter": {
      const saving = (s.trade.value ?? 0) > 0 ? " Trade-in may lower your sales tax — dealer will confirm." : "";
      return { headline: "Trade-in locked", text: `Trade value ${usd(s.trade.value)}. True out-the-door = ${usd(s.otd.amount)} - ${usd(s.trade.value)}${(s.trade.payoff ?? 0) > 0 ? ` + ${usd(s.trade.payoff)} payoff` : ""} = ${usd(s.trueOtd)}.${saving}${toDealer ? " The buyer picks how to pay next." : " Next choose how to pay: cash, your own financing, or a financing offer from the dealer."}`, cta: toDealer ? "Open the quote page" : "Choose how to pay" };
    }
    case "choose_cash":
      return { headline: "Buyer is paying cash", text: `The buyer plans to pay cash at the true out-the-door of ${usd(s.trueOtd)}. They are reviewing the final deal; you'll hear when they accept it.`, cta: "Open the quote page" };
    case "choose_own_financing":
      return { headline: "Buyer is bringing their own financing", text: `The buyer will arrange their own financing${s.payment.lenderName ? ` (${s.payment.lenderName})` : ""} at the true out-the-door of ${usd(s.trueOtd)}. They are reviewing the final deal; you'll hear when they accept it.`, cta: "Open the quote page" };
    case "request_finance":
      return { headline: "Buyer wants a financing offer", text: `The true out-the-door is ${usd(s.trueOtd)} and the buyer's down payment is ${usd(s.payment.downPayment)}, so the amount to finance is ${usd((s.trueOtd ?? 0) - (s.payment.downPayment ?? 0))}.${s.payment.preferredTermMonths ? ` They'd like ${s.payment.preferredTermMonths} months.` : ""}${s.payment.outsideFinancing ? " They also have outside financing to compare." : ""} Send an APR, term and lender on your quote page.`, cta: "Send financing offer" };
    case "finance_quote": {
      const q = s.payment.financeQuote;
      return { headline: q?.revised ? "Revised financing offer" : "Financing offer", text: q ? `${i.dealerName} offered ${q.apr}% APR for ${q.termMonths} months through ${q.lenderName ?? "their lender"}: ${usd(q.monthly)}/mo on ${usd(q.amountFinanced)} financed (true out-the-door ${usd(q.trueOtd)} less ${usd(q.downPayment)} down). Accept it, counter the APR, or pay another way.` : "", cta: "Review the offer" };
    }
    case "finance_counter": {
      const c = s.payment.financeCounter;
      return { headline: "Buyer countered the financing", text: c ? `The buyer asked for ${c.apr}% APR over ${c.termMonths} months (${usd(c.monthly)}/mo), against your ${s.payment.financeQuote?.apr}% over ${s.payment.financeQuote?.termMonths}.${c.note ? ` Their note: ${c.note}` : ""} You can accept it, send a revised offer, or hold firm.` : "", cta: "Answer the counter" };
    }
    case "finance_hold": {
      const q = s.payment.financeQuote;
      return { headline: "Dealer is holding firm on the financing", text: q ? `${i.dealerName} is holding at ${q.apr}% APR for ${q.termMonths} months (${usd(q.monthly)}/mo). You can accept it, counter again, or pay another way.` : "", cta: "Review the offer" };
    }
    case "finance_accept":
    case "finance_accept_counter": {
      const q = s.payment.financeQuote;
      return { headline: "Financing agreed", text: `${q ? `${q.apr}% APR for ${q.termMonths} months, ${usd(q.monthly)}/mo on ${usd(q.amountFinanced)} financed.` : ""} ${toDealer ? "The buyer is reviewing the final deal; you'll hear when they accept it." : "Review the final deal and tap Accept final deal when you're ready."}`.trim(), cta: toDealer ? "Open the quote page" : "Review the final deal" };
    }
    case "change_payment":
      return { headline: "Buyer is changing how they pay", text: "The buyer went back to the payment choice before accepting. Nothing else changed.", cta: "Open the quote page" };
    // accept_final has no stage notice: the dealer gets the "Your offer was accepted" email instead (buildAcceptedOfferEmail).
    case "walk":
      return { headline: toDealer ? "Buyer walked away" : "Dealer walked away", text: `${toDealer ? "The buyer" : i.dealerName} ended this deal${s.walk ? ` at the ${s.walk.atStage === "otd" ? "out-the-door price" : s.walk.atStage === "trade" ? "trade-in" : s.walk.atStage === "final" ? "final review" : "payment"} stage` : ""}.${s.walk?.reason ? ` Reason given: ${s.walk.reason}` : ""} Nothing was binding.`, cta: toDealer ? "Open the quote page" : "See your request" };
    default:
      return null;
  }
}

/**
 * Lease (and single-sheet cash) winners: the buyer accepted the quote and then added a trade-in. Same SAFE MODE layout as
 * every stage notice; the accepted quote is locked and the dealer is asked for a trade value on their quote page.
 */
export function buildTradeAddedNotice(i: { dealerName: string; vehicle: string; url: string; lease: boolean }): StageNotice {
  const text = i.lease
    ? "The buyer chose your lease quote (it stays as quoted) and added a trade-in. Open your quote page to see the vehicle, mileage, payoff and photos, then give a trade value; it is applied as a cap cost reduction and your monthly is never recomputed."
    : "The buyer chose your quote (it stays as quoted) and added a trade-in. Open your quote page to see the vehicle, mileage, payoff and photos, then give a trade value so the true out-the-door can be reached.";
  return render({ headline: "Buyer added a trade-in", text, cta: "Offer a trade value" }, "dealer", i.vehicle, i.url);
}

export interface AcceptedOfferEmailInput {
  vehicle: string;
  vin: string;
  /** The out-the-door price the dealer quoted and the buyer accepted (final summary `otd`). */
  acceptedOtd: number | null;
  /** The net out-the-door after trade-in and payoff (final summary `trueOtd`); shown only when `hasTrade`. */
  netAfterTrade?: number | null;
  /** True when a trade-in value was agreed on this deal. */
  hasTrade?: boolean;
  /** The signed, expiring reveal page link (lib/contactRevealToken.ts). */
  url: string;
}

export const ACCEPTED_OFFER_SUBJECT = "Your offer was accepted";
export const REVEAL_BUTTON_LABEL = "View buyer contact info";

/**
 * The email to the WINNING dealer after the buyer taps "Accept final deal". It carries NO buyer name, email or phone, in the body,
 * the subject or the link text: the button opens a page where the dealer presses "Reveal buyer contact info", which is logged.
 * Sent only through the outbox's SAFE MODE sender (lib/inviteOutbox.ts), so it lands at SAFE_MODE_RECIPIENT whatever the deal.
 */
export function buildAcceptedOfferEmail(i: AcceptedOfferEmailInput): { subject: string; html: string } {
  const rows: Array<[string, string]> = [["Vehicle", i.vehicle], ["VIN", i.vin], ["Accepted out-the-door price", i.acceptedOtd != null ? usd(i.acceptedOtd) : "As quoted"]];
  if (i.hasTrade && i.netAfterTrade != null) rows.push(["Net after trade-in", usd(i.netAfterTrade)]);
  const table = `<table style="font-size:14px;border-collapse:collapse;width:100%">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${esc(k)}</td><td style="padding:4px 0;font-weight:600">${esc(v)}</td></tr>`).join("")}</table>`;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;color:#111;">
    <h1 style="font-size:18px;margin:0 0 8px;">${esc(ACCEPTED_OFFER_SUBJECT)}</h1>
    <p style="font-size:14px;line-height:1.6;color:#374151;">The buyer accepted your quote request offer.</p>
    ${table}
    <a href="${esc(i.url)}" style="display:inline-block;margin-top:16px;padding:10px 18px;border-radius:10px;background:#22c55e;color:#000;font-weight:800;text-decoration:none;">${esc(REVEAL_BUTTON_LABEL)}</a>
    <p style="font-size:12px;color:#64748b;margin-top:16px;">This link is for you only and expires in 30 days.</p>
  </div>`.trim();
  return { subject: `${ACCEPTED_OFFER_SUBJECT}: ${i.vehicle}`, html };
}

export function buildStageNotice(i: StageNoticeInput): StageNotice | null {
  const b = body(i);
  if (!b) return null;
  return render(b, i.actor === "buyer" ? "dealer" : "buyer", i.vehicle, i.url);
}

function render(b: { headline: string; text: string; cta: string }, audience: StageActor, vehicle: string, url: string): StageNotice {
  const i = { vehicle, url };
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
