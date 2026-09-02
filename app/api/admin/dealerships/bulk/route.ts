import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { bulkUpsertDealerships, DealershipsApiError, type DealershipInput } from "@/lib/dealershipsApi";

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const rows = Array.isArray(body?.dealerships) ? (body.dealerships as Partial<DealershipInput>[]) : null;
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "dealerships must be a non-empty array." }, { status: 400 });
  }

  try {
    const result = await bulkUpsertDealerships(rows);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof DealershipsApiError ? err.message : "Could not import dealerships.";
    const status = err instanceof DealershipsApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
