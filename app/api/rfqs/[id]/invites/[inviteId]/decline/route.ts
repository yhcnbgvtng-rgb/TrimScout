import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { declineRfqInvite, getRfq, RfqApiError } from "@/lib/rfqApi";
import type { RfqDeclineReason } from "@/lib/rfq";

const VALID_REASONS: RfqDeclineReason[] = ["soft_lead", "wrong_car", "options_mismatch", "other"];

export async function POST(req: Request, { params }: { params: Promise<{ id: string; inviteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const { id, inviteId } = await params;
  const body = await req.json().catch(() => null);
  const declineReason = body?.declineReason as RfqDeclineReason;
  if (!VALID_REASONS.includes(declineReason)) {
    return NextResponse.json({ error: "A valid decline reason is required." }, { status: 400 });
  }

  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    if (rfq.buyerUserId !== session.user.id) {
      return NextResponse.json({ error: "This request belongs to a different buyer." }, { status: 403 });
    }
    const invite = await declineRfqInvite(id, inviteId, declineReason);
    return NextResponse.json({ invite });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not record the decline.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
