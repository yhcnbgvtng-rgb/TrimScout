/**
 * One listing per VIN on the buyer /search. The box does this in its query (so rows, totals and facet counts agree — see
 * scrapers/lightsail-crawler/src/onePerVin.js); this is the web-side half: it breaks the ties the box leaves open when the buyer's
 * location is known (distance is computed here from the dealer's city/state, never stored), and it collapses a page itself when the
 * box has not been patched yet (the box echoes `onePerVin: true` when it applied the rule).
 *
 * The rule: the store that saw the VIN most recently keeps it; on a tie, the nearest store to the buyer if their location is known,
 * otherwise the lowest price (a missing price ranks last), then the lowest dealer id so the choice is total.
 * Pure. Admin and dealer views never call it.
 */
export interface OnePerVinRow {
  vin: string;
  dealerId: string | null;
  price: number | null;
  lastSeenAt: string;
}

const seenMs = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T")) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Keeps one row per VIN, in the order the rows came (a row stays where its winner was). `distanceOf` gives miles for a row, or null when unknown. */
export function collapseByVin<T extends OnePerVinRow>(rows: T[], distanceOf?: ((row: T) => number | null) | null): { rows: T[]; dropped: number } {
  const best = new Map<string, T>();
  const better = (a: T, b: T): boolean => {
    const sa = seenMs(a.lastSeenAt), sb = seenMs(b.lastSeenAt);
    if (sa !== sb) return sa > sb;
    if (distanceOf) {
      const da = distanceOf(a), db = distanceOf(b);
      if (da !== null && db !== null && da !== db) return da < db;
      if (da !== null && db === null) return true;
      if (da === null && db !== null) return false;
    }
    const pa = a.price ?? Number.POSITIVE_INFINITY, pb = b.price ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa < pb;
    return Number(a.dealerId || 0) < Number(b.dealerId || 0);
  };
  for (const r of rows) {
    const vin = (r.vin || "").toUpperCase();
    if (!vin) continue;
    const cur = best.get(vin);
    if (!cur || better(r, cur)) best.set(vin, r);
  }
  const out = rows.filter((r) => !r.vin || best.get(r.vin.toUpperCase()) === r);
  return { rows: out, dropped: rows.length - out.length };
}
