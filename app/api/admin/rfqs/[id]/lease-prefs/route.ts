import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getRfq, RfqApiError, updateRfqLeasePrefs } from "@/lib/rfqApi";
import { parseLeasePrefs } from "@/lib/leaseQuote";

/**
 * PATCH /api/admin/rfqs/:id/lease-prefs — the admin's "edit lease terms"
 * before approving. Same box mutator the buyer's own edit uses
 * (updateRfqLeasePrefs / PATCH /api/rfqs/:id/lease-prefs on the box) — it's
 * the only field on the request the box lets anyone change after
 * creation. The box still enforces the sheet-lock (409 once a dealer has
 * viewed) and the collecting-only rule; this route just reports them in
 * admin words. Admin session only.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const prefs = parseLeasePrefs(body?.leasePrefs);
  if (!prefs) return NextResponse.json({ error: "Pick a term and a mileage band the calculator can quote to." }, { status: 400 });

  try {
    const rfq = await getRfq(id);
    if (!rfq) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
    if (!rfq.leasePrefs) return NextResponse.json({ error: "This request has no lease quote sheet." }, { status: 409 });
    if (rfq.leaseSheetLockedAt) {
      return NextResponse.json({ error: "Locked — a dealer has already viewed this request.", lockedAt: rfq.leaseSheetLockedAt }, { status: 409 });
    }
    if (rfq.status !== "collecting") return NextResponse.json({ error: "This request is closed." }, { status: 409 });
    const updated = await updateRfqLeasePrefs(id, prefs);
    const { invites, ...rest } = updated;
    return NextResponse.json({ rfq: { ...rest, invites: invites.map(({ viewToken, ...i }) => i) } });
  } catch (err) {
    if (err instanceof RfqApiError && err.status === 409) {
      return NextResponse.json({ error: "Locked — a dealer has already viewed this request." }, { status: 409 });
    }
    const message = err instanceof RfqApiError ? err.message : "Could not save these changes.";
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
