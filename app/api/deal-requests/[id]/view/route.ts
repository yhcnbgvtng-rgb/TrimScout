import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDealRequest } from "@/lib/dealsApi";
import { isDealAcceptingResponses, recordDealerView } from "@/lib/dealEngagementStore";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string; dealerName?: string } | undefined;
  if (!user?.id || user.role !== "dealer") {
    return NextResponse.json({ error: "You must be signed in as a dealer." }, { status: 401 });
  }
  if (!user.dealerName) {
    return NextResponse.json({ error: "Your account has no dealership name on file." }, { status: 400 });
  }

  const { id } = await params;
  const dealRequest = await getDealRequest(id);
  if (!dealRequest) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (!(await isDealAcceptingResponses(id))) {
    return NextResponse.json({ error: "This offer is closed." }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : undefined;
  await recordDealerView({
    token,
    dealRequestId: id,
    dealerName: user.dealerName,
  });
  return NextResponse.json({ ok: true });
}
