// PATCH /api/admin/rfqs/:id — an admin correcting the quote sheet before
// release: vehicle, VIN, must-haves, quote locks, buyer note, trade-in flag.
// Refused (409) once the request has been released. Every call is logged
// with who/when and a buyer-facing summary. Admin session only.
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { adminPatchRfq, RfqApiError } from "@/lib/rfqApi";

const EDITABLE = ["vin", "vehicleYear", "vehicleMake", "vehicleModel", "vehicleTrim", "stockNumber", "mustHaves", "linkPastes", "leasePrefs", "quotePrefs", "buyerNote", "tradeInExpected"] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE) if (key in body) patch[key] = body[key];
  const summary = typeof body.summary === "string" && body.summary.trim() ? body.summary.trim().slice(0, 300) : `Corrected: ${Object.keys(patch).join(", ") || "request"}`;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  try {
    const rfq = await adminPatchRfq(id, { ...patch, adminEdit: { by: session.user?.email || session.user?.id || "admin", summary } });
    return NextResponse.json({ rfq });
  } catch (err) {
    const message = err instanceof RfqApiError ? (err.status === 409 ? "This request has already been released to dealers — it can't be edited now." : err.message) : "Could not save the correction.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
