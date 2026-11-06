// GET /api/dealer-quotes — the signed-in dealer's own quote requests ("My Quotes").
//
// Gate: a dealer session (401 otherwise). The dealer is the SESSION's user id, never a query parameter, so one
// dealer cannot ask for another's invites. The box links invites to accounts by dealer_user_id (no name match).
// The server derives each row's status and builds the link to the existing token quote page; the browser gets
// no bare token, no buyer data, and no audit request unless this account is a test dealer (rows carry test: true).
// Logic lives in lib/dealerQuotesHandler.ts so the gate is unit-tested.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listDealerInvites } from "@/lib/rfqApi";
import { dealerQuotesResponse } from "@/lib/dealerQuotesHandler";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const result = await dealerQuotesResponse(session?.user as { id?: string; role?: string; email?: string | null } | undefined, { listInvites: listDealerInvites });
  return NextResponse.json(result.body, { status: result.status });
}
