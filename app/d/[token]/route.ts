import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { recordDealerClick, recordDealerView } from "@/lib/dealEngagementStore";

/** Per-dealer email/open URL: `{origin}/d/{token}`. Records clicked; viewed only after login or an authenticated offer open. */

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = new URL(req.url).origin;
  const hit = await recordDealerClick(decodeURIComponent(token));
  if (!hit) {
    return NextResponse.redirect(new URL("/", origin));
  }

  const session = await auth();
  const user = session?.user as { role?: string; dealerName?: string } | undefined;
  if (user?.role === "dealer" && user.dealerName) {
    await recordDealerView({ token: decodeURIComponent(token), dealerName: user.dealerName });
    return NextResponse.redirect(new URL("/?open=dealer_inbox", origin));
  }

  const next = new URL("/?open=dealer_inbox", origin);
  next.searchParams.set("invite", decodeURIComponent(token));
  return NextResponse.redirect(next);
}
