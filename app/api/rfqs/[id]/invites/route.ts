import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRfqInvite, getRfq, listRfqsForBuyer, RfqApiError } from "@/lib/rfqApi";
import { guardPerDeskCap } from "@/lib/apiSpendGuard";
import { buyerRfqStrikeCount, canInviteMore, reputationInviteCap } from "@/lib/rfqLogic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const dealerName = typeof body?.dealerName === "string" ? body.dealerName.trim() : "";
  if (!dealerName) {
    return NextResponse.json({ error: "A dealer name is required." }, { status: 400 });
  }

  // Per-desk cap: independent of the per-IP limit in middleware.ts — this
  // catches the same dealer being named across many different RFQs/buyers,
  // which an IP-keyed bucket can't see.
  if (!guardPerDeskCap(dealerName)) {
    return NextResponse.json(
      { error: `${dealerName} has already received the maximum number of requests for today. Try again tomorrow.` },
      { status: 429 }
    );
  }

  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    if (rfq.buyerUserId !== session.user.id) {
      return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    }

    // Desk-confirmation cap, enforced server-side (previously only checked
    // client-side in RfqInviteDraft.tsx). Reputation-aware: a buyer with
    // repeated ghost/cancel-after-quote outcomes gets a reduced cap instead
    // of the flat RFQ_MAX_INVITES — "slow their invites," not a hard ban.
    const history = await listRfqsForBuyer(rfq.buyerUserId);
    const maxInvites = reputationInviteCap(buyerRfqStrikeCount(history, Date.now()));
    if (!canInviteMore(rfq.invites, maxInvites)) {
      return NextResponse.json(
        { error: "You've reached the invite limit for this request." },
        { status: 400 }
      );
    }

    const invite = await createRfqInvite(id, {
      dealerName,
      dealerContactEmail: body?.dealerContactEmail || null,
    });
    return NextResponse.json({ invite });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not add this dealer.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
