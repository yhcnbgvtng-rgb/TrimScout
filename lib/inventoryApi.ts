/**
 * Dealer inventory on the deals box — vehicles crawled from dealer websites by
 * scrapers/inventory/crawl_inventory.py and upserted by VIN. Server-only (API key).
 */
import { LIGHTSAIL_HOST } from "./lightsailClient";
import { serverSecret } from "./serverSecret";

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
  cond?: string;
  q?: string;
  inStock?: boolean;
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

export async function inventoryStats(): Promise<InventoryStats> {
  return request("GET", "/api/inventory/stats");
}

export async function bulkUpsertInventory(vehicles: InventoryUpsert[]): Promise<{ upserted: number; skipped: number }> {
  return request("POST", "/api/inventory/bulk", { vehicles });
}

export async function sweepInventory(dealerId: string | number, seenAfter: string): Promise<{ removed: number }> {
  return request("POST", "/api/inventory/sweep", { dealerId, seenAfter });
}
