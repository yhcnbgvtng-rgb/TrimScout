/**
 * The dealer listing page our own crawl captured for a VIN — what the wizard's VIN links to.
 *
 * Why this is its own lookup instead of riding on the paste import: the import's VIN→sighting call
 * (inventoryDealerForVin) is deliberately capped at 4s so a slow deals box never stalls a buyer's
 * paste, and it fails soft to "never seen". Live 2026-10-02 the same three VINs came back with and
 * without crawl data on consecutive imports (2s hits, 4s misses), so a link that depended on that
 * race showed up on some cards and not others. This lookup is off the import's critical path (the
 * VIN link asks for it after the card renders), so it can afford a longer cap and a retry, and it
 * caches both answers — a hit for an hour, a genuine "we have no crawl data" briefly.
 */
import { inventoryVin, type InventoryVehicle } from "./inventoryApi";
import { safeHttpUrl } from "./inventoryVinLookup";

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const LOOKUP_TIMEOUT_MS = 12_000;
const HIT_TTL_MS = 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 1000;
const MAX_CACHE = 2000;

export type VinCrawlLink = { status: "found"; url: string } | { status: "none" } | { status: "unavailable" };

/** In stock first, then most recently seen; only listings that actually carry a usable http(s) URL. */
export function crawlLinkFromListings(listings: InventoryVehicle[]): string | null {
  const withUrl = listings
    .map((l) => ({ l, url: safeHttpUrl(l.vdpUrl) }))
    .filter((x): x is { l: InventoryVehicle; url: string } => Boolean(x.url));
  if (!withUrl.length) return null;
  const rank = (l: InventoryVehicle) => `${l.removedAt ? 0 : 1}${l.lastSeenAt || ""}`;
  return withUrl.reduce((a, b) => (rank(b.l) > rank(a.l) ? b : a)).url;
}

const cache = new Map<string, { at: number; ttl: number; url: string | null }>();

export async function crawlLinkForVin(rawVin: string, lookup: typeof inventoryVin = inventoryVin, now: () => number = Date.now): Promise<VinCrawlLink> {
  const vin = (rawVin || "").trim().toUpperCase();
  if (!VIN_RE.test(vin)) return { status: "none" };
  const hit = cache.get(vin);
  if (hit && now() - hit.at < hit.ttl) return hit.url ? { status: "found", url: hit.url } : { status: "none" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS); });
    const res = await Promise.race([lookup(vin), timeout]);
    // A timeout or backend error is "couldn't tell", never cached as "no data".
    if (!res) return { status: "unavailable" };
    const url = crawlLinkFromListings(res.listings || []);
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(vin, { at: now(), ttl: url ? HIT_TTL_MS : MISS_TTL_MS, url });
    return url ? { status: "found", url } : { status: "none" };
  } catch {
    return { status: "unavailable" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function clearVinCrawlLinkCache(): void {
  cache.clear();
}
