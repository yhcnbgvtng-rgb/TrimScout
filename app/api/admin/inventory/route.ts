import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { listInventory, exportInventory, inventoryStats, inventoryByDealer, inventoryVin, inventoryAnalytics, InventoryApiError, type InventoryQuery } from "@/lib/inventoryApi";
import { vehicleCsvHeader, vehicleCsvLine, vehicleSheetFilename, type VehicleRow } from "@/lib/crawlSheetColumns";

export const dynamic = "force-dynamic";
// A whole-state CSV is one box query that can take ~10s+ before the first row, then streams.
export const maxDuration = 300;

/**
 * Crawled dealer inventory for the admin sheet. `?stats=1` returns the filter-menu counts; otherwise a page of
 * vehicles for the given filters. `?export=1` streams the whole filter (cap 50k rows) as a CSV download — streamed
 * because a state's CSV is well past Vercel's 4.5MB limit on a buffered response body.
 */
export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  try {
    // Aggregates change once a day (the sync); let the admin's browser keep them a minute so tab switches are instant.
    const aggHeaders = { "Cache-Control": "private, max-age=60" };
    if (sp.get("stats") === "1") return NextResponse.json(await inventoryStats(), { headers: aggHeaders });
    if (sp.get("byDealer") === "1") return NextResponse.json(await inventoryByDealer(), { headers: aggHeaders });
    if (sp.get("vin")) return NextResponse.json(await inventoryVin(sp.get("vin") || ""));
    // Dealership analytics for the Site Analytics page — aggregated and cached on the box.
    if (sp.get("analytics") === "1") return NextResponse.json(await inventoryAnalytics({ state: sp.get("state") || undefined, make: sp.get("make") || undefined, dealerId: sp.get("dealerId") || null, model: sp.get("model") || undefined, from: sp.get("from") || undefined, to: sp.get("to") || undefined }));
    const q: InventoryQuery = {
      dealerId: sp.get("dealerId") || undefined, state: sp.get("state") || undefined, make: sp.get("make") || undefined, model: sp.get("model") || undefined,
      trim: sp.get("trim") || undefined, cond: sp.get("cond") || undefined, q: sp.get("q") || undefined, inStock: sp.get("inStock") === "1", sort: sp.get("sort") || undefined,
      changeType: sp.get("changeType") || undefined, priceChange: (sp.get("priceChange") as "drop" | "increase") || undefined, hasSticker: sp.get("hasSticker") === "1",
      minDays: sp.get("minDays") ? Number(sp.get("minDays")) : undefined, possibleDemo: sp.get("possibleDemo") === "1",
    };
    if (sp.get("export") === "1") {
      const rows = exportInventory(q);
      // Pull the first row before committing to a 200 so a box/timeout failure still comes back as a JSON error.
      const first = await rows.next();
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            controller.enqueue(encoder.encode("\uFEFF" + vehicleCsvHeader()));
            let r = first;
            while (!r.done) {
              controller.enqueue(encoder.encode(vehicleCsvLine(r.value as unknown as VehicleRow)));
              r = await rows.next();
            }
            controller.close();
          } catch (err) {
            // Erroring the stream fails the browser's download instead of saving a silently truncated CSV.
            controller.error(err);
          }
        },
        cancel() { void rows.return({ capped: false }); },
      });
      return new Response(body, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${vehicleSheetFilename()}"`, "Cache-Control": "no-store" },
      });
    }
    const limit = Math.min(Number(sp.get("limit")) || 500, 2000);
    const offset = Number(sp.get("offset")) || 0;
    return NextResponse.json(await listInventory({ ...q, limit, offset }));
  } catch (err) {
    const message = err instanceof InventoryApiError ? err.message : "Could not load inventory.";
    const status = err instanceof InventoryApiError ? (err.status === 503 ? 503 : err.status === 400 || err.status === 404 ? err.status : 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
