import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listBidsForDealer, DealsApiError } from "@/lib/dealsApi";

export async function GET() {
  const session = await auth();
  const user = session?.user as any;
  if (!user?.id || user.role !== "dealer") {
    return NextResponse.json({ error: "You must be signed in as a dealer." }, { status: 401 });
  }

  try {
    const bids = await listBidsForDealer(user.id);
    return NextResponse.json({ bids });
  } catch (err) {
    const message = err instanceof DealsApiError ? err.message : "Could not load your bids.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
