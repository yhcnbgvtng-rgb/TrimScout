import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { listDealerships, DealershipsApiError } from "@/lib/dealershipsApi";
import { crawlRowFromDealership } from "@/lib/crawlSheet";

export const dynamic = "force-dynamic";

/** Every directory row flattened into crawl-sheet columns (lib/crawlSheet.ts). Admin only. */
export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  try {
    const dealerships = await listDealerships();
    return NextResponse.json({ rows: dealerships.map(crawlRowFromDealership), fetchedAt: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof DealershipsApiError ? err.message : "Could not load the crawl sheet.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
