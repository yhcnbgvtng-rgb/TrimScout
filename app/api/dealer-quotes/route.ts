// GET /api/dealer-quotes — the signed-in dealer's own quote requests ("My Quotes").
// Dealer session only (401 otherwise). The list comes from invites linked to this ACCOUNT on the box
// (dealer_user_id), never from a dealer-name match. Status is derived here, on the server; the stage is the
// dealer's view only (stageForDealer on the box and again in the row builder), so the buyer's contact details
// never appear. The response has links, not tokens.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dealerReference } from "@/lib/dealerReference";
import { buildDealerQuoteRows, countByStatus, dealerSessionId } from "@/lib/dealerQuotes";
import { listInvitesForDealerUser, RfqApiError } from "@/lib/rfqApi";

export const dynamic = "force-dynamic";

export async function GET() {
  const dealerUserId = dealerSessionId(await auth());
  if (!dealerUserId) {
    return NextResponse.json({ error: "You must be signed in as a dealer." }, { status: 401 });
  }
  try {
    const invites = await listInvitesForDealerUser(dealerUserId);
    const quotes = buildDealerQuoteRows(invites, { reference: dealerReference });
    return NextResponse.json({ quotes, counts: countByStatus(quotes) });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not load your quotes.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
