import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isBuyerTestMode } from "@/lib/buyerTestMode";
import { listRfqsForBuyer, RfqApiError, walkAwayFromRfq } from "@/lib/rfqApi";
import { testRequestsToWalk } from "@/lib/buyerTestModeWalk";

// "Walk away from all my test requests" — buyer test mode only (BUYER_TEST_MODE_EMAILS). Walks away every
// still-open request of the signed-in test account that the box flagged audit=1; a real (unflagged) request
// is never touched. Anyone else gets a plain 404, so the route does not advertise itself.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id || !isBuyerTestMode(session.user)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const mine = await listRfqsForBuyer(String(session.user.id));
    const ids = testRequestsToWalk(mine);
    const results = await Promise.allSettled(ids.map((id) => walkAwayFromRfq(id)));
    const walked = results.filter((r) => r.status === "fulfilled").length;
    return NextResponse.json({ walked, failed: ids.length - walked });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not walk away from your test requests.";
    return NextResponse.json({ error: message }, { status: err instanceof RfqApiError ? err.status : 502 });
  }
}
