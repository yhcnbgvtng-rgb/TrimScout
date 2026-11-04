/**
 * The buyer's answer to "Do you have a trade-in?" on a quote request (end of wizard step 3).
 *
 *   now   "Yes, add my trade": the details and six photos go with the request.
 *   later "Skip, add later": the buyer has a trade and will add it in the deal; dealers are told one is expected.
 *   none  "No": no trade-in on this request (it can still be added from the deal).
 *
 * The deals box stores one nullable boolean, `tradeInExpected`, and nothing there changes. The answer is derived from
 * that boolean plus whether a trade-in record is attached, so older requests keep working:
 *   tradeIn attached          -> "now"
 *   tradeInExpected === true  -> "later"   (the old "Yes" before the trade was added, and the new "Skip, add later")
 *   tradeInExpected === false -> "none"    (the old "Skip" / "no trade-in")
 *   tradeInExpected null      -> null      (never answered: requests from before the question existed)
 */
export type TradeInAnswer = "now" | "later" | "none";

export const TRADE_IN_ANSWERS: readonly TradeInAnswer[] = ["now", "later", "none"];

export interface TradeInAnswerSource {
  tradeInExpected?: boolean | null;
  /** Only its presence matters. */
  tradeIn?: unknown;
}

/** What the buyer said, read back from a stored request. null = never answered (old request). */
export function tradeInAnswerOf(rfq: TradeInAnswerSource): TradeInAnswer | null {
  if (rfq.tradeIn) return "now";
  if (rfq.tradeInExpected === true) return "later";
  if (rfq.tradeInExpected === false) return "none";
  return null;
}

/** The boolean the box stores for an answer. Both "now" and "later" mean a trade-in is expected. */
export function tradeInExpectedFor(answer: TradeInAnswer | null): boolean | null {
  if (answer === "now" || answer === "later") return true;
  if (answer === "none") return false;
  return null;
}

/** True when a trade-in is expected on the request (attached or to come). */
export function tradeInIsExpected(rfq: TradeInAnswerSource): boolean {
  const a = tradeInAnswerOf(rfq);
  return a === "now" || a === "later";
}

/** Step 3 may continue only with an answer, and "now" also needs the trade-in details and photos complete. */
export function tradeInBlocksContinue(answer: TradeInAnswer | null, tradeStepReady: boolean): "unanswered" | "incomplete" | null {
  if (answer === null) return "unanswered";
  if (answer === "now" && !tradeStepReady) return "incomplete";
  return null;
}

export const TRADE_IN_REQUIRED_MESSAGE = "Choose one to continue: add your trade now, add it later in the deal, or no trade-in.";

/** The review step line. */
export function tradeInReviewLabel(answer: TradeInAnswer | null): string {
  if (answer === "now") return "Trade-in: included";
  if (answer === "later") return "Trade-in: adding later";
  return "No trade-in";
}

export function tradeInReviewText(answer: TradeInAnswer | null): string {
  if (answer === "now") return "Included with this quote request. Invited dealers see the vehicle, mileage, condition and photos. You can edit it later in the deal.";
  if (answer === "later") return "You'll add your trade-in in the deal. Invited dealers are told one is expected, and quote the car on its own for now.";
  return "No trade-in on this quote request. You can still add one later in the deal. We'll work with the dealer to calculate any changes in registration fees and sales tax.";
}
