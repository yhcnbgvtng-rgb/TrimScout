import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDealRequest } from "@/lib/dealsApi";
import { decorateDealRequestJson, extendDealClock } from "@/lib/dealEngagementStore";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || (session.user as { role?: string }).role !== "buyer") {
    return NextResponse.json({ error: "You must be signed in as a buyer." }, { status: 401 });
  }

  const { id } = await params;
  const dealRequest = await getDealRequest(id);
  if (!dealRequest) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (dealRequest.buyerUserId !== session.user.id) {
    return NextResponse.json({ error: "Not authorized to update this request" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (body?.action !== "extend") {
    return NextResponse.json({ error: "Unknown clock action." }, { status: 400 });
  }

  const updated = await extendDealClock(id);
  if (!updated) {
    return NextResponse.json({ error: "Offer clock is not available for this deal." }, { status: 404 });
  }
  if (updated.closedAt) {
    return NextResponse.json({ error: "This offer is already closed." }, { status: 409 });
  }

  const decorated = await decorateDealRequestJson({ ...dealRequest } as unknown as Record<string, unknown>);
  return NextResponse.json({ dealRequest: decorated, offerClock: decorated.offerClock });
}
