// POST /api/quote-invite/decline { t, reason? } — the dealer, from their
// quote page, saying they can't do better on a buyer counter (or can't
// quote at all). Token-scoped like the calculator submit; no login.
import { NextResponse, after } from "next/server";
import { declineRfqInvite, getRfq, getRfqInviteByViewToken } from "@/lib/rfqApi";
import { notifyDealerDeclined } from "@/lib/noticeOutbox";
import type { RfqDeclineReason } from "@/lib/rfq";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.t === "string" ? body.t.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(token)) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  const found = await getRfqInviteByViewToken(token).catch(() => null);
  if (!found) return NextResponse.json({ error: "This quote request link is no longer valid." }, { status: 404 });
  if (found.invite.status !== "invited") return NextResponse.json({ error: `This invite already has a response (${found.invite.status}).` }, { status: 409 });
  const allowed: RfqDeclineReason[] = ["soft_lead", "wrong_car", "options_mismatch", "other"];
  const reason = allowed.includes(body?.reason) ? (body.reason as RfqDeclineReason) : "other";
  try {
    await declineRfqInvite(found.rfqId, found.invite.id, reason);
    // Tell the buyer (after the response; best effort, never fails the decline). The reason code stays internal.
    after(async () => {
      const rfq = await getRfq(found.rfqId).catch(() => null);
      if (rfq) await notifyDealerDeclined(rfq, found.invite);
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not record the decline." }, { status: 502 });
  }
}
