import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDeal, getDealRequest } from "@/lib/dealsApi";

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

  // The deal row doesn't know whether the buyer has a trade-in — that was
  // answered on step 1 and lives on the deal request. Fetch it so the voucher
  // can offer the trade-in step at the right moment, with the state and ZIP
  // the revised tax estimate needs.
  let hasTradeIn = false;
  let buyerState: string | null = null;
  let buyerZip: string | null = null;
  const requestId = (deal as { dealRequestId?: string | null }).dealRequestId;
  if (requestId) {
    try {
      const request = await getDealRequest(requestId);
      const tradeIn = request?.tradeIn as { hasTradeIn?: unknown } | null | undefined;
      hasTradeIn = Boolean(tradeIn?.hasTradeIn);
      buyerState = request?.buyerState || null;
      buyerZip = request?.buyerZip || null;
    } catch {
      // Not knowing about the trade-in must not fail payment verification.
    }
  }

  return NextResponse.json({ deal, hasTradeIn, buyerState, buyerZip });
}
