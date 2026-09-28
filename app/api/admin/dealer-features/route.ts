import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { searchDealerFeatureText, listVehiclesWithDealerFeature } from "@/lib/dealerOptionSearch";

/**
 * Search or drill into DealerOn's free-text feature mentions for one
 * make — real, dealer-written, but unpriced and uncoded, so this is a
 * separate endpoint from /api/admin/dealer-options rather than a shared
 * one: those are two different box facets (`optionCode` vs `featureText`).
 * `?q=` searches by feature name; `?name=` (with `?q=` omitted) lists the
 * actual vehicles carrying an already-known feature name.
 */
export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const make = (params.get("make") || "").trim();
  if (!make) {
    return NextResponse.json({ error: "make is required." }, { status: 400 });
  }

  const name = (params.get("name") || "").trim();
  if (name) {
    const vehicles = await listVehiclesWithDealerFeature(make, name);
    if (vehicles === null) {
      return NextResponse.json({ error: "Could not reach the inventory box." }, { status: 502 });
    }
    return NextResponse.json({ make, name, vehicles });
  }

  const q = (params.get("q") || "").trim();
  if (!q) {
    return NextResponse.json({ error: "q or name is required." }, { status: 400 });
  }
  const results = await searchDealerFeatureText(q, make);
  if (results === null) {
    return NextResponse.json({ error: "Could not reach the inventory box." }, { status: 502 });
  }
  return NextResponse.json({ make, query: q, results });
}
