export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { listAllRfqs } from "@/lib/rfqApi";
import { queuedInvitesOf } from "@/lib/inviteOutbox";
import { featureFlags } from "@/lib/featureFlags";
import { opsSnapshot } from "@/lib/opsMetrics";
import { stickerBreakerSnapshot } from "@/lib/hyundaiSticker";
import { inviteStage } from "@/lib/quotePackage";

// One screen for a spike: switches, this instance's counters, queue depth
// across open requests, sticker circuit-breaker state, and a ghost/decline
// proxy (invites opened but never quoted, declined) over the last 7 days.
export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const rfqs = await listAllRfqs(500).catch(() => []);
  const open = rfqs.filter((r) => r.status === "collecting");
  const weekAgo = Date.now() - 7 * 86400e3;
  const recent = rfqs.filter((r) => new Date(r.createdAt).getTime() >= weekAgo);
  const stages: Record<string, number> = {};
  for (const r of recent) for (const i of r.invites) stages[inviteStage(i)] = (stages[inviteStage(i)] || 0) + 1;
  const viewedNoQuote = stages.viewed || 0;
  const quoted = stages.quoted || 0;
  const declined = stages.declined || 0;
  return NextResponse.json({
    flags: featureFlags(),
    instance: opsSnapshot(),
    queue: { openRequests: open.length, queuedInvites: open.reduce((n, r) => n + queuedInvitesOf(r).length, 0) },
    last7d: { requests: recent.length, inviteStages: stages, ghostRate: viewedNoQuote + quoted ? Math.round((viewedNoQuote / (viewedNoQuote + quoted)) * 100) / 100 : null, declineRate: declined + quoted ? Math.round((declined / (declined + quoted)) * 100) / 100 : null },
    stickerBreaker: stickerBreakerSnapshot(),
    advice: (viewedNoQuote + quoted >= 10 && viewedNoQuote / (viewedNoQuote + quoted) > 0.7) ? "Ghost rate high — consider FEATURE_RFQ_SEND=off to pause new invites." : null,
  });
}
