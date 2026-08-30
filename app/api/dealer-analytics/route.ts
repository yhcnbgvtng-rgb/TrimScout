import { NextResponse } from "next/server";
import { fetchVehiclesFromBox, fetchFacetsFromBox, type BoxVehicle } from "@/lib/lightsailClient";

// Every brand this pipeline currently tracks. The box's vehicle API is
// scoped to one brand per call (no cross-brand query exists), and a
// dealer's real brand isn't captured at signup today — so this checks all
// of them and uses whichever one(s) actually have inventory under this
// dealer's name. Covers the common multi-franchise case too (one dealer
// name matching more than one brand) by aggregating across every match
// rather than stopping at the first.
const BRAND_CODES = ["porsche", "ford", "chevrolet", "acura", "audi", "mclaren"];

const STALE_DAYS_ON_LOT_THRESHOLD = 45;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dealerName = searchParams.get("dealerName");
  if (!dealerName) {
    return NextResponse.json({ error: "dealerName is required" }, { status: 400 });
  }

  const perBrand = await Promise.all(
    BRAND_CODES.map(async (brand) => {
      const [vehiclesRes, facetsRes] = await Promise.all([
        fetchVehiclesFromBox({ brand, dealer: dealerName, pageSize: 200, sortBy: "days_desc" }),
        fetchFacetsFromBox({ brand, dealer: dealerName }),
      ]);
      return { brand, vehiclesRes, facetsRes };
    })
  );

  const matched = perBrand.filter((b) => (b.vehiclesRes?.stats.totalActive ?? 0) > 0);

  if (matched.length === 0) {
    return NextResponse.json({
      dealerName,
      brands: [],
      hasData: false,
      stats: { totalActive: 0, priceDrops: 0, newArrivals: 0, staleCount: 0, avgDaysOnLot: 0 },
      modelMix: [],
      agingInventory: [],
      recentPriceDrops: [],
    });
  }

  const allVehicles: BoxVehicle[] = matched.flatMap((b) => b.vehiclesRes?.vehicles ?? []);

  const totalActive = matched.reduce((s, b) => s + (b.vehiclesRes?.stats.totalActive ?? 0), 0);
  const priceDrops = matched.reduce((s, b) => s + (b.vehiclesRes?.stats.priceDrops ?? 0), 0);
  const newArrivals = matched.reduce((s, b) => s + (b.vehiclesRes?.stats.newArrivals ?? 0), 0);
  const staleCount = matched.reduce((s, b) => s + (b.vehiclesRes?.stats.staleCount ?? 0), 0);
  const weightedDaysSum = matched.reduce(
    (s, b) => s + (b.vehiclesRes?.stats.avgDaysOnLot ?? 0) * (b.vehiclesRes?.stats.totalActive ?? 0),
    0
  );
  const avgDaysOnLot = totalActive > 0 ? Math.round((weightedDaysSum / totalActive) * 10) / 10 : 0;

  const modelCounts = new Map<string, number>();
  for (const b of matched) {
    for (const f of b.facetsRes?.facets.model ?? []) {
      modelCounts.set(f.value, (modelCounts.get(f.value) || 0) + f.count);
    }
  }
  const modelMix = [...modelCounts.entries()]
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const agingInventory = allVehicles
    .filter((v) => (v.days_on_lot ?? 0) > STALE_DAYS_ON_LOT_THRESHOLD)
    .sort((a, b) => (b.days_on_lot ?? 0) - (a.days_on_lot ?? 0))
    .slice(0, 10)
    .map((v) => ({
      vin: v.vin,
      year: v.year,
      make: v.make,
      model: v.model,
      trim: v.trim,
      price: v.price,
      daysOnLot: v.days_on_lot,
      url: v.url,
    }));

  const recentPriceDrops = allVehicles
    .filter((v) => v.change_type === "PRICE_DROP" && v.price_diff)
    .sort((a, b) => (a.price_diff ?? 0) - (b.price_diff ?? 0))
    .slice(0, 10)
    .map((v) => ({
      vin: v.vin,
      year: v.year,
      make: v.make,
      model: v.model,
      trim: v.trim,
      price: v.price,
      oldPrice: v.old_price,
      priceDiff: v.price_diff,
      url: v.url,
    }));

  return NextResponse.json({
    dealerName,
    brands: matched.map((b) => b.brand),
    hasData: true,
    stats: { totalActive, priceDrops, newArrivals, staleCount, avgDaysOnLot },
    modelMix,
    agingInventory,
    recentPriceDrops,
  });
}
