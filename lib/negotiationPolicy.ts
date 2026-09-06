/**
 * Shopper-side AI negotiator — the decision engine.
 *
 * Money math lives entirely here, in plain TypeScript, never in an LLM.
 * An LLM (see lib/negotiationCopy.ts) may only rephrase the message this
 * produces — never touch the action or the dollar figures.
 */

export type NegotiateAction = "recommend_accept" | "counter" | "hold" | "walk";

export interface NegotiationGuardrails {
  targetOtd: number;
  walkAwayOtd: number;
  autoAcceptUnderOtd?: number | null;
  concessionStep: number;
  maxCountersPerDealer: number;
  countersAlreadySent: number;
  fairOtdLow?: number | null;
  fairOtdMid?: number | null;
}

export interface BidSnapshot {
  bidId: string;
  dealerName: string;
  totalOtdPrice: number;
  msrp?: number | null;
}

export interface NegotiationDecision {
  action: NegotiateAction;
  nextTargetOtd: number | null;
  askImprovementDollars: number | null;
  reason: string;
  messageTemplate: string;
  allowAutoAccept: boolean;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function decideNegotiation(bid: BidSnapshot, g: NegotiationGuardrails): NegotiationDecision {
  const otd = Number(bid.totalOtdPrice);
  const target = Number(g.targetOtd);
  const walk = Number(g.walkAwayOtd);
  const step = Math.max(100, Number(g.concessionStep) || 500);

  if (!Number.isFinite(otd) || !Number.isFinite(target) || !Number.isFinite(walk)) {
    return {
      action: "hold",
      nextTargetOtd: null,
      askImprovementDollars: null,
      reason: "Missing numeric OTD/target/walk-away.",
      messageTemplate: "",
      allowAutoAccept: false,
    };
  }

  // A misconfigured guardrail (target above walk-away — the buyer's "most
  // I want to pay" set higher than their own "most I'll ever pay") has no
  // safe interpretation: taking the higher of the two as the walk ceiling
  // would tolerate an even worse price than the buyer said they'd accept.
  // Fail safe by holding for a human to fix the numbers, rather than
  // guessing which one they meant.
  if (target > walk) {
    return {
      action: "hold",
      nextTargetOtd: null,
      askImprovementDollars: null,
      reason: `Target ${money(target)} is above walk-away ${money(walk)} — fix the guardrails before negotiating.`,
      messageTemplate: "",
      allowAutoAccept: false,
    };
  }

  if (otd > walk) {
    return {
      action: "walk",
      nextTargetOtd: null,
      askImprovementDollars: null,
      reason: `Bid ${money(otd)} is above walk-away ${money(walk)}.`,
      messageTemplate:
        "Thanks for the offer. That OTD is above what I can do on this vehicle — I'll pass for now.",
      allowAutoAccept: false,
    };
  }

  const autoLine =
    g.autoAcceptUnderOtd != null && Number.isFinite(Number(g.autoAcceptUnderOtd))
      ? Number(g.autoAcceptUnderOtd)
      : null;

  if (otd <= target || (autoLine != null && otd <= autoLine)) {
    const allowAutoAccept = autoLine != null && otd <= autoLine;
    return {
      action: "recommend_accept",
      nextTargetOtd: null,
      askImprovementDollars: null,
      reason: `Bid ${money(otd)} meets target ${money(target)}${
        allowAutoAccept ? " and auto-accept threshold" : ""
      }.`,
      messageTemplate: `This looks like a strong match at ${money(otd)} OTD. Ready to proceed if the numbers hold.`,
      allowAutoAccept,
    };
  }

  if (g.countersAlreadySent >= g.maxCountersPerDealer) {
    return {
      action: "hold",
      nextTargetOtd: null,
      askImprovementDollars: null,
      reason: `Out of counters (${g.countersAlreadySent}/${g.maxCountersPerDealer}); waiting.`,
      messageTemplate: "",
      allowAutoAccept: false,
    };
  }

  const fairMid = g.fairOtdMid != null ? Number(g.fairOtdMid) : null;
  if (
    fairMid != null &&
    Number.isFinite(fairMid) &&
    otd <= fairMid &&
    otd > target &&
    g.countersAlreadySent === 0
  ) {
    return {
      action: "hold",
      nextTargetOtd: null,
      askImprovementDollars: null,
      reason: `Bid ${money(otd)} is at/under fair mid ${money(fairMid)}; holding for competing bids.`,
      messageTemplate: "",
      allowAutoAccept: false,
    };
  }

  const desired = Math.max(target, otd - step);
  const askImprovement = Math.max(0, Math.round(otd - desired));

  return {
    action: "counter",
    nextTargetOtd: desired,
    askImprovementDollars: askImprovement,
    reason: `Counter toward target: ask ${money(askImprovement)} improvement to ~${money(desired)} OTD.`,
    messageTemplate: `Thanks ${bid.dealerName} — appreciate the offer at ${money(
      otd
    )} OTD. If you can get closer to ${money(
      desired
    )} OTD on this VIN/config (fees included), I'm ready to move quickly.`,
    allowAutoAccept: false,
  };
}
