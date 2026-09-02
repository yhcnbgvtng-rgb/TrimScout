import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchVehiclesFromBox, fetchFacetsFromBox, fetchBoxHealth, type BoxVehicle } from "@/lib/lightsailClient";

// Every brand this pipeline currently tracks. The box's vehicle API is
// scoped to one brand per call (no cross-brand query exists), and a
// dealer's real brand isn't captured at signup today — so this checks all
// of them and uses whichever one(s) actually have inventory under this
// dealer's name. Covers the common multi-franchise case too (one dealer
// name matching more than one brand) by aggregating across every match
// rather than stopping at the first.
const BRAND_CODES = ["porsche", "ford", "chevrolet", "acura", "audi", "mclaren"];

const STALE_DAYS_ON_LOT_THRESHOLD = 45;

// A large dealer's full-inventory pagination plus the nationwide lookups
// below can run several seconds under normal load, and longer while the
// box's crawlers are actively running (they share the same small instance
// — see the pending Lightsail upgrade). Vercel's default function timeout
// is tight enough to risk a hard failure here; this raises the ceiling
// (Hobby plans cap it regardless, so this is a no-op there, not a risk).
export const maxDuration = 30;

export async function GET(req: Request) {
  const session = await auth();
  const user = session?.user as any;
  if (!user?.id || user.role !== "dealer") {
    return NextResponse.json({ error: "You must be signed in as a dealer." }, { status: 401 });
  }
  // Always the session's own dealership — a dealerName query param, if
  // present, is ignored. This used to trust whatever name was passed in,
  // which let anyone pull any dealership's live inventory and pricing by
  // guessing a name.
  const dealerName = user.dealerName;
  if (!dealerName) {
    return NextResponse.json({
      dealerName: null,
      brands: [],
      hasData: false,
      stats: { totalActive: 0, priceDrops: 0, newArrivals: 0, staleCount: 0, avgDaysOnLot: 0 },
      modelMix: [],
      agingInventory: [],
      recentPriceDrops: [],
    });
  }

  // Same reachability check as app/api/dealer-requests/route.ts — every
  // per-brand vehicle lookup below collapses "genuinely zero inventory" and
  // "the data source is unreachable" to the same null, so without this a
  // real outage rendered as a confident "no data yet" instead of an error.
  const health = await fetchBoxHealth();
  if (!health) {
    return NextResponse.json(
      { error: "Could not reach the inventory service — try again shortly." },
      { status: 502 }
    );
  }

  const perBrand = await Promise.all(
    BRAND_CODES.map(async (brand) => {
      const [firstPage, facetsRes] = await Promise.all([
        fetchVehiclesFromBox({ brand, dealer: dealerName, pageSize: 200, page: 1, sortBy: "days_desc" }),
        fetchFacetsFromBox({ brand, dealer: dealerName }),
      ]);
      // 200/page is the box's hard cap — a dealer with more than that (real
      // case: Paul Miller Porsche has 246) needs the remaining pages pulled
      // too, or "full inventory" would silently truncate.
      let vehicles = firstPage?.vehicles ?? [];
      const totalPages = firstPage?.pagination.totalPages ?? 1;
      if (totalPages > 1) {
        const restPages = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, i) => i + 2).map((page) =>
            fetchVehiclesFromBox({ brand, dealer: dealerName, pageSize: 200, page, sortBy: "days_desc" })
          )
        );
        vehicles = vehicles.concat(...restPages.map((r) => r?.vehicles ?? []));
      }
      const vehiclesRes = firstPage ? { ...firstPage, vehicles } : null;
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

  // Full real inventory (every vehicle, not just the top-10 aging/price-drop
  // slices above), for the model-grouped searchable list at the bottom of
  // the page — every VIN, with its real price change.
  const fullInventory = allVehicles
    .map((v) => ({
      vin: v.vin,
      year: v.year,
      make: v.make,
      model: v.model,
      trim: v.trim,
      price: v.price,
      oldPrice: v.old_price,
      priceDiff: v.price_diff,
      changeType: v.change_type,
      status: v.status,
      daysOnLot: v.days_on_lot,
      url: v.url,
    }))
    .sort((a, b) => (a.model || "").localeCompare(b.model || "") || (a.price || 0) - (b.price || 0));

  // Nationwide competitive view: for the dealer's own top models, pull the
  // same model across ALL dealers (no `dealer` filter), sorted by
  // days-on-lot descending — the box supports this sort server-side (same
  // param used for `agingInventory` above), so the top of each list is
  // exactly the highest-days-on-hand units without a full-catalog pull.
  // Capped at 5 models / 25 rows each: this box currently runs its crawlers
  // on the same small instance that serves this API (a known, temporary
  // capacity constraint — see the pending Lightsail instance upgrade), so
  // this stays conservative to avoid piling parallel load onto an
  // already-contended box. Revisit these caps upward once that upgrade
  // lands.
  const NATIONWIDE_MODEL_CAP = 5;
  const NATIONWIDE_PER_MODEL_CAP = 25;
  const modelBrandPairs = new Map<string, string>(); // model -> brand
  for (const b of matched) {
    for (const f of b.facetsRes?.facets.model ?? []) {
      if (!modelBrandPairs.has(f.value)) modelBrandPairs.set(f.value, b.brand);
    }
  }
  const topModelPairs = modelMix
    .slice(0, NATIONWIDE_MODEL_CAP)
    .map((m) => [m.model, modelBrandPairs.get(m.model)] as const)
    .filter((pair): pair is [string, string] => !!pair[1]);

  const nationwideByModel = await Promise.all(
    topModelPairs.map(async ([model, brand]) => {
      const res = await fetchVehiclesFromBox({
        brand,
        model,
        pageSize: NATIONWIDE_PER_MODEL_CAP,
        page: 1,
        sortBy: "days_desc",
      });
      const vehicles = (res?.vehicles ?? [])
        .slice()
        .sort((a, b) => (b.days_on_lot ?? 0) - (a.days_on_lot ?? 0))
        .map((v) => ({
          vin: v.vin,
          dealerName: v.dealer_name,
          state: v.state,
          year: v.year,
          make: v.make,
          model: v.model,
          trim: v.trim,
          price: v.price,
          oldPrice: v.old_price,
          priceDiff: v.price_diff,
          changeType: v.change_type,
          daysOnLot: v.days_on_lot,
          url: v.url,
        }));
      return {
        model,
        brand,
        totalCount: res?.pagination.totalCount ?? vehicles.length,
        vehicles,
      };
    })
  );
  const nationwideInventory = nationwideByModel
    .filter((m) => m.vehicles.length > 0)
    .sort((a, b) => a.model.localeCompare(b.model));

  return NextResponse.json({
    dealerName,
    brands: matched.map((b) => b.brand),
    hasData: true,
    stats: { totalActive, priceDrops, newArrivals, staleCount, avgDaysOnLot },
    modelMix,
    agingInventory,
    recentPriceDrops,
    fullInventory,
    nationwideInventory,
  });
}
