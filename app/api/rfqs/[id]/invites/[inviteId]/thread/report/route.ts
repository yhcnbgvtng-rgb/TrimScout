// POST /api/rfqs/:id/invites/:inviteId/thread/report { messageId } — the buyer reports a dealer message. It goes to the admin review
// queue (Release dismisses it, Block hides it and counts against the dealer); the message itself stays until an admin decides.
// Buyer-authenticated like the thread route; only a dealer message in THIS buyer's thread with THIS dealer can be reported.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRfq, reportChatMessage, RfqApiError } from "@/lib/rfqApi";
import { buyerForRfq, hasBuyerCredential } from "@/lib/buyerAccess";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; inviteId: string }> }) {
  const { id, inviteId } = await params;
  const session = await auth();
  if (!hasBuyerCredential(session, req) || (session?.user && (session.user as { role?: string }).role !== "buyer")) {
    return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const messageId = typeof body?.messageId === "string" ? body.messageId.trim().slice(0, 40) : "";
  if (!messageId) return NextResponse.json({ error: "Which message?" }, { status: 400 });
  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    const buyer = buyerForRfq(session, req, rfq);
    if (!buyer) return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
    if (rfq.buyerUserId !== buyer.id) return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    if (!rfq.invites.some((i) => i.id === inviteId)) return NextResponse.json({ error: "Dealer not found on this request." }, { status: 404 });
    const r = await reportChatMessage(id, inviteId, messageId);
    return NextResponse.json({ ok: true, duplicate: r.duplicate });
  } catch (err) {
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: err instanceof RfqApiError ? err.message : "Could not send that report." }, { status });
  }
}
