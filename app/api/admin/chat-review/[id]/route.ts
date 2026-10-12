// POST /api/admin/chat-review/:id { decision: "release" | "block" } — decide one held or reported message. A block that pauses the dealer
// emails Paul through the SAFE MODE sender. Admin session only.
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { decideChatReview, RfqApiError } from "@/lib/rfqApi";
import { buildChatPauseNotice } from "@/lib/chatGuardNotice";
import { sendChatPauseNotice } from "@/lib/dealerEmail";
import { DEALER_EMAIL_BASE_URL } from "@/lib/dealerUnsubscribe";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { decision?: unknown } | null;
  const decision = body?.decision === "release" || body?.decision === "block" ? body.decision : null;
  const n = Number(id);
  if (!decision || !Number.isInteger(n)) return NextResponse.json({ error: "decision must be release or block." }, { status: 400 });
  try {
    const r = await decideChatReview(n, decision, session.user?.email || session.user?.id || "admin");
    if (r.justPaused) await sendChatPauseNotice(buildChatPauseNotice({ dealerName: r.dealerName || "A dealer", attempts: r.attempts ?? 3, adminUrl: `${DEALER_EMAIL_BASE_URL}/admin/chat-review` }));
    return NextResponse.json({ ok: true, status: r.status, paused: r.paused });
  } catch (err) {
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: err instanceof RfqApiError ? err.message : "Could not record the decision." }, { status });
  }
}
