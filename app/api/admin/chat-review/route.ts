// GET /api/admin/chat-review — the queue of held and reported chat messages awaiting an admin (Release / Block). Admin session only.
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { listChatPauses, listChatReview, RfqApiError } from "@/lib/rfqApi";

export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  try {
    const [items, pauses] = await Promise.all([listChatReview(), listChatPauses()]);
    return NextResponse.json({ items, pauses });
  } catch (err) {
    const status = err instanceof RfqApiError ? err.status : 502;
    return NextResponse.json({ error: err instanceof RfqApiError ? err.message : "Could not load the queue." }, { status });
  }
}
