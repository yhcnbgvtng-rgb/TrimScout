import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { searchDealerListedOptions, listVehiclesWithDealerOption } from "@/lib/dealerOptionSearch";

/**
 * Search or drill into dealer-listed (Dealer.com, real per-item code)
 * factory options for one brand — never a window sticker, never
 * factory_verified. `?q=` searches by name; `?code=` (with `?q=` omitted)
 * lists the actual vehicles carrying an already-known code.
 */
export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const brand = (params.get("brand") || "").trim();
  if (!brand) {
    return NextResponse.json({ error: "brand is required." }, { status: 400 });
  }

  const code = (params.get("code") || "").trim();
  if (code) {
    const vehicles = await listVehiclesWithDealerOption(brand, code);
    if (vehicles === null) {
      return NextResponse.json({ error: "Could not reach the inventory box." }, { status: 502 });
    }
    return NextResponse.json({ brand, code, vehicles });
  }

  const q = (params.get("q") || "").trim();
  if (!q) {
    return NextResponse.json({ error: "q or code is required." }, { status: 400 });
  }
  const results = await searchDealerListedOptions(q, brand);
  if (results === null) {
    return NextResponse.json({ error: "Could not reach the inventory box." }, { status: 502 });
  }
  return NextResponse.json({ brand, query: q, results });
}
