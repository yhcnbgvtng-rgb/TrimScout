import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getDealRequest,
  getSingleBid,
  updateDealRequestNegotiation,
  DealsApiError,
  type NegotiationMove,
} from "@/lib/dealsApi";
import { decideNegotiation, type NegotiationGuardrails } from "@/lib/negotiationPolicy";
import { polishNegotiationMessage } from "@/lib/negotiationCopy";

// Buyer-authenticated. Evaluates one bid against the buyer's guardrails and
// returns recommend_accept / counter / hold / walk — the money math lives
// entirely in lib/negotiationPolicy.ts, never here or in an LLM. Never
// calls createDeal/checkout: an auto-acceptable bid comes back as
// needsCheckout for the existing human checkout flow to pick up.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || (session.user as { role?: string }).role !== "buyer") {
    return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
  }

  const { id } = await params;
  let dealRequest;
  try {
    dealRequest = await getDealRequest(id);
  } catch (err) {
    const message = err instanceof DealsApiError ? err.message : "Could not load this request.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (!dealRequest) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (dealRequest.buyerUserId !== session.user.id) {
    return NextResponse.json({ error: "Not authorized to negotiate on this request" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const bidId = typeof body?.bidId === "string" ? body.bidId.trim() : "";
  if (!bidId) {
    return NextResponse.json({ error: "bidId is required" }, { status: 400 });
  }

  if (typeof dealRequest.targetOtdPrice !== "number") {
    return NextResponse.json({ error: "This deal has no target OTD price set yet." }, { status: 400 });
  }

  let bid;
  try {
    bid = await getSingleBid(id, bidId);
  } catch (err) {
    const message = err instanceof DealsApiError ? err.message : "Could not load this bid.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (!bid) {
    return NextResponse.json({ error: "Bid not found" }, { status: 404 });
  }

  const dealStructure = (dealRequest.dealStructure || {}) as Record<string, unknown>;
  const negotiation = (dealStructure.negotiation || {}) as { moves?: NegotiationMove[] };
  const priorMoves = Array.isArray(negotiation.moves) ? negotiation.moves : [];
  const countersAlreadySent = priorMoves.filter((m) => m?.bidId === bidId && m?.action === "counter").length;

  const g = (body?.guardrails || {}) as Record<string, unknown>;
  const guardrails: NegotiationGuardrails = {
    targetOtd: dealRequest.targetOtdPrice,
    walkAwayOtd: Number(g.walkAwayOtd),
    autoAcceptUnderOtd:
      typeof g.autoAcceptUnderOtd === "number" && Number.isFinite(g.autoAcceptUnderOtd) ? g.autoAcceptUnderOtd : null,
    concessionStep: Number(g.concessionStep) || 500,
    maxCountersPerDealer: Number(g.maxCountersPerDealer) || 3,
    countersAlreadySent,
    fairOtdLow: typeof g.fairOtdLow === "number" && Number.isFinite(g.fairOtdLow) ? g.fairOtdLow : null,
    fairOtdMid: typeof g.fairOtdMid === "number" && Number.isFinite(g.fairOtdMid) ? g.fairOtdMid : null,
  };

  const decision = decideNegotiation(
    { bidId: bid.id, dealerName: bid.dealerName, totalOtdPrice: bid.totalOtdPrice, msrp: bid.msrp },
    guardrails
  );

  let message = decision.messageTemplate;
  if (decision.action === "counter" && body?.draftMessageWithAi) {
    const figures = [decision.nextTargetOtd, bid.totalOtdPrice]
      .filter((n): n is number => typeof n === "number")
      .map((n) => `$${Math.round(n).toLocaleString("en-US")}`);
    message = await polishNegotiationMessage({
      messageTemplate: decision.messageTemplate,
      dealerName: bid.dealerName,
      otdFigures: figures,
    });
  }

  const move: NegotiationMove = {
    at: new Date().toISOString(),
    bidId: bid.id,
    dealerName: bid.dealerName,
    action: decision.action,
    bidOtd: bid.totalOtdPrice,
    nextTargetOtd: decision.nextTargetOtd,
    message,
    reason: decision.reason,
    allowAutoAccept: decision.allowAutoAccept,
  };

  let persisted = true;
  try {
    await updateDealRequestNegotiation(id, {
      nextTargetOtd: decision.action === "counter" ? (decision.nextTargetOtd ?? undefined) : undefined,
      move,
    });
  } catch {
    // The buyer still gets their decision even if the write failed —
    // persisted:false tells the client to warn rather than silently drop it.
    persisted = false;
  }

  return NextResponse.json({
    decision: { ...decision, messageTemplate: message },
    message,
    persisted,
    needsCheckout: decision.allowAutoAccept ? { bidId: bid.id } : null,
  });
}
