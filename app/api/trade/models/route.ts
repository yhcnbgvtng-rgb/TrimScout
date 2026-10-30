// GET /api/trade/models?year=2018&make=Honda — model names for the trade-in form's dropdown (NHTSA vPIC, cached a day).
// Public reference data only; on any failure the form falls back to typing the model.
import { NextResponse } from "next/server";
import { fetchTradeModels, isSafeMake, isSafeYear } from "@/lib/trade/vehicleChoices";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const year = Number(sp.get("year"));
  const make = (sp.get("make") || "").trim();
  if (!isSafeYear(year) || !isSafeMake(make)) return NextResponse.json({ error: "Pick a year and make." }, { status: 400 });
  try {
    return NextResponse.json({ models: await fetchTradeModels(make, year) }, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch {
    return NextResponse.json({ models: [] });
  }
}
