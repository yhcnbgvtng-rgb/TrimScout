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
}

export interface InventoryQuery {
  dealerId?: string;
  state?: string;
  make?: string;
  model?: string;
  trim?: string;
  cond?: string;
  q?: string;
  inStock?: boolean;
  changeType?: string;
  priceChange?: "drop" | "increase";
  hasSticker?: boolean;
  minDays?: number;
  /** New condition with over 500 miles — likely a demo/loaner. */
  possibleDemo?: boolean;
  limit?: number;
  offset?: number;
  sort?: string;
}

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
    p.set(k, v === true ? "1" : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function listInventory(q: InventoryQuery = {}): Promise<{ total: number; limit: number; offset: number; vehicles: InventoryVehicle[] }> {
  return request("GET", `/api/inventory${inventoryQueryString(q)}`);
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

/** `sources` limits the sweep to rows a given crawler wrote, so two crawlers covering one store don't erase each other. */
export async function sweepInventory(dealerId: string | number, seenAfter: string, sources?: string[]): Promise<{ removed: number }> {
  return request("POST", "/api/inventory/sweep", { dealerId, seenAfter, ...(sources?.length ? { sources } : {}) });
}
