// POST /api/admin/chat-pauses { dealerKey } — lift a dealer's chat pause (attempts before the lift stop counting). Admin session only.
// (The paused list itself comes with GET /api/admin/chat-review.)
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { liftChatPause, RfqApiError } from "@/lib/rfqApi";

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { dealerKey?: unknown } | null;
  const dealerKey = typeof body?.dealerKey === "string" ? body.dealerKey.trim() : "";
  if (!dealerKey) return NextResponse.json({ error: "dealerKey is required." }, { status: 400 });
  try {
    await liftChatPause(dealerKey, session.user?.email || session.user?.id || "admin");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: err instanceof RfqApiError ? err.message : "Could not lift the pause." }, { status });
  }
}
