import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { DealershipsApiError } from "@/lib/dealershipsApi";
import { cachedDealerDirectory } from "@/lib/dealerDirectoryCache";
import { crawlRowFromDealership } from "@/lib/crawlSheet";

export const dynamic = "force-dynamic";

/**
 * Every directory row flattened into crawl-sheet columns (lib/crawlSheet.ts). Admin only. The crawl notes are
 * ~6 MB of the 14 MB payload and sit in a hidden column, so they're left out unless `?notes=1` — the sheet
 * fetches them lazily the first time they're needed. Served from the one-minute directory cache.
 */
export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  const withNotes = new URL(req.url).searchParams.get("notes") === "1";
  try {
    const dealerships = await cachedDealerDirectory();
    const rows = dealerships.map(crawlRowFromDealership);
    const body = withNotes ? { notes: Object.fromEntries(rows.map((r) => [r.id, r.notes])) } : { rows: rows.map(({ notes: _n, ...r }) => ({ ...r, notes: "" })), fetchedAt: new Date().toISOString() };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=120" } });
  } catch (err) {
    const message = err instanceof DealershipsApiError ? err.message : "Could not load the crawl sheet.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
