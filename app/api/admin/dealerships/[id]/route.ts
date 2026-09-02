import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { updateDealership, deleteDealership, DealershipsApiError, type DealershipInput } from "@/lib/dealershipsApi";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as DealershipInput | null;
  if (!body?.dealerName?.trim()) {
    return NextResponse.json({ error: "dealerName is required." }, { status: 400 });
  }

  try {
    const dealership = await updateDealership(id, body);
    return NextResponse.json({ dealership });
  } catch (err) {
    const message = err instanceof DealershipsApiError ? err.message : "Could not update dealership.";
    const status = err instanceof DealershipsApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const { id } = await params;
  try {
    await deleteDealership(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof DealershipsApiError ? err.message : "Could not delete dealership.";
    const status = err instanceof DealershipsApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
