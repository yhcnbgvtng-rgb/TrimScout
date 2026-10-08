// /api/quote-invite/trade-in — the dealer's side of an invite's trade-in, behind the invite token.
//   GET  ?t=…                     the trade-in WITH photos
//   POST { t, allowance }         the trade-in allowance (blank clears it). Allowed while the invite is open
//                                 OR already quoted: it's a separate line, not a re-quote of the car.
// A dealer estimate that can change after inspection; nothing is binding.
import { NextResponse } from "next/server";
import { getInviteTradeIn, getRfq, getRfqInviteByViewToken, RfqApiError, submitInviteTradeAllowance } from "@/lib/rfqApi";
import { parseAllowance } from "@/lib/rfqTradeIn";

const TOKEN_RE = /^[A-Za-z0-9_-]{8,80}$/;

async function resolve(token: string) {
  if (!TOKEN_RE.test(token)) return { error: NextResponse.json({ error: "Invalid link." }, { status: 400 }) };
  const found = await getRfqInviteByViewToken(token).catch(() => null);
  if (!found) return { error: NextResponse.json({ error: "This quote request link is no longer valid." }, { status: 404 }) };
  return { found };
}

export async function GET(req: Request) {
  const r = await resolve((new URL(req.url).searchParams.get("t") || "").trim());
  if (r.error) return r.error;
  const tradeIn = await getInviteTradeIn(r.found.rfqId, r.found.invite.id).catch(() => null);
  return NextResponse.json({ tradeIn });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const r = await resolve(typeof body?.t === "string" ? body.t.trim() : "");
  if (r.error) return r.error;
  const { rfqId, invite } = r.found;
  const parsed = parseAllowance(body?.allowance);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const rfq = await getRfq(rfqId);
    if (!rfq) return NextResponse.json({ error: "Quote request not found." }, { status: 404 });
    if (rfq.status !== "collecting") return NextResponse.json({ error: "The buyer has closed this request." }, { status: 409 });
    const current = rfq.invites.find((i) => i.id === invite.id);
    if (!current?.tradeIn) return NextResponse.json({ error: "The buyer hasn't added a trade-in for you." }, { status: 409 });
    if (current.status === "declined") return NextResponse.json({ error: "This invite was declined." }, { status: 409 });
    await submitInviteTradeAllowance(rfqId, invite.id, parsed.allowance);
    return NextResponse.json({ ok: true, allowance: parsed.allowance });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not save the trade-in allowance.";
    return NextResponse.json({ error: message }, { status: err instanceof RfqApiError ? err.status : 502 });
  }
}
