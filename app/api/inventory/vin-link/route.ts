import { NextResponse } from "next/server";
import { crawlLinkForVin } from "@/lib/vinCrawlLink";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/inventory/vin-link?vin=… — the dealer listing page our crawl captured for a VIN, for the
 * wizard's VIN hyperlinks. Public like the buyer search (it exposes only a dealer's own public listing
 * URL). `{ url: null, retry: true }` means the deals box was too slow to answer, not "no crawl data".
 */
export async function GET(req: Request) {
  const vin = new URL(req.url).searchParams.get("vin") || "";
  const r = await crawlLinkForVin(vin);
  if (r.status === "found") return NextResponse.json({ url: r.url });
  return NextResponse.json({ url: null, ...(r.status === "unavailable" ? { retry: true } : {}) });
}
