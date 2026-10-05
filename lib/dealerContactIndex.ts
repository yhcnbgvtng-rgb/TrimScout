/**
 * Which dealerships have a contact on file, for the buyer search table's "Contact" column. Server-only.
 * "Has a contact" = the directory row has a contact email (a way to reach the store); a name alone doesn't count.
 * The directory is ~18k rows, so it is fetched once and cached (single-flight, 10 minutes). If the directory can't be
 * reached the answer is "unknown" (null) and search carries on — a column must never break a search.
 */
import { listDealerships, type Dealership } from "./dealershipsApi";

const TTL_MS = 10 * 60 * 1000;

export function dealerHasContact(d: Pick<Dealership, "contactEmail">): boolean {
  return Boolean(d.contactEmail && d.contactEmail.trim());
}

/** Dealer ids (as strings, matching InventoryVehicle.dealerId) that have a contact. */
export function contactIdSet(dealers: Array<Pick<Dealership, "id" | "contactEmail">>): Set<string> {
  const out = new Set<string>();
  for (const d of dealers) if (dealerHasContact(d)) out.add(String(d.id));
  return out;
}

/** true / false when the directory answered; null when it is unknown (no dealer id, or the directory is down). */
export function contactStatus(index: Set<string> | null, dealerId: string | null | undefined): boolean | null {
  if (!index || !dealerId) return null;
  return index.has(String(dealerId));
}

let cache: { at: number; ids: Set<string> } | null = null;
let inFlight: Promise<Set<string> | null> | null = null;

export async function loadContactIndex(now: number = Date.now()): Promise<Set<string> | null> {
  if (cache && now - cache.at < TTL_MS) return cache.ids;
  if (!inFlight) {
    inFlight = listDealerships()
      .then((rows) => { cache = { at: Date.now(), ids: contactIdSet(rows) }; return cache.ids; })
      .catch(() => cache?.ids ?? null) // a stale index beats none; no index at all = unknown
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}
