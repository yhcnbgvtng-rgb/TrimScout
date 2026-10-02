import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { crawlDataForVin, crawlSheetPathForVin } from "@/lib/vinCrawlLink";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/inventory/vin-link?vin=… — where the wizard's VIN should link: that VIN's page in the
 * admin crawl sheet, when our crawl holds data for it. The crawl sheet is admin-only, so anyone
 * whose real session isn't an admin always gets `{ url: null }` (the VIN stays plain text) and the
 * deals box isn't even queried. `retry: true` means the box was too slow to answer — not "no data".
 */
export async function GET(req: Request) {
  const session = await auth();
  if ((session?.user as { role?: string } | undefined)?.role !== "admin") return NextResponse.json({ url: null });
  const vin = (new URL(req.url).searchParams.get("vin") || "").trim().toUpperCase();
  const r = await crawlDataForVin(vin);
  if (r === "found") return NextResponse.json({ url: crawlSheetPathForVin(vin) });
  return NextResponse.json({ url: null, ...(r === "unavailable" ? { retry: true } : {}) });
}
