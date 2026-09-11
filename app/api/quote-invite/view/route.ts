import { NextResponse } from "next/server";
import { getRfqInviteByViewToken, markRfqInviteDelivery } from "@/lib/rfqApi";

// The tracked link in a quote-request email. Opening it is the "viewed"
// event on the invite's audit trail; the dealer then lands on a plain page
// that says how to reply. No login, no personal data, no way to reach
// anything else from the token.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = (searchParams.get("t") || "").trim();
  const landing = new URL("/quote-request/received", req.url);

  if (/^[A-Za-z0-9_-]{8,80}$/.test(token)) {
    try {
      const found = await getRfqInviteByViewToken(token);
      if (found) {
        await markRfqInviteDelivery(found.rfqId, found.invite.id, "viewed").catch(() => null);
        const v = found.invite.vehicle;
        if (v) landing.searchParams.set("car", [v.year, v.make, v.model, v.trim].filter(Boolean).join(" "));
      }
    } catch {
      // A missed "viewed" mark must not break the dealer's landing.
    }
  }
  return NextResponse.redirect(landing, 302);
}
