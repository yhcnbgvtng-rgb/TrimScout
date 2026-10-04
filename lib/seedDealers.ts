/**
 * Prefill for the "Dealerships to ask" list when a quote starts from cars picked on buyer search: each picked car's
 * store, but only where the directory has a named sales contact for it. Pure; the caller supplies the search hits.
 */
import { normalizeDealerKey } from "./dealerName";
import type { DeskMatch } from "./deskResolve";

export interface SeedDealer {
  dealerName: string;
  dealerState?: string | null;
}

/** Distinct stores (name + state) behind the picked cars, in pick order. */
export function seedDealersOf(cars: Array<{ dealerName?: string; dealerState?: string | null }>): SeedDealer[] {
  const out: SeedDealer[] = [];
  const seen = new Set<string>();
  for (const c of cars) {
    const dealerName = (c.dealerName || "").trim();
    if (!dealerName) continue;
    const dealerState = (c.dealerState || "").trim().toUpperCase() || null;
    const key = `${normalizeDealerKey(dealerName)}|${dealerState ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dealerName, dealerState });
  }
  return out;
}

/**
 * The one directory row that is this store, or null. Same normalized name, and the same state when the car's state
 * is known; a name shared by several rows (a chain repeating it) is ambiguous and stays unfilled. The row must carry
 * a named contact on file (the picker's "Contact on file" badge) and not have opted out.
 */
export function deskForSeedDealer(hits: DeskMatch[], dealer: SeedDealer): DeskMatch | null {
  const key = normalizeDealerKey(dealer.dealerName);
  const state = (dealer.dealerState || "").trim().toUpperCase();
  const same = hits.filter((h) => normalizeDealerKey(h.dealerName) === key && (!state || (h.state || "").toUpperCase() === state));
  if (same.length !== 1) return null;
  const [desk] = same;
  return desk.knownNamed && !desk.emailOptOut ? desk : null;
}
