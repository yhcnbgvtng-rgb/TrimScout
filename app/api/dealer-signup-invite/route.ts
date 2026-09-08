import { NextResponse } from "next/server";
import { verifyDealerSignupInviteToken } from "@/lib/dealerSignupInvite";
import { listDealerships, DealershipsApiError } from "@/lib/dealershipsApi";

// Public (no login) — a dealer following an invite link hasn't got an
// account yet. Deliberately returns only the dealer name, never the
// dealership's contact email/phone/notes: an unauthenticated caller with a
// guessed or leaked dealerId shouldn't learn anything beyond "this is the
// name that dealership will sign up under."
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dealerId = searchParams.get("dealerId") || "";
  const dealerToken = searchParams.get("dealerToken") || "";

  if (!verifyDealerSignupInviteToken(dealerId, dealerToken)) {
    return NextResponse.json({ error: "This invite link is invalid or has expired." }, { status: 400 });
  }

  try {
    const dealerships = await listDealerships();
    const dealership = dealerships.find((d) => d.id === dealerId);
    if (!dealership) {
      return NextResponse.json({ error: "This invite link is invalid or has expired." }, { status: 404 });
    }
    return NextResponse.json({ dealerName: dealership.dealerName });
  } catch (err) {
    const message = err instanceof DealershipsApiError ? err.message : "Could not look up this invite.";
    const status = err instanceof DealershipsApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
