// GET /api/admin/rfqs/:id/trade-audit — the allowance log for one request: every allowance set, updated, declined, confirmed,
// revised or defaulted, with actor and timestamp. Admin session only.
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { listTradeAudit, RfqApiError } from "@/lib/rfqApi";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { id } = await params;
  try {
    return NextResponse.json({ audit: await listTradeAudit(id) });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not load the allowance log.";
    return NextResponse.json({ error: message }, { status: err instanceof RfqApiError ? err.status : 502 });
  }
}
