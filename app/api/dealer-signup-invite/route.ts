import { NextResponse } from "next/server";
import { verifyDealerSignupInviteToken } from "@/lib/dealerSignupInvite";
import { listDealerships, DealershipsApiError } from "@/lib/dealershipsApi";

// Public (no login) — a dealer following an invite link hasn't got an
// account yet. The real gate here is the HMAC-signed token, not dealerId
// secrecy (verifyDealerSignupInviteToken already rejects any request
// without a valid one below) — so once that passes, returning the on-file
// contact name/email to pre-fill the signup form isn't a bigger leak than
// the dealer name alone was: whoever holds a valid token already received
// (or generated) a legitimate invite. Still deliberately withholds phone
// and notes — nothing beyond what this specific pre-fill needs.
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
    return NextResponse.json({
      dealerName: dealership.dealerName,
      contactName: dealership.contactName,
      contactEmail: dealership.contactEmail,
    });
  } catch (err) {
    const message = err instanceof DealershipsApiError ? err.message : "Could not look up this invite.";
    const status = err instanceof DealershipsApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
