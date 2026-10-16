// GET /api/admin/trade-honesty — INTERNAL ONLY. Per-dealer "desk honesty" rollup over trade confirmations: % confirmed as quoted,
// average revision delta, firm-breach count, median time to confirm (plus flagged-for-review count and % acted within the deadline).
// Admin session only. Never shown to buyers or dealers; nothing here reaches a public response.
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { listAllRfqs, RfqApiError } from "@/lib/rfqApi";
import { deskHonestyRollup, quoteMetrics } from "@/lib/trade/confirm";

export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit")) || 1000, 1), 2000);
  try {
    const rfqs = await listAllRfqs(limit);
    const rows = rfqs.flatMap((rfq) => rfq.invites.filter((i) => i.tradeConfirmation).map((i) => ({ rfqId: rfq.id, inviteId: i.id, dealerKey: i.dealerName, dealerName: i.dealerName, confirmation: i.tradeConfirmation! })));
    return NextResponse.json({
      desks: deskHonestyRollup(rows),
      // The per-quote record the spec asks to keep, flat, for export.
      quotes: rows.map((r) => ({ rfqId: r.rfqId, inviteId: r.inviteId, dealerName: r.dealerName, status: r.confirmation.status, ...quoteMetrics(r.confirmation), revision_flagged: r.confirmation.revisionFlagged, firm_breach: r.confirmation.firmBreach })),
    });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not load trade metrics.";
    return NextResponse.json({ error: message }, { status: err instanceof RfqApiError ? err.status : 502 });
  }
}
