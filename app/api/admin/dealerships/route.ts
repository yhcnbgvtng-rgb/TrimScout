import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { listDealerships, createDealership, DealershipsApiError, type DealershipInput } from "@/lib/dealershipsApi";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  try {
    const dealerships = await listDealerships();
    return NextResponse.json({ dealerships });
  } catch (err) {
    const message = err instanceof DealershipsApiError ? err.message : "Could not load dealerships.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as DealershipInput | null;
  if (!body?.dealerName?.trim()) {
    return NextResponse.json({ error: "dealerName is required." }, { status: 400 });
  }

  try {
    const dealership = await createDealership(body);
    return NextResponse.json({ dealership }, { status: 201 });
  } catch (err) {
    const message = err instanceof DealershipsApiError ? err.message : "Could not create dealership.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
