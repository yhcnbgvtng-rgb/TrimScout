import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDeal } from "@/lib/dealsApi";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const dealId = searchParams.get("dealId");
  if (!dealId) {
    return NextResponse.json({ error: "dealId is required" }, { status: 400 });
  }

  const deal = await getDeal(dealId);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  // A buyer can only verify their own deal.
  if (deal.buyerUserId !== session.user.id) {
    return NextResponse.json({ error: "Not authorized to view this deal" }, { status: 403 });
  }

  return NextResponse.json({ deal });
}
