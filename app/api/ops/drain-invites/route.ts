export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { env } from "node:process";
import { requireAdminSession } from "@/lib/adminAuth";
import { listAllRfqs } from "@/lib/rfqApi";
import { drainQueuedInvites } from "@/lib/inviteOutbox";
import { featureFlags } from "@/lib/featureFlags";

// Runbook: send everything still queued. An admin session, or the OPS_SECRET
// header from a shell (`curl -X POST -H "x-ops-secret: …"`). Respects the
// outbound-email switch: with it off this only reports what's parked.
async function authorized(req: Request): Promise<boolean> {
  const secret = env.OPS_SECRET;
  if (secret && req.headers.get("x-ops-secret") === secret) return true;
  return Boolean(await requireAdminSession());
}

export async function POST(req: Request) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("max") || 50)));
  const rfqs = await listAllRfqs(500);
  const result = await drainQueuedInvites(rfqs, { maxSends: limit });
  return NextResponse.json({ flags: featureFlags(), ...result });
}
