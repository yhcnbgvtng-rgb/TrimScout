import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRfq, RfqApiError } from "@/lib/rfqApi";
import { publicRfqForBuyer } from "@/lib/rfq";
import { analyzeLeaseQuotes } from "@/lib/leaseCompare";
import { recheckPendingStickers } from "@/lib/stickerRecheck";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const { id } = await params;
  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    // The owner, or an admin (the all-requests desk opens any deal read-only;
    // pick / walk / edits stay owner-only).
    const isAdmin = (session.user as { role?: string }).role === "admin";
    if (rfq.buyerUserId !== session.user.id && !isAdmin) {
      return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    }
    // The server decides counter / expired / best — the page renders it as given.
    const pub = publicRfqForBuyer(rfq);
    // Pending factory stickers (Hyundai lists weeks before the label exists) are asked again on every open.
    const stickerRecheck = await recheckPendingStickers(rfq).catch(() => ({}));
    return NextResponse.json({ rfq: pub, leaseCompare: analyzeLeaseQuotes(pub), stickerRecheck });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not load this request.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
