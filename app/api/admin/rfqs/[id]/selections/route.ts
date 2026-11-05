// GET /api/admin/rfqs/:id/selections — READ-ONLY diagnostic: every saved vehicle selection and its invitation outcome.
//
// Opens a request and reports; it never creates an invitation and never sends or drains email (pinned by
// lib/selectionOutcomes.test.ts). No addresses or tokens in the answer. Admin session only.
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getRfq, RfqApiError } from "@/lib/rfqApi";
import { deliveryLine, hasUnexplainedGap, isPartial, summarizeRows, summaryHeadline, vehicleRows } from "@/lib/selectionOutcomes";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { id } = await params;
  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    const rows = vehicleRows(rfq).map((r) => ({
      vin: r.vehicle.vin,
      vehicle: [r.vehicle.year, r.vehicle.make, r.vehicle.model, r.vehicle.trim].filter(Boolean).join(" "),
      role: r.role,
      dealerName: r.dealerName,
      status: r.status,
      statusLabel: r.statusLabel,
      reasonCode: r.code,
      reason: r.reason,
      inviteId: r.inviteId,
      quoted: Boolean(r.quote),
    }));
    const summary = summarizeRows(vehicleRows(rfq));
    return NextResponse.json({
      requestId: rfq.id,
      approvalStatus: rfq.approvalStatus ?? "approved",
      outcomesRecorded: Array.isArray(rfq.selectionOutcomes) && rfq.selectionOutcomes.length > 0,
      headline: summaryHeadline(summary),
      delivery: deliveryLine(summary),
      partial: isPartial(summary),
      hasUnexplainedGap: hasUnexplainedGap(vehicleRows(rfq)),
      summary,
      rows,
    });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not load this request.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
