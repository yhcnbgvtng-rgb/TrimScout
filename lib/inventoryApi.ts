/**
 * Dealer inventory on the deals box — vehicles crawled nightly by the crawl box (run-daily-crawl.mjs) and
 * synced by scripts/box/inventory-sync.mjs, keyed by (VIN, store). Server-only (API key).
 */
import { LIGHTSAIL_HOST } from "./lightsailClient";
import { serverSecret } from "./serverSecret";
import type { DealerAnalytics } from "./dealerAnalytics";

const DEALS_API_PORT = 3004;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface InventoryVehicle {
  vin: string;
  dealerId: string | null;
  dealerName: string;
  dealerCity: string | null;
  dealerState: string | null;
  condition: "new" | "used" | "cpo" | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  bodyStyle: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  mileage: number | null;
  price: number | null;
  msrp: number | null;
  stockNumber: string | null;
  vdpUrl: string | null;
  imageUrl: string | null;
  source: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  removedAt: string | null;
  /** Nightly-crawl extras (null when the row came from a source that doesn't carry them). */
  windowStickerUrl: string | null;
  engine: string | null;
  transmission: string | null;
  daysOnLot: number | null;
  oldPrice: number | null;
  priceDiff: number | null;
  priceChangeType: string | null;
  changeType: string | null;
  priceHistory: Array<{ date: string; price: number }> | null;
  options: Array<{ code: string | null; name: string | null; price: number | null; kind: "factory" | "dealer" }> | null;
  optionsTotal: number | null;
  baseMsrp: number | null;
  crawlFirstSeen: string | null;
  /** Which crawl box's nightly sync last wrote this row (box1-4) — null for rows written before this was tracked. */
  sourceBox: string | null;
}

export interface InventoryDealerCount {
  dealerId: string;
  inStock: number;
  newCount: number;
  priceDrops: number;
  lastSeenAt: string | null;
}

export interface InventoryUpsert {
  vin: string;
  dealerId?: string | number | null;
  dealerName: string;
  condition?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  bodyStyle?: string | null;
  exteriorColor?: string | null;
  interiorColor?: string | null;
  mileage?: number | null;
  price?: number | null;
  msrp?: number | null;
  stockNumber?: string | null;
  vdpUrl?: string | null;
  imageUrl?: string | null;
  source?: string | null;
  sourceBox?: string | null;
}

/** Fields the box accepts as REPEATED params (state=FL&state=GA): OR within a field, AND across fields. */
export const MULTI_VALUE_KEYS = ["state", "make", "model", "trim", "cond"] as const;

export interface InventoryQuery {
  dealerId?: string;
  /** state / make / model / trim / cond take one value or several (OR). One value is sent exactly as before. */
  state?: string | string[];
  make?: string | string[];
  model?: string | string[];
  trim?: string | string[];
  cond?: string | string[];
  q?: string;
  inStock?: boolean;
  changeType?: string;
  priceChange?: "drop" | "increase";
  /** Admin "Sold" movement filter — removed from the dealer's own site within the last 24h. See inventoryListQuery.js's own comment for why 24h (no crawl run-id exists in this schema). Never combined with inStock. */
  removed?: boolean;
  hasSticker?: boolean;
  minDays?: number;
  maxDays?: number;
  priceMin?: number;
  priceMax?: number;
  yearMin?: number;
  yearMax?: number;
  exteriorColor?: string;
  interiorColor?: string;
  /** Max odometer reading. */
  odometerMax?: number;
  /** Only vehicles whose price has changed at least this many times since it was first crawled. */
  minPriceChanges?: number;
  /**
   * Must-have-ALL factory options (real set containment against dealer_inventory_options's
   * canonical_key column) — pass the `key`s straight off `catalogOptions()`. NEVER the raw
   * per-listing `code` a listing carries (confirmed live: that's a listing-position number like
   * "OPT-35", not a stable identifier — the same real option gets a different code on every
   * vehicle). Comma-joined on the wire, same as every other filter here being a single string
   * value.
   */
  optionKeys?: string[];
  /** New condition with over 500 miles — likely a demo/loaner. */
  possibleDemo?: boolean;
  /** Stop counting at this many matches (the response sets totalCapped) — buyer search never pays for an exact COUNT(*) over a huge set. */
  countCap?: number;
  limit?: number;
  offset?: number;
  sort?: string;
}

/** Filters the buyer-facing /search page exposes — a subset of InventoryQuery, no admin-only fields (dealerId, changeType, hasSticker). */
export type BuyerSearchQuery = Pick<
  InventoryQuery,
  | "state"
  | "make"
  | "model"
  | "trim"
  | "cond"
  | "q"
  | "priceMin"
  | "priceMax"
  | "yearMin"
  | "yearMax"
  | "minDays"
  | "maxDays"
  | "odometerMax"
  | "minPriceChanges"
  | "exteriorColor"
  | "interiorColor"
  | "optionKeys"
  | "possibleDemo"
  | "countCap"
  | "limit"
  | "offset"
  | "sort"
> & {
  /** Buyer's own zip — used only for the response's per-vehicle distanceMiles, and (with radiusMiles) to filter/sort by distance. */
  zip?: string;
  /** Requires `make` to also be set — enforced by the /api/vehicles/search route, not here. */
  radiusMiles?: number;
};

export interface InventoryStats {
  total: number;
  inStock: number;
  dealers: number;
  /** Distinct VINs — a car a dealer group lists on several rooftops counts once here, once per store in `total`. */
  vins?: number;
  lastSeenAt: string | null;
  byMake: Array<{ make: string; n: number }>;
  byState: Array<{ state: string; n: number }>;
  byCond: Array<{ cond: string | null; n: number }>;
  movement?: { arrivals: number; priceDrops: number; priceIncreases: number; withSticker: number; removedToday: number };
}

export class InventoryApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  const apiKey = serverSecret("LIGHTSAIL_API_KEY");
  if (!apiKey) throw new InventoryApiError("Inventory backend is not configured (missing LIGHTSAIL_API_KEY)", 500);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`http://${LIGHTSAIL_HOST}:${DEALS_API_PORT}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Trimscout-Api-Key": apiKey },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    throw new InventoryApiError(err instanceof Error && err.name === "AbortError" ? "Inventory request timed out" : "Could not reach inventory service", 503);
  } finally {
    clearTimeout(timeoutId);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new InventoryApiError((json && json.error) || `Inventory service error (${res.status})`, res.status);
  return json;
}

export function inventoryQueryString(q: InventoryQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (Array.isArray(v) && (MULTI_VALUE_KEYS as readonly string[]).includes(k)) {
      for (const one of v) if (one) p.append(k, String(one));
      continue;
    }
    p.set(k, v === true ? "1" : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** `total` is exact unless `totalCapped` — then it is a floor ("at least this many"), counted only up to the request's countCap. */
export interface InventoryPage { total: number; totalCapped?: boolean; limit: number; offset: number; vehicles: InventoryVehicle[] }

export async function listInventory(q: InventoryQuery = {}): Promise<InventoryPage> {
  return request("GET", `/api/inventory${inventoryQueryString(q)}`);
}

/**
 * The buyer /search page's deterministic search — always in-stock only (buyers never see removed
 * listings), and strips `zip`/`radiusMiles` before hitting the box (those are handled by the
 * caller via calculateDistanceMiles in otdCalculator.ts, not by dealer_inventory itself, which
 * has no per-dealer lat/lng). Callers enforce the "zip+radius needs make" guardrail themselves —
 * this function doesn't know about it.
 */
export async function searchInventory(q: BuyerSearchQuery = {}): Promise<InventoryPage> {
  const { zip, radiusMiles, ...rest } = q;
  return listInventory({ ...rest, inStock: true });
}

export interface CatalogOptions {
  /** `key` is the stable canonical_key to pass into `optionKeys=` — never a raw per-listing code. `label` is what to actually show the buyer. */
  options: Array<{ key: string; label: string; vehicleCount: number }>;
  exteriorColors: string[];
  interiorColors: string[];
}

/** Factory options (canonical key + display label) and colors that actually exist among in-stock vehicles matching make/model/trim — the /search filter panel's own source of truth, so it never offers a combination with zero results. */
export async function catalogOptions(f: { make?: string; model?: string; trim?: string } = {}): Promise<CatalogOptions> {
  const qs = new URLSearchParams();
  if (f.make) qs.set("make", f.make);
  if (f.model) qs.set("model", f.model);
  if (f.trim) qs.set("trim", f.trim);
  const suffix = qs.toString();
  return request("GET", `/api/inventory/catalog${suffix ? `?${suffix}` : ""}`);
}

export interface InventoryFacets {
  states: Array<{ state: string; n: number }>;
  makes: Array<{ make: string; n: number }>;
  /** Only ever populated when `make` was passed — mirrors the /search page's own unlock rule (a model list with no make has nothing selective to scope it by). */
  models: Array<{ model: string; n: number }>;
  /** Only ever populated when both `make` and `model` were passed. */
  trims: Array<{ trim: string; n: number }>;
}

/**
 * Hit counts for the /search page's State/Make/Model/Trim dropdowns, cross-scoped by whichever
 * filters are already set: pass `state` to get make counts scoped to that state (and vice versa),
 * `make` to also get a model list scoped to that make (+ state, if set), and `make` + `model`
 * together to also get a trim list. Each distinct (state, make, model) combination is its own
 * cache entry on the box — never reuses `inventoryStats()`'s or `inventoryMakes()`'s unscoped,
 * whole-table cache keys, which would mean two callers with different filters silently reading
 * each other's result.
 */
export async function inventoryFacets(f: { state?: string; make?: string; model?: string } = {}): Promise<InventoryFacets> {
  const qs = new URLSearchParams();
  if (f.state) qs.set("state", f.state);
  if (f.make) qs.set("make", f.make);
  if (f.model) qs.set("model", f.model);
  const suffix = qs.toString();
  return request("GET", `/api/inventory/facets${suffix ? `?${suffix}` : ""}`);
}

/**
 * The admin sheet's default sort (dealer:asc) has no fast plan for State + Make without a Model: the box
 * walks the whole state's index in dealer order (Porsche in NJ never finishes inside the 20s cap). Measured
 * live 2026-10-02: the same query sorted by model reads idx_inv_facet_make_state_model in index order and
 * returns in ~60 ms. So for exactly that shape, an UNCHOSEN (default) dealer sort is swapped for model:asc —
 * an explicitly chosen sort is left alone. Needs inStock (the index hint's own precondition). State alone
 * (no Make) has no fast plan under any sort and is not changed.
 */
export function adminListSort(q: Pick<InventoryQuery, "state" | "make" | "model" | "inStock" | "dealerId" | "sort">): string | undefined {
  const has = (v: string | string[] | undefined) => (Array.isArray(v) ? v.length > 0 : Boolean(v));
  const isDefault = !q.sort || q.sort === "dealer:asc";
  if (isDefault && q.inStock && !q.dealerId && has(q.state) && has(q.make) && !has(q.model)) return "model:asc";
  return q.sort;
}

export interface AdminInventoryFacets extends InventoryFacets {
  /** Marker set by the box's admin-facets endpoint — absent on an un-patched box. */
  multi?: boolean;
}

/**
 * Multi-select facet counts for the admin Vehicles sheet. Each list is scoped by the OTHER fields'
 * selections but not its own (see scrapers/lightsail-crawler/src/inventoryAdminFacets.js), so
 * picking FL still shows GA's count. In-stock counts only. A box that predates the endpoint answers
 * 404 — surfaced as-is so the sheet can say the box needs updating instead of showing wrong counts.
 */
export async function inventoryAdminFacets(f: { state?: string[]; make?: string[]; model?: string[] } = {}): Promise<AdminInventoryFacets> {
  const qs = new URLSearchParams();
  for (const k of ["state", "make", "model"] as const) for (const v of f[k] || []) if (v) qs.append(k, v);
  const suffix = qs.toString();
  return request("GET", `/api/inventory/admin-facets${suffix ? `?${suffix}` : ""}`);
}

/** Longest the box may take to stream a whole export — the route's maxDuration minus headroom. */
const EXPORT_TIMEOUT_MS = 280_000;

/**
 * Every vehicle matching `q` (cap 50k), one box query streamed as it arrives: yields each vehicle,
 * then returns whether the cap cut the result short. Throws if the box reports a failure or the
 * stream ends without its {"done":true} trailer (cut off) — a partial CSV must never look complete.
 */
export async function* exportInventory(q: InventoryQuery = {}): AsyncGenerator<InventoryVehicle, { capped: boolean }> {
  const apiKey = serverSecret("LIGHTSAIL_API_KEY");
  if (!apiKey) throw new InventoryApiError("Inventory backend is not configured (missing LIGHTSAIL_API_KEY)", 500);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`http://${LIGHTSAIL_HOST}:${DEALS_API_PORT}/api/inventory/export${inventoryQueryString(q)}`, {
        headers: { "X-Trimscout-Api-Key": apiKey }, signal: controller.signal, cache: "no-store",
      });
    } catch (err) {
      throw new InventoryApiError(err instanceof Error && err.name === "AbortError" ? "Inventory request timed out" : "Could not reach inventory service", 503);
    }
    if (!res.ok || !res.body) {
      const json = await res.json().catch(() => null);
      throw new InventoryApiError((json && json.error) || `Inventory service error (${res.status})`, res.status);
    }
    const decoder = new TextDecoder();
    let buf = "";
    try {
      // A trailing sentinel chunk flushes a last line that arrived without its newline.
      const chunks = async function* (body: AsyncIterable<Uint8Array>) { yield* body; yield null; };
      for await (const chunk of chunks(res.body as unknown as AsyncIterable<Uint8Array>)) {
        buf += chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode() + "\n";
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const obj = JSON.parse(line);
          if (obj.done) return { capped: Boolean(obj.capped) };
          if (obj.error) throw new InventoryApiError(obj.error, 502);
          yield obj as InventoryVehicle;
        }
      }
    } catch (err) {
      if (err instanceof InventoryApiError) throw err;
      throw new InventoryApiError(err instanceof Error && err.name === "AbortError" ? "Inventory request timed out" : "Inventory export was cut off", 503);
    }
    throw new InventoryApiError("Inventory export was cut off", 502);
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
  }
}

export async function inventoryStats(): Promise<InventoryStats> {
  return request("GET", "/api/inventory/stats");
}

/**
 * Just the make list with in-stock counts — a cheap, indexed query on its own, deliberately NOT
 * `inventoryStats().byMake`: that endpoint also computes a `byState` aggregate and a movement
 * aggregate neither caller of this function needs, and (until 2026-09-25) shared one cache
 * key/computation with them, so every caller paid for the slow parts too. See
 * BUYER_SEARCH.md / handleInventoryMakes in deals_api_server.js.
 */
export async function inventoryMakes(): Promise<{ makes: Array<{ make: string; n: number }> }> {
  return request("GET", "/api/inventory/makes");
}

export interface MarketPulseJustArrived {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  price: number | null;
  imageUrl: string | null;
  dealerName: string;
  dealerState: string | null;
  vdpUrl: string | null;
  firstSeenAt: string;
}

export interface MarketPulseMovingMake {
  make: string;
  removed7d: number;
  /** The box's CURRENT in-stock count for this make, used as a proxy for a true rolling 7-day average — there's no daily inventory snapshot table to compute a real one from. */
  avgInStock7d: number;
  /** Percent, one decimal (e.g. 4.2 for 4.2%). */
  rate: number;
  sampleOk: boolean;
}

export interface MarketPulse {
  asOf: string;
  scope: "national" | { state: string };
  windows: {
    "24h": { inStock: number; arrivals: number; removed: number; priceDrops: number; priceIncreases: number; medianDaysOnLot: number | null };
    "7d": { arrivals: number; removed: number };
  };
  movingMakes: MarketPulseMovingMake[];
  justArrived: MarketPulseJustArrived[];
}

/**
 * The public homepage's crawl-derived market pulse — arrivals, removals ("left dealer lots",
 * never "sold" — this is a velocity proxy, not a confirmed sale), price drops, days on lot, and
 * moving makes. Cached on the box (10-min TTL, same as stats/analytics) so this is cheap and
 * fast even on a cache miss; still goes through the shared 60s-timeout `request()` like every
 * other call here, so a caller on the public homepage path should treat a failure as "pulse
 * unavailable" and render nothing rather than surface an error to a visitor.
 */
export async function marketPulse(state?: string): Promise<MarketPulse> {
  const qs = state ? `?state=${encodeURIComponent(state)}` : "";
  return request("GET", `/api/inventory/market-pulse${qs}`);
}

export async function inventoryByDealer(): Promise<{ dealers: InventoryDealerCount[] }> {
  return request("GET", "/api/inventory/by-dealer");
}

export interface InventoryDay {
  dealerId: string | null;
  seenOn: string;
  price: number | null;
  mileage: number | null;
}

export interface AnalyticsFilters {
  state?: string;
  make?: string;
  dealerId?: string | number | null;
  model?: string;
  from?: string;
  to?: string;
}

/** Dealership analytics (DOM = days on the lot, velocity, pricing, coverage, quality), aggregated on the box. */
export async function inventoryAnalytics(f: AnalyticsFilters = {}): Promise<DealerAnalytics> {
  const qs = new URLSearchParams();
  if (f.state) qs.set("state", f.state);
  if (f.make) qs.set("make", f.make);
  if (f.dealerId != null && f.dealerId !== "") qs.set("dealerId", String(f.dealerId));
  if (f.model) qs.set("model", f.model);
  if (f.from) qs.set("from", f.from);
  if (f.to) qs.set("to", f.to);
  const suffix = qs.toString();
  return request("GET", `/api/inventory/analytics${suffix ? `?${suffix}` : ""}`);
}

/** Every listing of one VIN (each store that has carried it) plus the day-by-day observations behind them. */
export async function inventoryVin(vin: string): Promise<{ vin: string; listings: InventoryVehicle[]; days: InventoryDay[] }> {
  const clean = vin.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(clean)) throw new InventoryApiError("A VIN is 17 characters (no I, O or Q).", 400);
  return request("GET", `/api/inventory/vin/${clean}`);
}

export async function bulkUpsertInventory(vehicles: InventoryUpsert[]): Promise<{ upserted: number; skipped: number }> {
  return request("POST", "/api/inventory/bulk", { vehicles });
}

/**
 * The VIN(s) our own nightly crawl already matched to this exact listing URL, keyed by a
 * normalized comparison (query string/fragment, protocol, leading www., trailing slash all
 * stripped — see the box's vdp_url_norm trigger). Used as a fallback when a buyer pastes a VDP
 * link that carries no VIN in its own text: a lookup against inventory we already collected,
 * never a live fetch of the dealer's page. Fails soft — any backend trouble reads as "no match".
 */
export async function inventoryVinByListingUrl(url: string): Promise<InventoryVehicle | null> {
  try {
    const res = await request("GET", `/api/inventory/by-listing-url?url=${encodeURIComponent(url)}`);
    const matches: InventoryVehicle[] = Array.isArray(res?.matches) ? res.matches : [];
    return matches[0] || null;
  } catch {
    return null;
  }
}

/** `sources` limits the sweep to rows a given crawler wrote, so two crawlers covering one store don't erase each other. */
export async function sweepInventory(dealerId: string | number, seenAfter: string, sources?: string[]): Promise<{ removed: number }> {
  return request("POST", "/api/inventory/sweep", { dealerId, seenAfter, ...(sources?.length ? { sources } : {}) });
}
