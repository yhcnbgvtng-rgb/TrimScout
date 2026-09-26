import { NextResponse } from "next/server";
import { marketPulse } from "@/lib/inventoryApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/market-pulse?scope=national | ?state=NJ — the public homepage's crawl-derived market
 * pulse. Reads only from the box's own 10-minute cache (see handleMarketPulse/computeMarketPulse
 * in deals_api_server.js) — never a live full-inventory scan in the browser.
 *
 * Deliberately soft-fails with `{ available: false }` (200, not an error) on any failure —
 * including the underlying box call's own 60-second timeout — rather than the plain
 * `InventoryApiError`-to-status-code passthrough every other inventory route here uses. This is a
 * public homepage widget, not an admin tool or a page whose whole point is the inventory call
 * (like /search): a slow or failed pulse should just not render, never surface a hang or an error
 * to a visitor who came for something else entirely.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const state = (sp.get("state") || "").trim().toUpperCase().slice(0, 2) || undefined;

  try {
    const pulse = await marketPulse(state);
    return NextResponse.json({ available: true, pulse }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return NextResponse.json({ available: false });
  }
}
