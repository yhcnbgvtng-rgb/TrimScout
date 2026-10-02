/**
 * Does our own crawl hold data for this VIN? Drives the wizard's VIN hyperlink, which opens that
 * VIN's page in the admin crawl sheet (/admin/crawl?vin=…, the day-by-day VIN history).
 *
 * Its own lookup, off the paste import's critical path: the import's VIN→sighting call is capped at
 * 4s and fails soft, and live 2026-10-02 the same VINs came back with and without crawl data on
 * consecutive imports. This one can afford a longer cap, and caches both answers — a hit for an
 * hour, a genuine "no crawl data" briefly. A timeout/error is "unavailable" (retry), never cached.
 */
import { inventoryVin } from "./inventoryApi";

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const LOOKUP_TIMEOUT_MS = 12_000;
const HIT_TTL_MS = 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 1000;
const MAX_CACHE = 2000;

export type VinCrawlData = "found" | "none" | "unavailable";

const cache = new Map<string, { at: number; ttl: number; found: boolean }>();

export async function crawlDataForVin(rawVin: string, lookup: typeof inventoryVin = inventoryVin, now: () => number = Date.now): Promise<VinCrawlData> {
  const vin = (rawVin || "").trim().toUpperCase();
  if (!VIN_RE.test(vin)) return "none";
  const hit = cache.get(vin);
  if (hit && now() - hit.at < hit.ttl) return hit.found ? "found" : "none";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS); });
    const res = await Promise.race([lookup(vin), timeout]);
    if (!res) return "unavailable";
    const found = (res.listings || []).length > 0;
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(vin, { at: now(), ttl: found ? HIT_TTL_MS : MISS_TTL_MS, found });
    return found ? "found" : "none";
  } catch {
    return "unavailable";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function clearVinCrawlCache(): void {
  cache.clear();
}

/** The admin crawl-sheet page for one VIN. */
export function crawlSheetPathForVin(vin: string): string {
  return `/admin/crawl?vin=${encodeURIComponent(vin.trim().toUpperCase())}`;
}
