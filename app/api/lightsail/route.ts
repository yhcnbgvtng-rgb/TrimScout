import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import {
  fetchVehiclesFromBox,
  fetchFacetsFromBox,
  type BoxVehicle,
} from "@/lib/lightsailClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// This is a Lightsail Static IP (allocated 2026-08-25), not the instance's
// original ephemeral public IP — it stays valid across instance
// resize/migration since the static IP can be reattached to whichever box
// is currently the production crawler.
const LIGHTSAIL_HOST = process.env.LIGHTSAIL_IP || "44.205.48.153";

// Flat, camelCase vehicle shape used by the existing default/"summary"
// action and by the legacy fallback chain (live CSV -> committed JSON ->
// hardcoded fixtures). Kept exactly as before — nothing below this comment
// block changed behavior for the existing action.
interface LegacyVehicle {
  vin: string;
  dealerName: string;
  state: string;
  inventoryType: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  price: number | null;
  oldPrice: number | null;
  priceDiff: number;
  mileage: number;
  status: string;
  changeType: string;
  daysOnLot: number;
  firstSeen: string;
  lastSeen: string;
  url: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Legacy fallback chain: live CSV on :3000 -> committed JSON snapshot ->
// hardcoded fixtures. Extracted verbatim (behavior-for-behavior) from the
// original inline GET body so both the existing default/"summary" action
// and the new action=vehicles/action=facets paths can share it as the
// bottom tier of their fallback chain.
// ---------------------------------------------------------------------------
async function loadLegacyLiveData(): Promise<LegacyVehicle[]> {
  // 1. Attempt to fetch live from Lightsail server
  let liveData: LegacyVehicle[] | null = null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`http://${LIGHTSAIL_HOST}:3000/export.csv`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const csvText = await res.text();
      const lines = csvText.trim().split("\n");
      if (lines.length > 1) {
        const rows = lines.slice(1).map((line) => {
          const values: string[] = [];
          let inQuotes = false;
          let current = "";
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === "," && !inQuotes) {
              values.push(current.trim());
              current = "";
            } else {
              current += char;
            }
          }
          values.push(current.trim());
          return {
            vin: values[0] || "",
            dealerName: values[1]?.replace(/^"|"$/g, "") || "",
            state: values[2] || "",
            inventoryType: values[3] || "NEW",
            year: parseInt(values[4], 10) || 2026,
            make: values[5] || "Porsche",
            model: values[6]?.replace(/^"|"$/g, "") || "",
            trim: values[7]?.replace(/^"|"$/g, "") || "",
            price: (parseFloat(values[8]) > 0 && parseFloat(values[8]) < 5000000 && parseFloat(values[8]) !== 2147483647) ? parseFloat(values[8]) : null,
            oldPrice: (parseFloat(values[9]) > 0 && parseFloat(values[9]) < 5000000 && parseFloat(values[9]) !== 2147483647) ? parseFloat(values[9]) : null,
            priceDiff: (parseFloat(values[10]) && Math.abs(parseFloat(values[10])) < 5000000) ? parseFloat(values[10]) : 0,
            mileage: parseFloat(values[11]) || 0,
            status: values[12] || "ACTIVE",
            changeType: values[13] || "UNCHANGED",
            daysOnLot: parseInt(values[14], 10) || 14,
            firstSeen: values[15] || "",
            lastSeen: values[16] || "",
            url: values[17] || "",
          };
        });
        liveData = rows;
      }
    }
  } catch (netErr) {
    console.warn("Direct Lightsail HTTP fetch failed, reading local snapshot:", netErr);
  }

  // 2. Fallback to local snapshot file if direct connection times out
  if (!liveData) {
    const localDataPath = path.resolve(
      process.cwd(),
      "data/lightsail_inventory.json"
    );
    try {
      const raw = await fs.readFile(localDataPath, "utf-8");
      liveData = JSON.parse(raw);
    } catch {
      // High quality fallback data if files are not initialized
      liveData = [
        {
          vin: "WP1AA2A53TLB07942",
          dealerName: "Paul Miller Porsche",
          state: "NJ",
          inventoryType: "NEW",
          year: 2026,
          make: "Porsche",
          model: "Macan",
          trim: "GTS",
          price: 89900,
          oldPrice: 94500,
          priceDiff: -4600,
          mileage: 12,
          status: "ACTIVE",
          changeType: "PRICE_DROP",
          daysOnLot: 38,
          firstSeen: "2026-08-01",
          lastSeen: "2026-08-23",
          url: "https://www.paulmillerporsche.com",
        },
        {
          vin: "WP0AB2A97TS226181",
          dealerName: "Paul Miller Porsche",
          state: "NJ",
          inventoryType: "NEW",
          year: 2026,
          make: "Porsche",
          model: "911",
          trim: "Carrera GTS",
          price: 184500,
          oldPrice: null,
          priceDiff: 0,
          mileage: 8,
          status: "ACTIVE",
          changeType: "NEW_ARRIVAL",
          daysOnLot: 2,
          firstSeen: "2026-08-21",
          lastSeen: "2026-08-23",
          url: "https://www.paulmillerporsche.com",
        },
        {
          vin: "WP1AA2AY6LDA00680",
          dealerName: "Champion Porsche",
          state: "FL",
          inventoryType: "USED",
          year: 2024,
          make: "Porsche",
          model: "Cayenne",
          trim: "S Coupe",
          price: 92500,
          oldPrice: 98000,
          priceDiff: -5500,
          mileage: 6200,
          status: "ACTIVE",
          changeType: "PRICE_DROP",
          daysOnLot: 49,
          firstSeen: "2026-07-28",
          lastSeen: "2026-08-23",
          url: "https://www.champion-porsche.com",
        },
        {
          vin: "WP0AA2Y14RSA54321",
          dealerName: "The Collection Porsche",
          state: "FL",
          inventoryType: "NEW",
          year: 2025,
          make: "Porsche",
          model: "Taycan",
          trim: "4S Cross Turismo",
          price: 118200,
          oldPrice: 129500,
          priceDiff: -11300,
          mileage: 15,
          status: "ACTIVE",
          changeType: "PRICE_DROP",
          daysOnLot: 64,
          firstSeen: "2026-06-20",
          lastSeen: "2026-08-23",
          url: "https://www.thecollectionporsche.com",
        },
        {
          vin: "WP0AB2A84KS278857",
          dealerName: "Porsche South Shore",
          state: "NY",
          inventoryType: "CERTIFIED_PRE_OWNED",
          year: 2023,
          make: "Porsche",
          model: "718 Cayman",
          trim: "GTS 4.0",
          price: 88500,
          oldPrice: 91900,
          priceDiff: -3400,
          mileage: 8400,
          status: "ACTIVE",
          changeType: "PRICE_DROP",
          daysOnLot: 42,
          firstSeen: "2026-07-12",
          lastSeen: "2026-08-23",
          url: "https://www.porschesouthshore.com",
        },
        {
          vin: "WP0AA2A90MS205791",
          dealerName: "Porsche Brooklyn",
          state: "NY",
          inventoryType: "NEW",
          year: 2026,
          make: "Porsche",
          model: "Panamera",
          trim: "4 E-Hybrid",
          price: 114000,
          oldPrice: null,
          priceDiff: 0,
          mileage: 6,
          status: "ACTIVE",
          changeType: "NEW_ARRIVAL",
          daysOnLot: 5,
          firstSeen: "2026-08-18",
          lastSeen: "2026-08-23",
          url: "https://www.porschebrooklyn.com",
        },
      ];
    }
  }

  return liveData as LegacyVehicle[];
}

// ---------------------------------------------------------------------------
// NEW action=vehicles / action=facets paths (Step 5 of the architecture
// migration). These are additive: they live entirely under new `action`
// values so the existing default/"summary" behavior below is untouched.
//
// Tier 1: the new paginated/filtered box API (MariaDB-backed, port 3002).
// Tier 2 (fallback if the box call fails/times out/is unconfigured): the
// same legacy CSV -> JSON -> fixtures chain used by the default action,
// with best-effort filtering/pagination/faceting applied in-process since
// that data isn't natively paginated.
// ---------------------------------------------------------------------------

function paramsFromSearchParams(searchParams: URLSearchParams): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (key === "action") continue;
    params[key] = value;
  }
  return params;
}

function applyLegacyFilters(liveData: LegacyVehicle[], params: Record<string, string>): LegacyVehicle[] {
  let filtered = liveData;

  if (params.brand) {
    const brand = params.brand.toLowerCase();
    filtered = filtered.filter((v) => (v.make || "").toLowerCase() === brand);
  }
  if (params.search) {
    const q = params.search.toLowerCase();
    filtered = filtered.filter((v) =>
      [v.model, v.trim, v.dealerName, v.vin].some((f) => (f || "").toString().toLowerCase().includes(q))
    );
  }
  if (params.model) {
    filtered = filtered.filter((v) => (v.model || "").toLowerCase() === params.model.toLowerCase());
  }
  if (params.trim) {
    filtered = filtered.filter((v) => (v.trim || "").toLowerCase() === params.trim.toLowerCase());
  }
  if (params.dealer) {
    filtered = filtered.filter((v) => v.dealerName === params.dealer);
  }
  if (params.state) {
    filtered = filtered.filter((v) => v.state === params.state);
  }
  if (params.condition) {
    filtered = filtered.filter((v) => v.inventoryType === params.condition);
  }
  if (params.year) {
    filtered = filtered.filter((v) => String(v.year) === params.year);
  }
  if (params.minPrice) {
    const min = Number(params.minPrice);
    filtered = filtered.filter((v) => (v.price || 0) >= min);
  }
  if (params.maxPrice) {
    const max = Number(params.maxPrice);
    filtered = filtered.filter((v) => (v.price || 0) <= max);
  }
  if (params.maxMileage) {
    const max = Number(params.maxMileage);
    filtered = filtered.filter((v) => (v.mileage || 0) <= max);
  }
  if (params.minDaysOnLot) {
    const min = Number(params.minDaysOnLot);
    filtered = filtered.filter((v) => (v.daysOnLot || 0) >= min);
  }
  if (params.maxDaysOnLot) {
    const max = Number(params.maxDaysOnLot);
    filtered = filtered.filter((v) => (v.daysOnLot || 0) <= max);
  }
  if (params.opportunity) {
    filtered = filtered.filter((v) => {
      switch (params.opportunity) {
        case "drops":
          return v.changeType === "PRICE_DROP" || v.priceDiff < 0;
        case "fresh":
          return v.changeType === "NEW_ARRIVAL" || (v.daysOnLot || 0) <= 3;
        case "stale":
          return (v.daysOnLot || 0) > 60;
        case "cpo":
          return v.inventoryType === "CERTIFIED_PRE_OWNED";
        default:
          return true;
      }
    });
  }

  return filtered;
}

function sortLegacy(filtered: LegacyVehicle[], sortBy: string | undefined): LegacyVehicle[] {
  const arr = [...filtered];
  switch (sortBy) {
    case "price_asc":
      return arr.sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER));
    case "price_desc":
      return arr.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    case "days_on_lot":
      return arr.sort((a, b) => (b.daysOnLot || 0) - (a.daysOnLot || 0));
    case "year":
      return arr.sort((a, b) => (b.year || 0) - (a.year || 0));
    default:
      // "newest" and unrecognized values both default to most-recently-seen
      return arr.sort((a, b) => (b.firstSeen || "").localeCompare(a.firstSeen || ""));
  }
}

function legacyStats(filtered: LegacyVehicle[]) {
  const priceDrops = filtered.filter((v) => v.changeType === "PRICE_DROP" || v.priceDiff < 0).length;
  const newArrivals = filtered.filter((v) => v.changeType === "NEW_ARRIVAL" || (v.daysOnLot || 0) <= 3).length;
  const staleCount = filtered.filter((v) => (v.daysOnLot || 0) > 60).length;
  const avgDaysOnLot = filtered.length
    ? filtered.reduce((sum, v) => sum + (v.daysOnLot || 0), 0) / filtered.length
    : 0;
  const dealershipsCount = new Set(filtered.map((v) => v.dealerName)).size;
  return {
    totalActive: filtered.length,
    priceDrops,
    newArrivals,
    staleCount,
    avgDaysOnLot,
    dealershipsCount,
  };
}

async function handleVehiclesAction(searchParams: URLSearchParams) {
  const params = paramsFromSearchParams(searchParams);

  // Tier 1: new box API (MariaDB-backed, paginated/filtered natively).
  const boxResult = await fetchVehiclesFromBox(params);
  if (boxResult) {
    return NextResponse.json({ success: true, source: "box_api", ...boxResult });
  }

  // Tier 2: existing fallback chain, with best-effort filtering/pagination
  // applied in-process since the CSV/JSON/fixtures data isn't paginated.
  const liveData = await loadLegacyLiveData();
  const filtered = applyLegacyFilters(liveData, params);
  const sorted = sortLegacy(filtered, params.sortBy);

  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(params.pageSize || "50", 10) || 50));
  const totalCount = sorted.length;
  const start = (page - 1) * pageSize;
  const vehicles = sorted.slice(start, start + pageSize);

  return NextResponse.json({
    success: true,
    source: "legacy_fallback",
    vehicles,
    pagination: {
      page,
      pageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    },
    stats: legacyStats(filtered),
  });
}

const LEGACY_FACET_DIMENSIONS: Record<string, keyof LegacyVehicle> = {
  make: "make",
  model: "model",
  trim: "trim",
  dealer: "dealerName",
  state: "state",
  year: "year",
  condition: "inventoryType",
};

async function handleFacetsAction(searchParams: URLSearchParams) {
  const params = paramsFromSearchParams(searchParams);

  // Tier 1: new box API.
  const boxResult = await fetchFacetsFromBox(params);
  if (boxResult) {
    return NextResponse.json({ success: true, source: "box_api", ...boxResult });
  }

  // Tier 2: existing fallback chain. Note the legacy CSV/JSON/fixtures shape
  // has no bodyStyle field, so that facet dimension is simply omitted here
  // (best effort — the box API is the only source for it).
  const liveData = await loadLegacyLiveData();
  const excludeFacet = params.excludeFacet;

  const facets: Record<string, { value: string; count: number }[]> = {};
  for (const [dim, field] of Object.entries(LEGACY_FACET_DIMENSIONS)) {
    const filtered = applyLegacyFilters(liveData, excludeFacet === dim ? { ...params, [dim]: "" } : params);
    const counts = new Map<string, number>();
    for (const v of filtered) {
      const raw = v[field];
      if (raw === undefined || raw === null || raw === "") continue;
      const value = String(raw);
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    facets[dim] = Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  }

  return NextResponse.json({ success: true, source: "legacy_fallback", facets });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "summary";

  // NEW: paginated/filtered vehicle list and cross-filtered facet counts,
  // backed primarily by the box API added in Step 4/5 of the migration.
  // Kept under explicit new action values so the existing default/"summary"
  // behavior below is completely unchanged.
  if (action === "vehicles") {
    try {
      return await handleVehiclesAction(searchParams);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || "Failed to query vehicles" },
        { status: 500 }
      );
    }
  }
  if (action === "facets") {
    try {
      return await handleFacetsAction(searchParams);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || "Failed to query facets" },
        { status: 500 }
      );
    }
  }

  try {
    // 1. Attempt to fetch live from Lightsail server
    let liveData = null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`http://${LIGHTSAIL_HOST}:3000/export.csv`, {
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const csvText = await res.text();
        const lines = csvText.trim().split("\n");
        if (lines.length > 1) {
          const headers = lines[0].split(",");
          const rows = lines.slice(1).map((line) => {
            const values: string[] = [];
            let inQuotes = false;
            let current = "";
            for (let i = 0; i < line.length; i++) {
              const char = line[i];
              if (char === '"') {
                inQuotes = !inQuotes;
              } else if (char === "," && !inQuotes) {
                values.push(current.trim());
                current = "";
              } else {
                current += char;
              }
            }
            values.push(current.trim());
            return {
              vin: values[0] || "",
              dealerName: values[1]?.replace(/^"|"$/g, "") || "",
              state: values[2] || "",
              inventoryType: values[3] || "NEW",
              year: parseInt(values[4], 10) || 2026,
              make: values[5] || "Porsche",
              model: values[6]?.replace(/^"|"$/g, "") || "",
              trim: values[7]?.replace(/^"|"$/g, "") || "",
              price: (parseFloat(values[8]) > 0 && parseFloat(values[8]) < 5000000 && parseFloat(values[8]) !== 2147483647) ? parseFloat(values[8]) : null,
              oldPrice: (parseFloat(values[9]) > 0 && parseFloat(values[9]) < 5000000 && parseFloat(values[9]) !== 2147483647) ? parseFloat(values[9]) : null,
              priceDiff: (parseFloat(values[10]) && Math.abs(parseFloat(values[10])) < 5000000) ? parseFloat(values[10]) : 0,
              mileage: parseFloat(values[11]) || 0,
              status: values[12] || "ACTIVE",
              changeType: values[13] || "UNCHANGED",
              daysOnLot: parseInt(values[14], 10) || 14,
              firstSeen: values[15] || "",
              lastSeen: values[16] || "",
              url: values[17] || "",
            };
          });
          liveData = rows;
        }
      }
    } catch (netErr) {
      console.warn("Direct Lightsail HTTP fetch failed, reading local snapshot:", netErr);
    }

    // 2. Fallback to local snapshot file if direct connection times out
    if (!liveData) {
      const localDataPath = path.resolve(
        process.cwd(),
        "data/lightsail_inventory.json"
      );
      try {
        const raw = await fs.readFile(localDataPath, "utf-8");
        liveData = JSON.parse(raw);
      } catch {
        // High quality fallback data if files are not initialized
        liveData = [
          {
            vin: "WP1AA2A53TLB07942",
            dealerName: "Paul Miller Porsche",
            state: "NJ",
            inventoryType: "NEW",
            year: 2026,
            make: "Porsche",
            model: "Macan",
            trim: "GTS",
            price: 89900,
            oldPrice: 94500,
            priceDiff: -4600,
            mileage: 12,
            status: "ACTIVE",
            changeType: "PRICE_DROP",
            daysOnLot: 38,
            firstSeen: "2026-08-01",
            lastSeen: "2026-08-23",
            url: "https://www.paulmillerporsche.com",
          },
          {
            vin: "WP0AB2A97TS226181",
            dealerName: "Paul Miller Porsche",
            state: "NJ",
            inventoryType: "NEW",
            year: 2026,
            make: "Porsche",
            model: "911",
            trim: "Carrera GTS",
            price: 184500,
            oldPrice: null,
            priceDiff: 0,
            mileage: 8,
            status: "ACTIVE",
            changeType: "NEW_ARRIVAL",
            daysOnLot: 2,
            firstSeen: "2026-08-21",
            lastSeen: "2026-08-23",
            url: "https://www.paulmillerporsche.com",
          },
          {
            vin: "WP1AA2AY6LDA00680",
            dealerName: "Champion Porsche",
            state: "FL",
            inventoryType: "USED",
            year: 2024,
            make: "Porsche",
            model: "Cayenne",
            trim: "S Coupe",
            price: 92500,
            oldPrice: 98000,
            priceDiff: -5500,
            mileage: 6200,
            status: "ACTIVE",
            changeType: "PRICE_DROP",
            daysOnLot: 49,
            firstSeen: "2026-07-28",
            lastSeen: "2026-08-23",
            url: "https://www.champion-porsche.com",
          },
          {
            vin: "WP0AA2Y14RSA54321",
            dealerName: "The Collection Porsche",
            state: "FL",
            inventoryType: "NEW",
            year: 2025,
            make: "Porsche",
            model: "Taycan",
            trim: "4S Cross Turismo",
            price: 118200,
            oldPrice: 129500,
            priceDiff: -11300,
            mileage: 15,
            status: "ACTIVE",
            changeType: "PRICE_DROP",
            daysOnLot: 64,
            firstSeen: "2026-06-20",
            lastSeen: "2026-08-23",
            url: "https://www.thecollectionporsche.com",
          },
          {
            vin: "WP0AB2A84KS278857",
            dealerName: "Porsche South Shore",
            state: "NY",
            inventoryType: "CERTIFIED_PRE_OWNED",
            year: 2023,
            make: "Porsche",
            model: "718 Cayman",
            trim: "GTS 4.0",
            price: 88500,
            oldPrice: 91900,
            priceDiff: -3400,
            mileage: 8400,
            status: "ACTIVE",
            changeType: "PRICE_DROP",
            daysOnLot: 42,
            firstSeen: "2026-07-12",
            lastSeen: "2026-08-23",
            url: "https://www.porschesouthshore.com",
          },
          {
            vin: "WP0AA2A90MS205791",
            dealerName: "Porsche Brooklyn",
            state: "NY",
            inventoryType: "NEW",
            year: 2026,
            make: "Porsche",
            model: "Panamera",
            trim: "4 E-Hybrid",
            price: 114000,
            oldPrice: null,
            priceDiff: 0,
            mileage: 6,
            status: "ACTIVE",
            changeType: "NEW_ARRIVAL",
            daysOnLot: 5,
            firstSeen: "2026-08-18",
            lastSeen: "2026-08-23",
            url: "https://www.porschebrooklyn.com",
          },
        ];
      }
    }

    // Compute Market Metrics
    const totalVehicles = liveData.length;
    const priceDrops = liveData.filter((v: any) => v.changeType === "PRICE_DROP" || v.priceDiff < 0);
    const newArrivals = liveData.filter((v: any) => v.changeType === "NEW_ARRIVAL" || v.daysOnLot <= 3);
    const staleInventory = liveData.filter((v: any) => (v.daysOnLot || 0) >= 45);

    // Dealer aggregation
    const dealerBreakdown: Record<string, { count: number; pricedCount: number; state: string; totalPrice: number; avgPrice: number; priceDropsCount: number }> = {};
    liveData.forEach((v: any) => {
      const dName = v.dealerName || "Other";
      if (!dealerBreakdown[dName]) {
        dealerBreakdown[dName] = { count: 0, pricedCount: 0, state: v.state || "US", totalPrice: 0, avgPrice: 0, priceDropsCount: 0 };
      }
      dealerBreakdown[dName].count++;
      if (v.price && v.price > 0 && v.price < 5000000) {
        dealerBreakdown[dName].totalPrice += v.price;
        dealerBreakdown[dName].pricedCount++;
      }
      if (v.changeType === "PRICE_DROP" || v.priceDiff < 0) {
        dealerBreakdown[dName].priceDropsCount++;
      }
    });

    Object.keys(dealerBreakdown).forEach((d) => {
      if (dealerBreakdown[d].pricedCount > 0) {
        dealerBreakdown[d].avgPrice = Math.round(dealerBreakdown[d].totalPrice / dealerBreakdown[d].pricedCount);
      }
    });

    return NextResponse.json({
      success: true,
      serverHost: LIGHTSAIL_HOST,
      lastSync: new Date().toISOString(),
      stats: {
        totalTrackedVehicles: totalVehicles,
        totalPriceDrops: priceDrops.length,
        totalNewArrivals: newArrivals.length,
        totalStaleVehicles: staleInventory.length,
        highLeverageRatioPercent: totalVehicles > 0 ? Math.round((staleInventory.length / totalVehicles) * 100) : 0,
        dealershipsCount: Object.keys(dealerBreakdown).length,
      },
      dealerBreakdown,
      topPriceDrops: priceDrops.sort((a: any, b: any) => (a.priceDiff || 0) - (b.priceDiff || 0)).slice(0, 30),
      recentVehicles: liveData,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to query Lightsail analytics" },
      { status: 500 }
    );
  }
}
