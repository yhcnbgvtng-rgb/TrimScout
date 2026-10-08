// GET /api/rfqs/:id/trade — the buyer's own trade-in on a sent request: fields, photos (short-lived signed URLs),
// and any open "more photos" asks from dealers. Buyer (or the request's guest link) only.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRfq, RfqApiError } from "@/lib/rfqApi";
import { buyerForRfq, hasBuyerCredential } from "@/lib/buyerAccess";
import { buyerMayManageTrade, signTradePhotos } from "@/lib/trade/access";
import { s3Storage } from "@/lib/trade/storage";
import { tradeErrorResponse } from "@/lib/trade/routeKit";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!hasBuyerCredential(session, req)) return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
  const { id } = await params;
  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    const buyer = buyerForRfq(session, req, rfq);
    if (!buyer) return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
    if (!buyerMayManageTrade(buyer.id, rfq)) return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    if (!rfq.tradeIn) return NextResponse.json({ tradeIn: null });
    const requests = rfq.invites.filter((i) => i.tradePhotoRequest?.status === "open").map((i) => ({ inviteId: i.id, dealerName: i.dealerName, slots: i.tradePhotoRequest!.slots, note: i.tradePhotoRequest!.note, createdAt: i.tradePhotoRequest!.createdAt }));
    return NextResponse.json({ tradeIn: rfq.tradeIn, signed: await signTradePhotos(s3Storage, rfq.tradeIn.photos), photoRequests: requests, locked: rfq.status !== "collecting" });
  } catch (err) {
    if (err instanceof RfqApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return tradeErrorResponse(err);
  }
}
