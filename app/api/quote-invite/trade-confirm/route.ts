// POST /api/quote-invite/trade-confirm { t, action: "confirm" | "revise", allowance?, reasonCode?, reasonText?, citedConditions? }
// The selected dealer's one in-app step: confirm the trade number as quoted, or revise it with a reason. Behind the invite's own
// tracked-link token, so only the dealer the buyer selected can reach it (a desk that wasn't selected gets 409). No email reply path.
//   - Guardrail (TRADE_REVISION_THRESHOLD_PCT, default 10%): a drop beyond it that cites none of the dealer's own original conditions
//     needs a 20+ character explanation and is flagged for internal review. A Firm quote that is revised is flagged as a breach.
//   - The buyer is told in-app (their page) and by the existing notice email, which only links in.
import { NextResponse, after } from "next/server";
import { actOnTradeConfirmation, getRfq, getRfqInviteByViewToken, RfqApiError } from "@/lib/rfqApi";
import { findContactInfo } from "@/lib/piiFilter";
import { dealerMayViewTrade } from "@/lib/trade/access";
import { publicConfirmation, tradeConfirmConfig } from "@/lib/trade/confirm";
import { notifyRevised, settleAndCloseOut, sweepIfDue } from "@/lib/trade/confirmFlow";

const TOKEN_RE = /^[A-Za-z0-9_-]{8,80}$/;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.t === "string" ? body.t.trim() : "";
  if (!TOKEN_RE.test(token)) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  const found = await getRfqInviteByViewToken(token).catch(() => null);
  if (!found) return NextResponse.json({ error: "This quote request link is no longer valid." }, { status: 404 });
  const type = body?.action;
  if (type !== "confirm" && type !== "revise") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  try {
    let rfq = await getRfq(found.rfqId);
    if (!rfq || !dealerMayViewTrade(found, rfq.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
    rfq = (await sweepIfDue(rfq)).rfq;
    const invite = rfq.invites.find((i) => i.id === found.invite.id);
    if (!invite) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (!invite.tradeConfirmation) return NextResponse.json({ error: "The buyer hasn't selected your quote, so there is nothing to confirm." }, { status: 409 });
    const text = typeof body.reasonText === "string" ? body.reasonText.trim().slice(0, 500) : "";
    if (text && findContactInfo(text)) return NextResponse.json({ error: "Leave contact info out of the explanation. Everything stays inside TrimScout." }, { status: 422 });
    const action = type === "confirm"
      ? { type: "confirm" as const, allowance: body.allowance ?? null }
      : { type: "revise" as const, allowance: body.allowance, reasonCode: typeof body.reasonCode === "string" ? body.reasonCode : undefined, reasonText: text || null, citedConditions: Array.isArray(body.citedConditions) ? body.citedConditions.filter((c: unknown) => typeof c === "string") : [] };
    const r = await actOnTradeConfirmation(rfq.id, invite.id, "dealer", action, tradeConfirmConfig());
    if (type === "confirm") after(async () => { await settleAndCloseOut(rfq!.id, invite.id); });
    else after(async () => { const fresh = await getRfq(rfq!.id).catch(() => null); const inv = fresh?.invites.find((i) => i.id === invite.id); if (fresh && inv) await notifyRevised(fresh, inv, r.confirmation); });
    return NextResponse.json({ ok: true, confirmation: publicConfirmation(r.confirmation) });
  } catch (err) {
    if (err instanceof RfqApiError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    return NextResponse.json({ error: "Could not record that. Try again." }, { status: 502 });
  }
}
