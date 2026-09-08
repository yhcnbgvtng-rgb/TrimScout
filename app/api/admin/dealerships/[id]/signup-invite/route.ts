import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { dealerSignupInviteUrl } from "@/lib/dealerSignupInvite";
import { listDealerships, DealershipsApiError } from "@/lib/dealershipsApi";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const { id } = await params;
  try {
    const dealerships = await listDealerships();
    if (!dealerships.some((d) => d.id === id)) {
      return NextResponse.json({ error: "Dealership not found." }, { status: 404 });
    }
    return NextResponse.json({ url: dealerSignupInviteUrl(id) });
  } catch (err) {
    const message = err instanceof DealershipsApiError ? err.message : "Could not generate the invite link.";
    const status = err instanceof DealershipsApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
