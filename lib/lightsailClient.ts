// Shared client for the Step-4 Lightsail "inventory API" (MariaDB-backed,
// paginated/filtered, port 3002) — see
// scrapers/lightsail-crawler/src/inventory_api_server.js for the server
// this talks to.
//
// This is a NEW, independent data source layered in *front of* the existing
// fallback chains in app/api/lightsail/route.ts (live CSV on :3000 -> committed
// JSON file -> hardcoded fixtures) and app/api/porsche-sticker/route.ts
// (committed JSON file lookup). Every function here returns `null` on any
// failure — network error, timeout, non-2xx status, bad JSON — rather than
// throwing, so callers can do a clean `if (result) return result; else fall
// through to the next tier` without a try/catch at every call site.
//
// Auth: every route on the box requires the `X-Trimscout-Api-Key` header.
// The key is read from process.env.LIGHTSAIL_API_KEY (NOT hardcoded — this
// must be set in Vercel's project environment variables). If the env var
// isn't set, every function here short-circuits to null immediately so the
// existing fallback chains keep working exactly as before.

// Same host resolution pattern as the existing app/api/lightsail/route.ts:
// a Lightsail Static IP that survives instance resize/migration.
export const LIGHTSAIL_HOST =
  process.env.LIGHTSAIL_IP || process.env.LIGHTSAIL_HOST || "44.205.48.153";

// Distinct from the existing port-3000 CSV export server — this is the new
// Step 4 MariaDB-backed HTTP API (inventory_api_server.js).
const INVENTORY_API_PORT = 3002;

const API_KEY = process.env.LIGHTSAIL_API_KEY;

// Slightly under the typical ~10s upstream/serverless timeout budget, and
// comfortably above normal box response times; matches the ~5-6s window
// called for in the migration plan for this new tier.
const DEFAULT_TIMEOUT_MS = 5500;

export interface BoxVehicleOption {
  code: string;
  name: string;
  price: number | null;
  category: string | null;
  source: string | null;
}

export interface BoxVehicleEnrichment {
  vehicle_id: number;
  vin: string;
  nhtsa_plant_country: string | null;
  nhtsa_plant_city: string | null;
  nhtsa_engine_cylinders: number | null;
  nhtsa_engine_displ_l: string | null;
  nhtsa_fuel_type: string | null;
  nhtsa_body_class: string | null;
  nhtsa_gvwr: string | null;
  nhtsa_brake_system: string | null;
  enriched_at: string | null;
  [key: string]: unknown;
}

// Raw `vehicles` row shape as returned by the box (snake_case DB columns),
// plus the joined `options`/`enrichment` the list/detail endpoints attach.
export interface BoxVehicle {
  id: number;
  vin: string;
  brand_id: number;
  dealer_id: number | null;
  dealer_name: string | null;
  state: string | null;
  stock_number: string | null;
  inventory_type: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  body_style: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  mileage: number | null;
  price: number | null;
  old_price: number | null;
  price_diff: number | null;
  msrp: number | null;
  base_msrp: number | null;
  total_options_price: number | null;
  url: string | null;
  image_url: string | null;
  status: string | null;
  change_type: string | null;
  first_seen_date: string | null;
  last_seen_date: string | null;
  sold_date: string | null;
  days_on_lot: number | null;
  standard_equipment?: string | null;
  options?: BoxVehicleOption[];
  enrichment?: BoxVehicleEnrichment | null;
  distance_miles?: number;
  [key: string]: unknown;
}

export interface BoxVehiclesResponse {
  vehicles: BoxVehicle[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
  stats: {
    totalActive: number;
    priceDrops: number;
    newArrivals: number;
    staleCount: number;
    avgDaysOnLot: number;
    dealershipsCount: number;
  };
}

export interface BoxFacetValue {
  value: string;
  count: number;
}

export interface BoxFacetsResponse {
  facets: Record<string, BoxFacetValue[]>;
}

export type BoxVehicleDetail = BoxVehicle;

// Accepts undefined/null/"" values so callers can pass a raw searchParams
// spread straight through without pre-filtering.
export type BoxQueryParams = Record<string, string | number | undefined | null>;

function buildQueryString(params: BoxQueryParams): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    sp.set(key, String(value));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

async function fetchBoxJson<T>(
  pathAndQuery: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T | null> {
  // No key configured (e.g. not yet added to Vercel env) -> skip this tier
  // entirely and let callers fall through to their existing chain.
  if (!API_KEY) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `http://${LIGHTSAIL_HOST}:${INVENTORY_API_PORT}${pathAndQuery}`,
      {
        signal: controller.signal,
        cache: "no-store",
        headers: { "X-Trimscout-Api-Key": API_KEY },
      }
    );
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`Lightsail box API request failed for ${pathAndQuery}:`, err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** GET /api/vehicles — paginated/filtered vehicle list. Returns null on any failure. */
export async function fetchVehiclesFromBox(
  params: BoxQueryParams
): Promise<BoxVehiclesResponse | null> {
  return fetchBoxJson<BoxVehiclesResponse>(`/api/vehicles${buildQueryString(params)}`);
}

/** GET /api/vehicles/facets — cross-filtered facet counts. Returns null on any failure. */
export async function fetchFacetsFromBox(
  params: BoxQueryParams
): Promise<BoxFacetsResponse | null> {
  return fetchBoxJson<BoxFacetsResponse>(`/api/vehicles/facets${buildQueryString(params)}`);
}

/** GET /api/vehicles/:vin — single vehicle detail. Returns null on any failure (including 404). */
export async function fetchVehicleByVinFromBox(
  vin: string
): Promise<BoxVehicleDetail | null> {
  if (!vin || !/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) return null;
  return fetchBoxJson<BoxVehicleDetail>(`/api/vehicles/${encodeURIComponent(vin)}`);
}

/** GET /health — box status check. Returns null on any failure. */
export async function fetchBoxHealth(): Promise<{
  status: string;
  dbConnected: boolean;
  recordCount: number;
  lastCrawlAt: string | null;
  lastEnrichedAt: string | null;
} | null> {
  return fetchBoxJson("/health", 3500);
}
