/**
 * Real distances for the buyer search. A ZIP's coordinates come from the US Census ZCTA gazetteer (lib/data/zcta.json, built by
 * scripts/build-zcta.mjs); a dealer is placed by the ZIP stored in the dealership directory. Nothing here invents a location: a
 * ZIP or dealer we cannot place has NO distance (null), never a state centroid or a default city.
 */
import zcta from "./data/zcta.json";
import type { ContactIndex } from "./dealerContactIndex";
import { dealerIdFrom, dealerMatchKey, pickDirectoryMatch } from "./dealerContactLookup";
import { cityCoordinates } from "./otdCalculator";

const TABLE = zcta as unknown as Record<string, [number, number]>;

export interface LatLng { lat: number; lng: number }

/** Centre of a 5-digit ZIP (ZIP+4 and stray characters are tolerated), or null when it is not a real ZIP. */
export function zipLatLng(zip: string | null | undefined): LatLng | null {
  const m = /^\s*(\d{5})(?:[-\s]?\d{4})?\s*$/.exec(zip ?? "");
  const hit = m ? TABLE[m[1]] : undefined;
  return hit ? { lat: hit[0], lng: hit[1] } : null;
}

const EARTH_MILES = 3958.8;

export function haversineMiles(a: LatLng, b: LatLng): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return EARTH_MILES * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** One decimal under 50 mi, whole miles beyond — the precision the search always showed. */
export function roundMiles(d: number): number {
  return d < 1 ? 1 : d < 50 ? Math.round(d * 10) / 10 : Math.round(d);
}

export interface DealerRef { dealerId?: string | number | null; dealerName?: string | null; dealerCity?: string | null; dealerState?: string | null }

/** Resolves a car's dealer to coordinates: the directory row's ZIP first, then a named big city, else null. Memoised per dealer. */
export function makeDealerLocator(index: ContactIndex | null): (d: DealerRef) => LatLng | null {
  const byId = new Map<string, string | null>();
  if (index) for (const rows of index.values()) for (const r of rows) byId.set(String(r.id), r.zipCode);
  const memo = new Map<string, LatLng | null>();
  return (d) => {
    const key = `${d.dealerId ?? ""}|${d.dealerName ?? ""}|${d.dealerCity ?? ""}|${d.dealerState ?? ""}`;
    if (memo.has(key)) return memo.get(key)!;
    let zip: string | null | undefined;
    const id = dealerIdFrom(d.dealerId);
    if (id && byId.has(id)) zip = byId.get(id);
    else if (index) {
      const nameKey = dealerMatchKey(d.dealerName || "");
      zip = nameKey ? pickDirectoryMatch(index.get(nameKey) || [], d.dealerState)?.zipCode : null;
    }
    const placed = zipLatLng(zip) ?? cityCoordinates(d.dealerCity || "");
    memo.set(key, placed);
    return placed;
  };
}
