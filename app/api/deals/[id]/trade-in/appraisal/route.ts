export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDeal, appraiseDealTradeIn, DealsApiError } from "@/lib/dealsApi";

// The winning dealer prices the buyer's trade-in. Same ownership check as
// the contract upload: the deal's dealer name must match the signed-in
// dealer's account.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string; dealerName?: string; name?: string } | undefined;
  if (!user?.id || user.role !== "dealer") {
    return NextResponse.json({ error: "Sign in as a dealer to appraise a trade-in." }, { status: 401 });
  }

  const { id } = await params;
  let deal;
  try {
    deal = await getDeal(id);
  } catch (err) {
    const message = err instanceof DealsApiError ? err.message : "Could not load this deal.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (!user.dealerName || deal.dealerName !== user.dealerName) {
    return NextResponse.json({ error: "Not authorized to appraise this deal's trade-in." }, { status: 403 });
  }
  if (!deal.tradeIn) {
    return NextResponse.json({ error: "The buyer hasn't submitted a trade-in yet." }, { status: 409 });
  }

  let body: { allowance?: unknown; loanPayoff?: unknown; notes?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const allowance = Number(body?.allowance);
  if (!Number.isFinite(allowance) || allowance < 0) {
    return NextResponse.json({ error: "Enter the trade-in allowance." }, { status: 400 });
  }

  try {
    const updated = await appraiseDealTradeIn(id, {
      allowance: Math.round(allowance),
      loanPayoff: Math.max(0, Math.round(Number(body?.loanPayoff) || 0)),
      notes: typeof body?.notes === "string" ? body.notes.trim().slice(0, 1000) || undefined : undefined,
      appraisedAt: new Date().toISOString(),
      appraisedBy: user.name || user.dealerName,
    });
    return NextResponse.json({ deal: updated });
  } catch (err) {
    const message = err instanceof DealsApiError ? err.message : "Could not save the appraisal.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
