// GET /api/admin/rfqs — every quote request across buyers, for the admin
// desk. Admin session only. Each invite carries the dealer's calculator
// link (the same tracked link the dealer got), so an admin can open the
// exact dealer page and reply as that desk. Opening it counts as a dealer
// view — it marks the invite viewed and locks the buyer's lease sheet —
// which the desk says out loud.
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { listAllRfqs, RfqApiError } from "@/lib/rfqApi";
import type { RfqRequest } from "@/lib/rfq";

export type AdminRfqInvite = Omit<RfqRequest["invites"][number], "viewToken"> & {
  /** The dealer's calculator page for this invite — admin only. */
  calculatorUrl: string | null;
};
export type AdminRfq = Omit<RfqRequest, "invites"> & { invites: AdminRfqInvite[] };

export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit")) || 200, 1), 1000);
  try {
    const rfqs = await listAllRfqs(limit);
    const out: AdminRfq[] = rfqs.map((rfq) => ({
      ...rfq,
      invites: rfq.invites.map(({ viewToken, ...rest }) => ({
        ...rest,
        calculatorUrl: viewToken ? `/quote-request/received?t=${encodeURIComponent(viewToken)}` : null,
      })),
    }));
    return NextResponse.json({ rfqs: out });
  } catch (err) {
    const message = err instanceof RfqApiError ? err.message : "Could not load quote requests.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
