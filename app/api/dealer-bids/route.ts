import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listBidsForDealer } from "@/lib/dealsApi";

export async function GET() {
  const session = await auth();
  const user = session?.user as any;
  if (!user?.id || user.role !== "dealer") {
    return NextResponse.json({ error: "You must be signed in as a dealer." }, { status: 401 });
  }

  const bids = await listBidsForDealer(user.id);
  return NextResponse.json({ bids });
}
