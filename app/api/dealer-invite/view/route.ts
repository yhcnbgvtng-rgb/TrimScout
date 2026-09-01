import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { recordDealerView } from "@/lib/dealEngagementStore";

/** Authenticated dealer follows an email invite token after login. */
export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string; dealerName?: string } | undefined;
  if (!user?.id || user.role !== "dealer") {
    return NextResponse.json({ error: "You must be signed in as a dealer." }, { status: 401 });
  }
  if (!user.dealerName) {
    return NextResponse.json({ error: "Your account has no dealership name on file." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  await recordDealerView({ token, dealerName: user.dealerName });
  return NextResponse.json({ ok: true });
}
